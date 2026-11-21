import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test, type ElectronApplication } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { catalogueOf, scanPath } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";

/**
 * Import Playlists › From Spotify over the built app, against a fake of Spotify's browser and
 * Web API: the choice shows only with YT Music on, signed out it signs in first, the picker
 * lists Liked Songs then the playlists, Import makes the playlist, a later picker marks it
 * Imported, and a failed read and an ended session say so with Try Again and Sign In Again.
 */
const appFolder = join(import.meta.dirname, "..");
const text = catalogueOf("en", "desktop");
const PHOTO =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/2ioAAAAASUVORK5CYII=";
const ACCESS = "e2e-spotify-import-access";
const REFRESH = "e2e-spotify-import-refresh";
// Songs no service has, so the page lists them whether or not YT Music answers the lookup.
const ABSENT = ["Zzqx Wave Absent One", "Zzqx Wave Absent Two"] as const;

const launch = async (data: string) => {
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: {
      ...process.env,
      WAVE_DATA_DIR: data,
      WAVE_MUSIC_DIR: join(data, "Music"),
      WAVE_SPOTIFY_CLIENT_ID: "e2e-spotify-client",
    },
  });
  try {
    await app.evaluate(
      ({ shell }, fake) => {
        const realFetch = globalThis.fetch;
        shell.openExternal = async (url) => {
          const asked = new URL(url);
          if (asked.origin + asked.pathname !== "https://accounts.spotify.com/authorize")
            throw new Error("Expected Spotify's authorization page");
          const callback = new URL(asked.searchParams.get("redirect_uri")!);
          callback.searchParams.set("state", asked.searchParams.get("state")!);
          callback.searchParams.set("code", "e2e-spotify-code");
          await realFetch(callback);
        };
        const song = (name: string, artist: string, ms: number) => ({
          type: "track",
          name,
          artists: [{ name: artist }],
          album: { name: "OK Computer", images: [] },
          duration_ms: ms,
        });
        const list = (items: readonly unknown[]) => ({ items, total: items.length, next: null });
        const api = (url: URL): unknown => {
          switch (url.pathname) {
            case "/v1/me":
              return { id: "ana", display_name: "Ana", images: [] };
            case "/v1/me/tracks":
              return url.searchParams.get("limit") === "1"
                ? { items: [{}], total: 2, next: null }
                : list([
                    { track: song("Airbag", "Radiohead", 284_000) },
                    { track: song(fake.absent[0], "Qxzv Nobody", 100_000) },
                  ]);
            case "/v1/me/playlists":
              return list([
                {
                  id: "road",
                  name: "Road trip",
                  images: [{ url: "https://i.scdn.co/image/road" }],
                  items: { total: 3 },
                },
                { id: "gym", name: "Gym", images: [], items: { total: 1 } },
              ]);
            case "/v1/playlists/road/items":
              return list([
                { item: song(fake.absent[0], "Qxzv Nobody", 100_000) },
                { item: song("Airbag", "Radiohead", 284_000) },
                { item: song(fake.absent[1], "Qxzv Nobody", 120_000) },
              ]);
            default:
              // A playlist Spotify won't give this account (Gym's songs).
              return undefined;
          }
        };
        globalThis.fetch = async (input, init) => {
          const url = new URL(String(input));
          const revoked = process.env["WAVE_E2E_SPOTIFY_REVOKED"] === "1";
          if (url.href === "https://accounts.spotify.com/api/token")
            return revoked
              ? Response.json({ error: "invalid_grant" }, { status: 400 })
              : Response.json({
                  access_token: fake.access,
                  refresh_token: fake.refresh,
                  expires_in: 3600,
                });
          if (url.href === "https://i.scdn.co/image/road")
            return new Response(Buffer.from(fake.photo, "base64"), {
              headers: { "content-type": "image/png" },
            });
          if (url.origin !== "https://api.spotify.com") return realFetch(input, init);
          const authorized =
            new Headers(init?.headers).get("authorization") === `Bearer ${fake.access}`;
          if (revoked || !authorized) return new Response(null, { status: 401 });
          if (process.env["WAVE_E2E_SPOTIFY_DOWN"] === "1")
            return new Response(null, { status: 500 });
          const answer = api(url);
          return answer === undefined ? new Response(null, { status: 403 }) : Response.json(answer);
        };
      },
      { access: ACCESS, refresh: REFRESH, photo: PHOTO, absent: ABSENT },
    );
    return app;
  } catch (error) {
    await app.close();
    throw error;
  }
};

