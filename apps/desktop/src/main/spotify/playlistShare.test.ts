import assert from "node:assert/strict";
import { test } from "node:test";
import type { SpotifyShareItem } from "@wave/core";
import { findSpotifyRecording, shareSpotifyPlaylist } from "./playlistShare.ts";
import type { SpotifyRequest, SpotifyRequestInit } from "./spotifyAccount.ts";

const song = (title: string, durationMs = 200_000): SpotifyShareItem => ({
  source: "library",
  song: { title, artists: ["Ana"], album: "Mar", durationMs },
});

interface FakePlaylist {
  name: string;
  public: boolean;
  uris: string[];
  /** Out of the account's library: deleted on Spotify. */
  deleted?: boolean;
  /** Another account's: this one can't edit it. */
  foreign?: boolean;
}

/** The parts of Spotify's Web API sharing asks, holding an account's playlists in memory. */
const fakeSpotify = (catalogue: readonly string[]) => {
  const playlists = new Map<string, FakePlaylist>();
  const asked: string[] = [];
  let made = 0;
  const state = {
    status: "signedIn" as "signedIn" | "signedOut" | "expired",
    offline: false,
    /** Answers these paths' next request with this status. */
    fail: new Map<string, number[]>(),
    retryAfter: "1",
  };
  const request = async (path: string, init?: SpotifyRequestInit): Promise<SpotifyRequest> => {
    if (state.status !== "signedIn") return { status: state.status };
    if (state.offline) return { status: "offline" };
    const url = new URL(path, "https://api.spotify.com");
    const method = init?.method ?? "GET";
    asked.push(`${method} ${url.pathname}`);
    const failing = state.fail.get(`${method} ${url.pathname}`)?.shift();
    if (failing !== undefined)
      return {
        status: "response",
        response: new Response(null, {
          status: failing,
          headers: failing === 429 ? { "retry-after": state.retryAfter } : {},
        }),
      };
    const body: unknown = init?.body === undefined ? undefined : JSON.parse(init.body);
    const ok = (value: unknown, status = 200): SpotifyRequest => ({
      status: "response",
      response: Response.json(value, { status }),
    });
    if (method === "GET" && url.pathname === "/v1/search") {
      assert.equal(url.searchParams.get("type"), "track");
      assert.ok(Number(url.searchParams.get("limit")) <= 10);
      const query = url.searchParams.get("q") ?? "";
      return ok({
        tracks: {
          items: catalogue
            .filter((title) => query === `${title} Ana`)
            .map((title) => ({
              id: title,
              uri: `spotify:track:${title}`,
              name: title,
              artists: [{ name: "Ana" }],
              album: { name: "Mar" },
              duration_ms: 201_000,
            })),
        },
      });
    }
    if (method === "POST" && url.pathname === "/v1/me/playlists") {
      const id = `made${++made}`;
      const { name, public: open } = body as { name: string; public: boolean };
      playlists.set(id, { name, public: open, uris: [] });
      return ok({ id }, 201);
    }
    if (method === "GET" && url.pathname === "/v1/me/library/contains") {
      const uris = (url.searchParams.get("uris") ?? "").split(",");
      return ok(
        uris.map((uri) => {
          const playlist = playlists.get(uri.replace("spotify:playlist:", ""));
          return playlist !== undefined && !playlist.deleted && !playlist.foreign;
        }),
      );
    }
    const [, id, items] = /^\/v1\/playlists\/([^/]+)(\/items)?$/u.exec(url.pathname) ?? [];
    const playlist = id === undefined ? undefined : playlists.get(id);
    if (playlist === undefined) return ok({ error: { status: 404 } }, 404);
    if (playlist.foreign) return ok({ error: { status: 403 } }, 403);
    if (items === undefined && method === "PUT") {
      Object.assign(playlist, body as object);
      return ok(null);
    }
    if (items !== undefined && (method === "PUT" || method === "POST")) {
      const { uris } = body as { uris: string[] };
      assert.ok(uris.length <= 100);
      playlist.uris = method === "PUT" ? uris : [...playlist.uris, ...uris];
      return ok({ snapshot_id: "s" }, method === "PUT" ? 200 : 201);
    }
    return ok({ error: { status: 405 } }, 405);
  };
  return { request, playlists, asked, state };
};

