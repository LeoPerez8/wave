import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { Database } from "@wave/client";
import { createPlaylist } from "@wave/client/db/playlists";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { catalogueOf, sharePlaylistFailureLine, sharedSongsCopiedLine } from "@wave/core";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";

const text = catalogueOf("en", "desktop");

interface FakePlaylist {
  name: string;
  public: boolean;
  uris: string[];
}

test("Share to Spotify signs in, makes the playlist, copies its link and updates it next time", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-spotify-share-"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      const tracks = ["Sol", "Nada", "Lua"].map((title, index) => ({
        source: "library" as const,
        trackId: addTrack(db, {
          title,
          album: "Mar",
          artist: "Ana",
          trackNumber: index + 1,
          durationMs: 200_000,
        }),
      }));
      createPlaylist(db, "Viagem", tracks, 1000);
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [join(import.meta.dirname, ".."), "--lang=en-US"],
    env: {
      ...process.env,
      WAVE_DATA_DIR: data,
      WAVE_MUSIC_DIR: join(data, "Absent"),
      WAVE_SPOTIFY_CLIENT_ID: "e2e-spotify-client",
    },
  });
  try {
    // Spotify's sign-in page and Web API, answered in main: an account holding the songs Sol and Lua.
    await app.evaluate(({ shell }) => {
      const realFetch = globalThis.fetch;
      const playlists: Record<string, FakePlaylist> = {};
      const fake = { playlists, searchFails: false, signIns: 0 };
      (globalThis as unknown as { spotifyFake: typeof fake }).spotifyFake = fake;
      shell.openExternal = async (url) => {
        const asked = new URL(url);
        const callback = new URL(asked.searchParams.get("redirect_uri")!);
        callback.searchParams.set("state", asked.searchParams.get("state")!);
        callback.searchParams.set("code", "e2e-spotify-code");
        fake.signIns += 1;
        await realFetch(callback);
      };
      globalThis.fetch = async (input, init) => {
        const url = new URL(String(input));
        const method = init?.method ?? "GET";
        if (url.href === "https://accounts.spotify.com/api/token")
          return Response.json({
            access_token: "e2e-spotify-access",
            refresh_token: "e2e-spotify-refresh",
            expires_in: 3600,
          });
        if (url.origin !== "https://api.spotify.com") return realFetch(input, init);
        if (new Headers(init?.headers).get("authorization") !== "Bearer e2e-spotify-access")
          return new Response(null, { status: 401 });
        if (url.pathname === "/v1/me")
          return Response.json({ id: "ana", display_name: "Ana", images: [] });
        const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        if (url.pathname === "/v1/search") {
          if (fake.searchFails) return new Response(null, { status: 500 });
          const title = (url.searchParams.get("q") ?? "").replace(/ Ana$/u, "");
          return Response.json({
            tracks: {
              items: ["Sol", "Lua"]
                .filter((held) => held === title)
                .map((held) => ({
                  id: held,
                  uri: `spotify:track:${held}`,
                  name: held,
                  artists: [{ name: "Ana" }],
                  album: { name: "Mar" },
                  duration_ms: 201_500,
                })),
            },
          });
        }
        if (method === "POST" && url.pathname === "/v1/me/playlists") {
          const id = `e2ePlaylist${Object.keys(playlists).length + 1}`;
          playlists[id] = { ...(body as FakePlaylist), uris: [] };
          return Response.json({ id }, { status: 201 });
        }
        if (url.pathname === "/v1/me/library/contains")
          return Response.json(
            (url.searchParams.get("uris") ?? "")
              .split(",")
              .map((uri) => uri.replace("spotify:playlist:", "") in playlists),
          );
        const [, id, items] = /^\/v1\/playlists\/([^/]+)(\/items)?$/u.exec(url.pathname) ?? [];
        const playlist = id === undefined ? undefined : playlists[id];
        if (playlist === undefined) return new Response(null, { status: 404 });
        if (items === undefined) Object.assign(playlist, body);
        else {
          const { uris } = body as { uris: string[] };
          playlist.uris = method === "PUT" ? uris : [...playlist.uris, ...uris];
        }
        return Response.json({ snapshot_id: "e2e" });
      };
    });
    const fake = () =>
      app.evaluate(
        () =>
          (
            globalThis as unknown as {
              spotifyFake: { playlists: Record<string, FakePlaylist>; signIns: number };
            }
          ).spotifyFake,
      );
    const clipboard = () => app.evaluate(({ clipboard }) => clipboard.readText());
    const link = "https://open.spotify.com/playlist/e2ePlaylist1";

    const page = await app.firstWindow();
    const menu = page.getByRole("menu");
    const playlist = page
      .locator(".sidebar-playlists")
      .getByRole("button", { name: "Viagem", exact: true });
    const share = async () => {
      await playlist.click({ button: "right" });
      await menu.getByRole("menuitem", { name: text.share.shareToSpotify, exact: true }).click();
    };
    const toast = (message: string) => page.getByRole("status").filter({ hasText: message });
    const dialog = page.getByRole("alertdialog");

    // Signed out, the action asks for the sign-in first; giving it up shares nothing.
    await share();
    await expect(dialog).toContainText(text.share.signInTitle("Spotify"));
    await expect(dialog).toContainText(text.share.signInMessage.spotify);
    await page.screenshot({
      path: test.info().outputPath(`spotify-share-sign-in-${process.platform}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    expect((await fake()).signIns).toBe(0);

    await app.evaluate(({ clipboard }) => clipboard.writeText("before sharing"));
    await share();
    await dialog.getByRole("button", { name: text.share.signIn, exact: true }).click();
    const found = sharedSongsCopiedLine({ found: 2, total: 3 }, text);
    expect(found).toBe("2 of 3 songs found. Link copied.");
    await expect(toast(found)).toBeVisible();
    expect(await clipboard()).toBe(link);
    expect(await fake()).toEqual({
      signIns: 1,
      searchFails: false,
      playlists: {
        e2ePlaylist1: {
          name: "Viagem",
          public: true,
          uris: ["spotify:track:Sol", "spotify:track:Lua"],
        },
      },
    });
    await page.screenshot({
      path: test.info().outputPath(`spotify-share-toast-${process.platform}.png`),
    });

    // Shared again, signed in: the same Spotify playlist, under the same link.
    await expect(toast(found)).toBeHidden({ timeout: 15_000 });
    await app.evaluate(({ clipboard }) => clipboard.writeText("before sharing again"));
    await share();
    await expect(toast(found)).toBeVisible();
    expect(await clipboard()).toBe(link);
    const again = await fake();
    expect(again.signIns).toBe(1);
    expect(Object.keys(again.playlists)).toEqual(["e2ePlaylist1"]);
    expect(again.playlists["e2ePlaylist1"]?.uris).toEqual([
      "spotify:track:Sol",
      "spotify:track:Lua",
    ]);

    // A failure says why, and leaves the clipboard alone.
    await app.evaluate(() => {
      (globalThis as unknown as { spotifyFake: { searchFails: boolean } }).spotifyFake.searchFails =
        true;
    });
    await app.evaluate(({ clipboard }) => clipboard.writeText("before the failure"));
    await share();
    await expect(dialog).toContainText(text.share.shareFailed);
    await expect(dialog).toContainText(sharePlaylistFailureLine("spotify", "noSearchAnswer", text));
    expect(await clipboard()).toBe("before the failure");
    await page.screenshot({
      path: test.info().outputPath(`spotify-share-failed-${process.platform}.png`),
    });
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