test("From Spotify signs in, lists the account's playlists and imports the ones picked", async () => {
  test.setTimeout(180_000);
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-spotify-import-"));
  mkdirSync(join(data, "Music"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      const id = addTrack(db, {
        title: "Airbag",
        artist: "Radiohead",
        album: "OK Computer",
        durationMs: 284_000,
      });
      const path = scanPath(join(data, "Music", "Airbag.mp3"), process.platform);
      db.run(sql`UPDATE tracks SET path=${path} WHERE id=${id}`);
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  let app: ElectronApplication | undefined;
  try {
    app = await launch(data);
    const main = app;
    const page = await app.firstWindow();
    const setEnv = (name: string, value: string) =>
      main.evaluate(
        (_, [key, to]) => {
          process.env[key!] = to;
        },
        [name, value],
      );
    const ytMusic = (on: boolean) =>
      page.evaluate(
        (value) => (window as unknown as { wave: WaveBridge }).wave.settings.setYtMusic(value),
        on,
      );
    const importPlaylists = async () => {
      await page.getByRole("button", { name: text.desktopLayout.playlists, exact: true }).click();
      await page.getByRole("button", { name: text.playlists.importPlaylists }).click();
    };
    const fromSpotify = page.getByRole("menuitem", { name: text.imports.fromSpotify });
    const picker = page.getByRole("dialog", { name: text.imports.importFromSpotify });
    const rows = picker.getByRole("listitem");
    const openPicker = async () => {
      await importPlaylists();
      await fromSpotify.click();
      await expect(picker).toBeVisible();
    };
    const cancel = () => picker.getByRole("button", { name: text.imports.cancel }).click();

    // With YT Music off, Import Playlists is the file picker alone.
    await main.evaluate(({ dialog }) => {
      const counted = globalThis as unknown as { fileDialogs: number };
      counted.fileDialogs = 0;
      dialog.showOpenDialog = async () => {
        counted.fileDialogs += 1;
        return { canceled: true, filePaths: [] };
      };
    });
    await ytMusic(false);
    await importPlaylists();
    await expect
      .poll(() =>
        main.evaluate(() => (globalThis as unknown as { fileDialogs: number }).fileDialogs),
      )
      .toBe(1);
    await expect(fromSpotify).toHaveCount(0);

    // With it on, the choice is there; signed out, From Spotify signs in before the picker.
    await ytMusic(true);
    await importPlaylists();
    await expect(page.getByRole("menuitem", { name: text.imports.fromFiles })).toBeVisible();
    await fromSpotify.click();
    await expect(rows).toHaveText([/^Liked Songs2 songs$/, /^Road trip3 songs$/, /^Gym1 song$/]);
    for (const box of await picker.getByRole("checkbox").all()) await expect(box).toBeChecked();
    await expect(rows.nth(1).locator("img")).toHaveAttribute(
      "src",
      `data:image/png;base64,${PHOTO}`,
    );
    const session = await page.evaluate(() =>
      (window as unknown as { wave: WaveBridge }).wave.spotifyAccount.view(),
    );
    expect(session.account.kind).toBe("account");
    // The window gets rows, never the account's tokens.
    const listed = await page.evaluate(() =>
      (window as unknown as { wave: WaveBridge }).wave.spotifyImport.library(false),
    );
    expect(JSON.stringify(listed)).not.toContain(ACCESS);
    expect(JSON.stringify(listed)).not.toContain(REFRESH);
    await page.screenshot({ path: join(appFolder, "test-results", "spotify-import-picker.png") });

    // Deselect All leaves nothing to import; Road trip and Gym are picked.
    const importButton = picker.getByRole("button", { name: text.imports.import, exact: true });
    await expect(
      picker.getByRole("button", { name: text.imports.importDownload, exact: true }),
    ).toBeEnabled();
    await picker.getByRole("button", { name: text.imports.deselectAll }).click();
    await expect(importButton).toBeDisabled();
    await expect(picker.getByRole("button", { name: text.imports.selectAll })).toBeVisible();
    await picker.getByRole("checkbox", { name: /Road trip/ }).check();
    await picker.getByRole("checkbox", { name: /Gym/ }).check();
    await importButton.click();

    // Road trip opens with the Library's song in place; Gym, which Spotify won't give, is said.
    await expect(picker).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Road trip" })).toBeVisible();
    await expect(
      page.getByRole("status").filter({ hasText: text.imports.importedName("Road trip") }),
    ).toBeVisible();
    await expect(page.getByText(text.imports.couldntImportPlaylist, { exact: true })).toBeVisible();
    await expect(page.getByRole("row", { name: /Airbag/ })).toBeVisible();
    await expect(
      page.locator(".sidebar-playlists").getByRole("button", { name: "Road trip", exact: true }),
    ).toBeVisible();
    // The two songs the Library lacks are listed, in Spotify's order, until YT Music finds them.
    const missing = page.getByTestId("missing-songs");
    await expect(missing).toHaveText(text.imports.notInLibrary(2));
    await missing.click();
    const missingList = page.getByRole("dialog", { name: text.imports.notInLibrary(2) });
    await expect(missingList.getByRole("listitem")).toHaveText([
      new RegExp(`^${ABSENT[0]}`),
      new RegExp(`^${ABSENT[1]}`),
    ]);
    await page.screenshot({ path: join(appFolder, "test-results", "spotify-import-missing.png") });
    await missingList.getByRole("button", { name: text.imports.ok }).click();

    // The picker marks what was imported before, and leaves it unticked.
    await openPicker();
    await expect(rows.nth(1)).toContainText(text.imports.imported);
    await expect(picker.getByRole("checkbox", { name: /Road trip/ })).not.toBeChecked();
    await expect(picker.getByRole("checkbox", { name: /Gym/ })).toBeChecked();
    await expect(rows.nth(2)).not.toContainText(text.imports.imported);
    await cancel();
    await expect(picker).toHaveCount(0);

    // A read that fails says why, and Try Again reads it.
    await setEnv("WAVE_E2E_SPOTIFY_DOWN", "1");
    await openPicker();
    await expect(picker.getByRole("alert")).toHaveText(text.imports.spotifyLibraryFailed);
    await setEnv("WAVE_E2E_SPOTIFY_DOWN", "0");
    await picker.getByRole("button", { name: text.imports.tryAgain }).click();
    await expect(rows).toHaveCount(3);
    await cancel();

    // An ended session says so, and Sign In Again signs in and opens the picker.
    await setEnv("WAVE_E2E_SPOTIFY_REVOKED", "1");
    await openPicker();
    await expect(picker.getByRole("alert")).toHaveText(text.imports.spotifySignedOut);
    await page.screenshot({ path: join(appFolder, "test-results", "spotify-import-ended.png") });
    await setEnv("WAVE_E2E_SPOTIFY_REVOKED", "0");
    await picker.getByRole("button", { name: text.imports.signInAgain }).click();
    await expect(rows).toHaveCount(3);
    await cancel();
    await expect(picker).toHaveCount(0);
  } finally {
    await app?.close();
    rmSync(data, { recursive: true, force: true });
  }
});
