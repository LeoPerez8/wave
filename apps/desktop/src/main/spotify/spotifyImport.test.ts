import assert from "node:assert/strict";
import { test } from "node:test";
import { selectPlaylistEntries, selectPlaylists } from "@wave/client/db/playlists";
import {
  addTrack,
  closeTestDatabase,
  openTestDatabase,
  type TestDatabase,
} from "@wave/client/testing";
import { catalogueOf, type SpotifySession } from "@wave/core";
import { sql } from "drizzle-orm";
import type { SpotifyRequest } from "./spotifyAccount.ts";
import { createSpotifyImport } from "./spotifyImport.ts";

const text = catalogueOf("en", "desktop");
const API = "https://api.spotify.com";

const track = (name: string, artist: string, durationMs: number) => ({
  item: {
    type: "track",
    name,
    artists: [{ name: artist }],
    album: { name: "Album", images: [] },
    duration_ms: durationMs,
  },
});

const list = (items: readonly unknown[], next: string | null = null) => ({
  items,
  total: items.length,
  next,
});

/** A signed-in account whose Web API answers [routes] by path; a function answers each time. */
const fakeAccount = (routes: Record<string, unknown>) => {
  const state = {
    session: { status: "signedIn", account: { name: "Ana", photoUrl: null } } as SpotifySession,
    configured: true,
    signIns: 0,
    /** What a sign-in leaves the session as. */
    signInEnds: null as SpotifySession | null,
    failure: null as "offline" | "failed" | null,
    requests: [] as string[],
  };
  return {
    state,
    account: {
      session: () => state.session,
      view: () => ({
        configured: state.configured,
        keyringMissing: false,
        account:
          state.session.status === "signedIn"
            ? ({ kind: "account", account: state.session.account, action: "signOut" } as const)
            : ({
                kind: "signedOut",
                action: state.session.status === "expired" ? "signInAgain" : "signIn",
                note:
                  state.failure ?? (state.session.status === "expired" ? "expired" : "optional"),
              } as const),
      }),
      signIn: async () => {
        state.signIns += 1;
        if (state.signInEnds !== null) state.session = state.signInEnds;
      },
      request: async (path: string): Promise<SpotifyRequest> => {
        state.requests.push(path);
        if (state.session.status !== "signedIn")
          return { status: state.session.status === "expired" ? "expired" : "signedOut" };
        const route = routes[path];
        const answer = typeof route === "function" ? (route as () => unknown)() : route;
        if (answer === undefined)
          return { status: "response", response: new Response(null, { status: 404 }) };
        if (answer instanceof Response) return { status: "response", response: answer };
        if (answer === "offline" || answer === "failed" || answer === "expired")
          return { status: answer };
        return { status: "response", response: Response.json(answer) };
      },
    },
  };
};

const LIBRARY = {
  "/v1/me/tracks?limit=1": { items: [{}], total: 2, next: `${API}/v1/me/tracks?offset=1&limit=1` },
  "/v1/me/playlists?limit=50&offset=0": list([
    { id: "road", name: "Road trip", images: [], items: { total: 3 } },
    { id: "gym", name: "Gym", images: [], items: { total: 1 } },
  ]),
};

const withDatabase = async (run: (db: TestDatabase) => Promise<void>) => {
  const db = await openTestDatabase();
  try {
    db.run(sql`CREATE TABLE desktop_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL)`);
    await run(db);
  } finally {
    closeTestDatabase(db);
  }
};

interface FoundSong {
  readonly videoId: string;
  readonly title: string;
  readonly artists: readonly string[];
  readonly album: string | null;
  readonly albumId: string | null;
  readonly durationMs: number;
  readonly artworkUrl: string | null;
  readonly explicit: boolean;
}

/** What the fakes of YT Music and the downloads were asked. */
const recorded = () => ({
  searches: [] as string[],
  kept: [] as string[],
  queued: [] as string[][],
  lists: [] as unknown[],
});