const sharing = (spotify: ReturnType<typeof fakeSpotify>) => {
  const memory = { id: undefined as string | undefined };
  const clipboard: string[] = [];
  const waits: number[] = [];
  const share = (name: string, items: readonly SpotifyShareItem[]) =>
    shareSpotifyPlaylist({
      name,
      items,
      session: () => spotify.state.status,
      request: spotify.request,
      recall: () => memory.id,
      remember: (id) => {
        memory.id = id;
      },
      writeClipboard: (text) => clipboard.push(text),
      sleep: async (ms) => {
        waits.push(ms);
      },
    });
  return { share, memory, clipboard, waits };
};

test("sharing makes a public playlist with the songs Spotify has, in order, and copies its link", async () => {
  const spotify = fakeSpotify(["Sol", "Lua", "Rio"]);
  const { share, clipboard } = sharing(spotify);
  const outcome = await share("Viagem", [song("Rio"), song("Nada"), song("Sol"), song("Lua")]);
  assert.deepEqual(outcome, { kind: "shared", found: 3, total: 4 });
  assert.deepEqual(spotify.playlists.get("made1"), {
    name: "Viagem",
    public: true,
    uris: ["spotify:track:Rio", "spotify:track:Sol", "spotify:track:Lua"],
  });
  assert.deepEqual(clipboard, ["https://open.spotify.com/playlist/made1"]);
});

test("sharing again updates the same Spotify playlist and keeps its link", async () => {
  const spotify = fakeSpotify(["Sol", "Lua", "Rio"]);
  const { share, clipboard } = sharing(spotify);
  await share("Viagem", [song("Sol"), song("Lua")]);
  const outcome = await share("Viagem 2", [song("Rio"), song("Sol")]);
  assert.deepEqual(outcome, { kind: "shared", found: 2, total: 2 });
  assert.equal(spotify.playlists.size, 1);
  assert.deepEqual(spotify.playlists.get("made1"), {
    name: "Viagem 2",
    public: true,
    uris: ["spotify:track:Rio", "spotify:track:Sol"],
  });
  assert.deepEqual(clipboard, [
    "https://open.spotify.com/playlist/made1",
    "https://open.spotify.com/playlist/made1",
  ]);
});

test("a long playlist goes in requests of 100 songs, in order, each song once", async () => {
  const titles = Array.from({ length: 230 }, (_, index) => `Faixa ${index}`);
  const spotify = fakeSpotify(titles);
  const { share } = sharing(spotify);
  const outcome = await share(
    "Longa",
    [...titles, "Faixa 0"].map((title) => song(title)),
  );
  assert.deepEqual(outcome, { kind: "shared", found: 231, total: 231 });
  assert.deepEqual(
    spotify.playlists.get("made1")?.uris,
    titles.map((title) => `spotify:track:${title}`),
  );
  // Shared again, the first request replaces the songs rather than adding to them.
  await share(
    "Longa",
    titles.map((title) => song(title)),
  );
  assert.equal(spotify.playlists.get("made1")?.uris.length, 230);
});

test("a playlist deleted on Spotify, or another account's, is made again", async () => {
  const spotify = fakeSpotify(["Sol"]);
  const { share, clipboard, memory } = sharing(spotify);
  await share("Viagem", [song("Sol")]);
  spotify.playlists.get("made1")!.deleted = true;
  await share("Viagem", [song("Sol")]);
  assert.equal(memory.id, "made2");
  assert.deepEqual(spotify.playlists.get("made1")?.uris, ["spotify:track:Sol"]);
  spotify.playlists.get("made2")!.foreign = true;
  assert.deepEqual(await share("Viagem", [song("Sol")]), { kind: "shared", found: 1, total: 1 });
  assert.equal(clipboard.at(-1), "https://open.spotify.com/playlist/made3");
});