const importer = (
  db: TestDatabase,
  fake: ReturnType<typeof fakeAccount>,
  options: {
    ytMusicOn?: boolean;
    waits?: number[];
    /** YT Music's songs for a search, or why it had no answer; offline unless given. */
    search?: (query: string) => readonly FoundSong[] | "offline";
    asked?: ReturnType<typeof recorded>;
  } = {},
) => {
  let changes = 0;
  const asked = options.asked ?? recorded();
  return {
    changes: () => changes,
    asked,
    spotify: createSpotifyImport({
      db,
      account: fake.account,
      yt: {
        enabled: () => options.ytMusicOn ?? true,
        search: async (query) => {
          asked.searches.push(query);
          const found = options.search?.(query) ?? "offline";
          return found === "offline"
            ? { status: "offline", songs: [] }
            : { status: "ok", songs: found };
        },
        keep: (songs) => {
          asked.kept.push(...songs.map((song) => song.videoId));
        },
      },
      downloads: {
        yt: async (videoIds) => {
          asked.queued.push([...videoIds]);
        },
        missingAction: async (action, target) => {
          asked.lists.push([action, target]);
        },
      },
      changed: () => {
        changes += 1;
      },
      wait: async (ms) => {
        options.waits?.push(ms);
      },
    }),
  };
};

const entryTitles = (db: TestDatabase, playlistId: number) =>
  selectPlaylistEntries(db, playlistId).map((entry) =>
    entry.source === "library"
      ? `library:${entry.track.title}`
      : `${entry.source}:${entry.song.title}`,
  );

test("the picker lists Liked Songs first and Import makes each picked playlist in Spotify's order", async () => {
  await withDatabase(async (db) => {
    addTrack(db, { title: "Airbag", artist: "Radiohead", durationMs: 284_000 });
    const fake = fakeAccount({
      ...LIBRARY,
      "/v1/playlists/road/items?limit=50&offset=0": {
        ...list(
          [track("Lucky", "Radiohead", 259_000), track("Airbag", "Radiohead", 284_500)],
          `${API}/v1/playlists/road/items?offset=2&limit=50`,
        ),
        total: 3,
      },
      "/v1/playlists/road/items?offset=2&limit=50": {
        ...list([track("No Surprises", "Radiohead", 229_000)]),
        total: 3,
      },
      "/v1/me/tracks?limit=50&offset=0": list([
        { track: track("Nude", "Radiohead", 255_000).item },
        { track: track("Airbag", "Radiohead", 284_000).item },
      ]),
    });
    const { spotify, changes, asked } = importer(db, fake);

    const library = await spotify.library(false, "en");
    assert.equal(fake.state.signIns, 0);
    assert.ok(library.status === "ready");
    assert.deepEqual(
      library.rows.map((row) => [row.playlistId, row.title, row.line, row.imported, row.ticked]),
      [
        ["spotify:collection", "Liked Songs", "2 songs", false, true],
        ["spotify:playlist:road", "Road trip", "3 songs", false, true],
        ["spotify:playlist:gym", "Gym", "1 song", false, true],
      ],
    );

    const result = await spotify.run(["spotify:playlist:road", "spotify:collection"], false, "en");
    assert.deepEqual(result.failure, null);
    assert.equal(result.skipped, 0);
    // In the picker's order, whatever order the window named them in.
    assert.deepEqual(
      result.imported.map((made) => made.name),
      ["Liked Songs", "Road trip"],
    );
    const [liked, road] = result.imported;
    assert.deepEqual(entryTitles(db, liked!.playlistId), ["unsearched:Nude", "library:Airbag"]);
    assert.deepEqual(entryTitles(db, road!.playlistId), [
      "unsearched:Lucky",
      "library:Airbag",
      "unsearched:No Surprises",
    ]);
    await spotify.idle();
    assert.deepEqual(asked.lists, []);
    assert.ok(changes() > 0);

    // The picker marks them imported, unticked; importing one again refreshes its playlist.
    const again = await spotify.library(false, "en");
    assert.ok(again.status === "ready");
    assert.deepEqual(
      again.rows.map((row) => [row.title, row.imported, row.ticked]),
      [
        ["Liked Songs", true, false],
        ["Road trip", true, false],
        ["Gym", false, true],
      ],
    );
    const refreshed = await spotify.run(["spotify:playlist:road"], true, "en");
    assert.deepEqual(refreshed.imported, [{ playlistId: road!.playlistId, name: "Road trip" }]);
    assert.equal(selectPlaylists(db).length, 2);
    await spotify.idle();
    assert.deepEqual(asked.lists, [["downloadAll", { kind: "playlist", id: road!.playlistId }]]);
  });
});