test("signed out, sharing asks for the sign-in and sends Spotify nothing", async () => {
  const spotify = fakeSpotify(["Sol"]);
  const { share, clipboard } = sharing(spotify);
  spotify.state.status = "signedOut";
  assert.deepEqual(await share("Viagem", [song("Sol")]), { kind: "signIn", again: false });
  spotify.state.status = "expired";
  assert.deepEqual(await share("Viagem", [song("Sol")]), { kind: "signIn", again: true });
  assert.deepEqual(spotify.asked, []);
  assert.deepEqual(clipboard, []);
});

test("a playlist with no song on Spotify makes no playlist there", async () => {
  const spotify = fakeSpotify([]);
  const { share, clipboard } = sharing(spotify);
  const noArtist: SpotifyShareItem = {
    source: "library",
    song: { title: "Sol", artists: [], album: null, durationMs: null },
  };
  assert.deepEqual(await share("Viagem", [song("Sol"), noArtist]), { kind: "nothingFound" });
  assert.deepEqual(await share("Vazia", []), { kind: "nothingFound" });
  assert.equal(spotify.playlists.size, 0);
  assert.deepEqual(clipboard, []);
});

test("sharing says why it stopped, and copies nothing", async () => {
  const spotify = fakeSpotify(["Sol"]);
  const { share, clipboard } = sharing(spotify);
  spotify.state.offline = true;
  assert.deepEqual(await share("Viagem", [song("Sol")]), { kind: "failed", reason: "offline" });
  spotify.state.offline = false;

  spotify.state.fail.set("GET /v1/search", [500]);
  assert.deepEqual(await share("Viagem", [song("Sol")]), {
    kind: "failed",
    reason: "noSearchAnswer",
  });
  spotify.state.fail.set("POST /v1/me/playlists", [403]);
  assert.deepEqual(await share("Viagem", [song("Sol")]), { kind: "failed", reason: "failed" });
  spotify.state.fail.set("POST /v1/playlists/made1/items", [500]);
  spotify.state.fail.set("PUT /v1/playlists/made1/items", [500]);
  assert.deepEqual(await share("Viagem", [song("Sol")]), { kind: "failed", reason: "failed" });
  assert.deepEqual(clipboard, []);
  // The playlist it made is remembered, so the next share fills that one.
  assert.deepEqual(await share("Viagem", [song("Sol")]), { kind: "shared", found: 1, total: 1 });
  assert.equal(spotify.playlists.size, 1);
  assert.deepEqual(clipboard, ["https://open.spotify.com/playlist/made1"]);
});

test("a session Spotify ends while sharing stops it as signed out", async () => {
  const spotify = fakeSpotify(["Sol"]);
  const request = spotify.request;
  spotify.request = async (path, init) =>
    path.startsWith("/v1/search") ? { status: "expired" } : request(path, init);
  const { share } = sharing(spotify);
  assert.deepEqual(await share("Viagem", [song("Sol")]), { kind: "failed", reason: "signedOut" });
});

test("a rate limit is waited out for as long as Spotify asks, then the request goes again", async () => {
  const spotify = fakeSpotify(["Sol"]);
  const { share, waits } = sharing(spotify);
  spotify.state.retryAfter = "2";
  spotify.state.fail.set("GET /v1/search", [429, 429]);
  assert.deepEqual(await share("Viagem", [song("Sol")]), { kind: "shared", found: 1, total: 1 });
  assert.deepEqual(waits, [2_000, 2_000]);
  spotify.state.fail.set("GET /v1/search", [429, 429, 429, 429]);
  assert.deepEqual(await share("Viagem", [song("Sol")]), {
    kind: "failed",
    reason: "noSearchAnswer",
  });
});

test("one recording is found on Spotify by its title and artists", async () => {
  const spotify = fakeSpotify(["Sol"]);
  const wanted = { title: "Sol", artists: ["Ana"], album: "Mar", durationMs: 200_000 };
  assert.deepEqual(await findSpotifyRecording(spotify.request, wanted), {
    ok: true,
    uri: "spotify:track:Sol",
  });
  assert.deepEqual(await findSpotifyRecording(spotify.request, { ...wanted, title: "Nada" }), {
    ok: true,
    uri: null,
  });
  spotify.state.offline = true;
  assert.deepEqual(await findSpotifyRecording(spotify.request, wanted), {
    ok: false,
    reason: "offline",
  });
});