test("a playlist Spotify won't give is skipped, and the others still import", async () => {
  await withDatabase(async (db) => {
    const fake = fakeAccount({
      ...LIBRARY,
      "/v1/playlists/road/items?limit=50&offset=0": new Response(null, { status: 403 }),
      "/v1/playlists/gym/items?limit=50&offset=0": list([track("Stronger", "Kanye West", 311_000)]),
    });
    const { spotify } = importer(db, fake);
    await spotify.library(false, "en");
    const result = await spotify.run(
      ["spotify:playlist:road", "spotify:playlist:gym"],
      false,
      "en",
    );
    assert.deepEqual(
      result.imported.map((made) => made.name),
      ["Gym"],
    );
    assert.equal(result.skipped, 1);
    assert.equal(result.failure, null);
    assert.deepEqual(
      selectPlaylists(db).map((playlist) => playlist.name),
      ["Gym"],
    );
  });
});

test("a read that fails says why with Try Again, and an ended session offers Sign In Again", async () => {
  await withDatabase(async (db) => {
    const routes: Record<string, unknown> = {
      ...LIBRARY,
      "/v1/me/playlists?limit=50&offset=0": "offline",
    };
    const fake = fakeAccount(routes);
    const { spotify } = importer(db, fake);
    assert.deepEqual(await spotify.library(false, "en"), {
      status: "failed",
      line: text.imports.offline,
      action: "tryAgain",
    });
    routes["/v1/me/playlists?limit=50&offset=0"] = new Response(null, { status: 500 });
    assert.deepEqual(await spotify.library(false, "pt-BR"), {
      status: "failed",
      line: catalogueOf("pt-BR", "desktop").imports.spotifyLibraryFailed,
      action: "tryAgain",
    });

    // An ended session: Sign In Again signs in, then the picker opens.
    routes["/v1/me/playlists?limit=50&offset=0"] = LIBRARY["/v1/me/playlists?limit=50&offset=0"];
    fake.state.session = { status: "expired", account: null };
    assert.deepEqual(await spotify.library(false, "en"), {
      status: "failed",
      line: text.imports.spotifySignedOut,
      action: "signIn",
    });
    assert.equal(fake.state.signIns, 0);
    fake.state.signInEnds = { status: "signedIn", account: { name: "Ana", photoUrl: null } };
    assert.equal((await spotify.library(true, "en")).status, "ready");
    assert.equal(fake.state.signIns, 1);

    // A session that ends during Import stops it there, keeping what was made.
    routes["/v1/playlists/road/items?limit=50&offset=0"] = list([track("Lucky", "Radiohead", 1)]);
    routes["/v1/playlists/gym/items?limit=50&offset=0"] = () => {
      fake.state.session = { status: "expired", account: null };
      return "expired";
    };
    routes["/v1/me/tracks?limit=50&offset=0"] = list([]);
    const result = await spotify.run(
      ["spotify:playlist:road", "spotify:playlist:gym", "spotify:collection"],
      false,
      "en",
    );
    assert.deepEqual(
      result.imported.map((made) => made.name),
      ["Liked Songs", "Road trip"],
    );
    assert.deepEqual(result.failure, { line: text.imports.spotifySignedOut, action: "signIn" });
  });
});

test("signed out, From Spotify signs in before reading, and a cancelled sign-in opens nothing", async () => {
  await withDatabase(async (db) => {
    const fake = fakeAccount(LIBRARY);
    fake.state.session = { status: "signedOut" };
    const { spotify } = importer(db, fake);
    assert.deepEqual(await spotify.library(false, "en"), { status: "signedOut" });
    assert.equal(fake.state.signIns, 1);
    assert.deepEqual(fake.state.requests, []);

    fake.state.failure = "offline";
    assert.deepEqual(await spotify.library(false, "en"), {
      status: "failed",
      line: text.settings.spotifySignInFailures.offline,
      action: "signIn",
    });
    fake.state.failure = null;

    fake.state.signInEnds = { status: "signedIn", account: { name: "Ana", photoUrl: null } };
    assert.equal((await spotify.library(false, "en")).status, "ready");
    assert.equal(fake.state.signIns, 3);
  });
});

test("From Spotify needs YT Music on and a build with a Spotify client", async () => {
  await withDatabase(async (db) => {
    const fake = fakeAccount(LIBRARY);
    const off = importer(db, fake, { ytMusicOn: false }).spotify;
    assert.deepEqual(await off.library(false, "en"), {
      status: "failed",
      line: text.imports.ytMusicOffInSettings,
      action: null,
    });
    await assert.rejects(off.run(["spotify:collection"], false, "en"));
    fake.state.configured = false;
    assert.deepEqual(await importer(db, fake).spotify.library(false, "en"), {
      status: "failed",
      line: text.desktopAccount.spotifyUnavailable,
      action: null,
    });
    assert.deepEqual(fake.state.requests, []);
  });
});

test("Import only takes sources the picker listed", async () => {
  await withDatabase(async (db) => {
    const fake = fakeAccount(LIBRARY);
    const { spotify } = importer(db, fake);
    await assert.rejects(spotify.run(["spotify:collection"], false, "en"), /library/i);
    await spotify.library(false, "en");
    await assert.rejects(spotify.run(["spotify:playlist:other"], false, "en"), /listed/i);
    assert.equal(selectPlaylists(db).length, 0);
  });
});

test("Spotify asking to slow down is waited out once", async () => {
  await withDatabase(async (db) => {
    let limited = true;
    const waits: number[] = [];
    const fake = fakeAccount({
      ...LIBRARY,
      "/v1/me/playlists?limit=50&offset=0": () => {
        if (!limited) return LIBRARY["/v1/me/playlists?limit=50&offset=0"];
        limited = false;
        return new Response(null, { status: 429, headers: { "retry-after": "2" } });
      },
    });
    const { spotify } = importer(db, fake, { waits });
    assert.equal((await spotify.library(false, "en")).status, "ready");
    assert.deepEqual(waits, [2_000]);
  });
});

test("Cancel stops an import between playlists", async () => {
  await withDatabase(async (db) => {
    const cancel = { run: () => {} };
    const fake = fakeAccount({
      ...LIBRARY,
      "/v1/playlists/road/items?limit=50&offset=0": () => {
        cancel.run();
        return list([track("Lucky", "Radiohead", 1)]);
      },
      "/v1/playlists/gym/items?limit=50&offset=0": list([track("Stronger", "Kanye West", 1)]),
    });
    const { spotify } = importer(db, fake);
    cancel.run = spotify.cancel;
    await spotify.library(false, "en");
    const result = await spotify.run(
      ["spotify:playlist:road", "spotify:playlist:gym"],
      false,
      "en",
    );
    assert.deepEqual(result, { imported: [], skipped: 0, failure: null });
    assert.equal(selectPlaylists(db).length, 0);
  });
});

const LUCKY: FoundSong = {
  videoId: "luckyvideo1",
  title: "Lucky",
  artists: ["Radiohead"],
  album: "OK Computer",
  albumId: null,
  durationMs: 259_500,
  artworkUrl: null,
  explicit: false,
};

const ROAD_OF_FOUR = {
  ...LIBRARY,
  "/v1/playlists/road/items?limit=50&offset=0": list([
    track("Lucky", "Radiohead", 259_000),
    track("Airbag", "Radiohead", 284_000),
    track("Nowhere Song", "Nobody", 100_000),
    track("Later", "Radiohead", 200_000),
  ]),
};

/** YT Music has Lucky, has nothing for Nowhere Song, and doesn't answer for Later. */
const searchOf = (query: string) =>
  query.startsWith("Later") ? "offline" : query.startsWith("Lucky") ? [LUCKY] : [];

test("an imported playlist lists the songs the Library lacks, and YT Music fills them in", async () => {
  await withDatabase(async (db) => {
    addTrack(db, { title: "Airbag", artist: "Radiohead", durationMs: 284_000 });
    let now = 1_000_000;
    const asked = recorded();
    const spotify = createSpotifyImport({
      db,
      account: fakeAccount(ROAD_OF_FOUR).account,
      yt: {
        enabled: () => true,
        search: async (query) => {
          asked.searches.push(query);
          const found = searchOf(query);
          return found === "offline"
            ? { status: "offline", songs: [] }
            : { status: "ok", songs: found };
        },
        keep: (songs) => {
          asked.kept.push(...songs.map((song) => song.videoId));
        },
      },
      downloads: {
        yt: async (videoIds) => {
          asked.queued.push([...videoIds]);
        },
        missingAction: async (action, target) => {
          asked.lists.push([action, target]);
        },
      },
      changed: () => {},
      now: () => now,
    });
    await spotify.library(false, "en");
    const { imported } = await spotify.run(["spotify:playlist:road"], false, "en");
    const playlistId = imported[0]!.playlistId;
    // Until YT Music answers, each one is listed as it came from Spotify.
    const before = spotify.missing(playlistId);
    assert.equal(before.finding, true);
    assert.deepEqual(before.songs, [
      { title: "Lucky", artist: "Radiohead", state: "unsearched" },
      { title: "Nowhere Song", artist: "Nobody", state: "unsearched" },
      { title: "Later", artist: "Radiohead", state: "unsearched" },
    ]);

    await spotify.idle();
    assert.deepEqual(asked.searches, ["Lucky Radiohead", "Nowhere Song Nobody", "Later Radiohead"]);
    // Found, in the Library, not found, and still to look up after the search with no answer.
    assert.deepEqual(entryTitles(db, playlistId), [
      "stream:Lucky",
      "library:Airbag",
      "unavailable:Nowhere Song",
      "unsearched:Later",
    ]);
    assert.deepEqual(asked.kept, ["luckyvideo1"]);
    // Plain Import downloads nothing.
    assert.deepEqual([asked.queued, asked.lists], [[], []]);

    // The page asks again: nothing is searched until a while after the search with no answer.
    assert.deepEqual(spotify.missing(playlistId), {
      total: 2,
      songs: [
        { title: "Nowhere Song", artist: "Nobody", state: "notFound" },
        { title: "Later", artist: "Radiohead", state: "unsearched" },
      ],
      finding: false,
    });
    await spotify.idle();
    assert.equal(asked.searches.length, 3);
    now += 61_000;
    assert.equal(spotify.missing(playlistId).finding, true);
    await spotify.idle();
    assert.deepEqual(asked.searches.slice(3), ["Later Radiohead"]);
    assert.deepEqual(spotify.missing(999), { total: 0, songs: [], finding: false });
  });
});

test("Import & Download also queues the songs the Library lacks", async () => {
  await withDatabase(async (db) => {
    addTrack(db, { title: "Airbag", artist: "Radiohead", durationMs: 284_000 });
    const { spotify, asked } = importer(db, fakeAccount(ROAD_OF_FOUR), { search: searchOf });
    await spotify.library(false, "en");
    const { imported } = await spotify.run(["spotify:playlist:road"], true, "en");
    const playlistId = imported[0]!.playlistId;
    await spotify.idle();
    assert.deepEqual(asked.lists, [["downloadAll", { kind: "playlist", id: playlistId }]]);
    assert.deepEqual(asked.queued, [["luckyvideo1"]]);
    assert.deepEqual(entryTitles(db, playlistId), [
      "stream:Lucky",
      "library:Airbag",
      "unavailable:Nowhere Song",
      "unsearched:Later",
    ]);
  });
});

test("a row's cover is read from Spotify's image servers, only for a playlist the picker listed", async () => {
  await withDatabase(async (db) => {
    const fake = fakeAccount({
      ...LIBRARY,
      "/v1/me/playlists?limit=50&offset=0": list([
        { id: "road", name: "Road trip", images: [{ url: "https://i.scdn.co/image/road" }] },
        { id: "gym", name: "Gym", images: [{ url: "https://elsewhere.test/image/gym" }] },
        { id: "odd", name: "Odd", images: [{ url: "http://i.scdn.co/image/odd" }] },
      ]),
    });
    const fetched: string[] = [];
    const spotify = createSpotifyImport({
      db,
      account: fake.account,
      yt: {
        enabled: () => true,
        search: async () => ({ status: "offline", songs: [] }),
        keep: () => {},
      },
      downloads: { yt: async () => {}, missingAction: async () => {} },
      changed: () => {},
      fetch: async (input) => {
        fetched.push(String(input));
        return new Response(new Uint8Array([1, 2, 3]), {
          headers: { "content-type": "image/png" },
        });
      },
    });
    assert.equal(await spotify.artwork("spotify:playlist:road"), null);
    await spotify.library(false, "en");
    assert.equal(await spotify.artwork("spotify:playlist:road"), "data:image/png;base64,AQID");
    assert.equal(await spotify.artwork("spotify:playlist:gym"), null);
    assert.equal(await spotify.artwork("spotify:playlist:odd"), null);
    assert.equal(await spotify.artwork("spotify:collection"), null);
    assert.equal(await spotify.artwork("spotify:playlist:other"), null);
    assert.deepEqual(fetched, ["https://i.scdn.co/image/road"]);
  });
});
