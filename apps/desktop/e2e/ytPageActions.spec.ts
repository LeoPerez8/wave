import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { catalogueOf } from "@wave/core";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";

/**
 * Shuffle and Download Album on the YT Music pages (#1191): Shuffle beside Play on an artist's
 * and an album's page, the album's download button and head line as main words them, Try Again
 * on the quiet line, and a release the Library has opening the Library's album page. YouTube
 * Music, playback and the album's download are answered by handlers the test puts in main's
 * place, so nothing here asks the network; main's side has unit tests of its own.
 */
const appFolder = join(import.meta.dirname, "..");
const text = catalogueOf("en", "desktop");

const withDatabase = <A>(data: string, use: (db: TestDatabase) => A) =>
  Effect.runPromise(
    Effect.gen(function* () {
      return use((yield* Database) as unknown as TestDatabase);
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );

test("YT Music pages shuffle, an album downloads, a quiet line tries again and a Library release opens", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-ytactions-"));
  await withDatabase(data, (db) => {
    addTrack(db, { title: "Waterloo", album: "Waterloo", artist: "ABBA", durationMs: 180000 });
  });
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId("home")).toBeVisible();
    await app.evaluate(({ ipcMain }) => {
      const song = (n: number) => ({
        id: 0,
        videoId: `abbasong00${n}`,
        title: `Song ${n}`,
        artist: "ABBA",
        artists: ["ABBA"],
        album: "Arrival",
        albumId: "MPREb_arrival",
        artworkHash: null,
        artworkUrl: null,
        durationMs: 200000,
        count: 0,
        year: null,
        genre: null,
        trackNumber: null,
        favorite: false,
        path: null,
        unavailable: false,
      });
      const songs = { items: [song(1), song(2), song(3)], offset: 0, total: 3 };
      const release = (browseId: string, title: string, libraryId: number | null) => ({
        kind: "album",
        browseId,
        title,
        year: 1976,
        artworkUrl: null,
        libraryId,
      });
      const seen = { started: [] as unknown[], actions: [] as unknown[], albumReads: 0 };
      (globalThis as { ytActions?: typeof seen }).ytActions = seen;
      ipcMain.removeHandler("yt.search");
      ipcMain.handle("yt.search", () => ({
        status: "ok",
        songs: { items: [], offset: 0, total: 0 },
        artists: [{ browseId: "UCabbaabbaabbaabbaabbaab", name: "ABBA", artworkUrl: null }],
        albums: [],
        inLibrary: { songs: [], artists: [], albums: [] },
      }));
      ipcMain.removeHandler("yt.artist");
      ipcMain.handle("yt.artist", () => ({
        status: "ok",
        page: {
          name: "ABBA",
          artworkUrl: null,
          songs,
          albums: [
            release("MPREb_waterloo", "Waterloo", 1),
            release("MPREb_arrival", "Arrival", null),
          ],
          singles: [],
          similar: [],
        },
      }));
      // The first read gets no answer; Try Again reads the album.
      ipcMain.removeHandler("yt.album");
      ipcMain.handle("yt.album", () => {
        seen.albumReads += 1;
        return seen.albumReads === 1
          ? { status: "failed", album: null }
          : {
              status: "ok",
              album: { title: "Arrival", artists: ["ABBA"], year: 1976, artworkUrl: null, songs },
            };
      });
      ipcMain.removeHandler("playback.startYt");
      ipcMain.handle("playback.startYt", (_event, ids, index, shuffle) => {
        seen.started.push([ids.length, index, shuffle ?? false]);
      });
      // Main's answers as its album download goes: Download, then Cancel while on their way,
      // then Retry Failed, then Downloaded.
      const views = [
        { button: { action: "download", label: "Download" }, line: null },
        { button: { action: "cancel", label: "Cancel" }, line: "Downloading · 1 of 2" },
        { button: { action: "retryFailed", label: "Retry Failed" }, line: null },
        { button: { action: "downloaded", label: "Downloaded" }, line: null },
      ];
      ipcMain.removeHandler("downloads.ytList");
      ipcMain.handle("downloads.ytList", () => views[Math.min(seen.actions.length, 3)]);
      ipcMain.removeHandler("downloads.ytListAction");
      ipcMain.handle("downloads.ytListAction", (_event, action, list) => {
        seen.actions.push([action, list]);
      });
    });
    const seen = () =>
      app.evaluate(
        () => (globalThis as { ytActions?: { started: unknown[]; actions: unknown[] } }).ytActions!,
      );

    // Search's artist opens their YT Music page: Play and Shuffle.
    await page.getByRole("searchbox", { name: text.desktopLayout.search }).fill("dancing queen");
    const results = page.getByTestId("yt-results");
    await results
      .getByRole("region", { name: text.playbackText.artists })
      .getByRole("button", { name: /ABBA/ })
      .first()
      .click();
    const artist = page.getByTestId("yt-artist");
    await expect(artist.locator("h1")).toHaveText("ABBA");
    await artist.getByRole("button", { name: "Shuffle", exact: true }).click();
    await expect.poll(async () => (await seen()).started).toEqual([[3, 0, true]]);

    // A release the Library has opens the Library's album page.
    await artist.getByRole("button", { name: "Waterloo" }).click();
    await expect(page.getByTestId("hero").locator("h1")).toHaveText("Waterloo");
    await page.getByRole("button", { name: text.desktopLayout.back, exact: true }).click();

    // One it doesn't have opens its YT Music page; YT Music doesn't answer, Try Again reads it.
    await artist.getByRole("button", { name: "Arrival" }).click();
    const quiet = page.getByTestId("yt-status");
    await expect(quiet).toContainText(text.desktopLayout.ytFailed);
    await quiet.getByRole("button", { name: "Try Again", exact: true }).click();
    const album = page.getByTestId("yt-album");
    await expect(album.locator("h1")).toHaveText("Arrival");
    await album.getByRole("button", { name: "Shuffle", exact: true }).click();
    await expect
      .poll(async () => (await seen()).started)
      .toEqual([
        [3, 0, true],
        [3, 0, true],
      ]);

    // Download, then Cancel with the head's count, then Retry Failed, then Downloaded.
    const download = album.getByTestId("yt-list-download");
    const line = album.getByTestId("yt-list-download-line");
    await expect(download).toHaveText("Download");
    await expect(line).toHaveCount(0);
    await download.click();
    await expect(download).toHaveText("Cancel");
    await expect(line).toHaveText("Downloading · 1 of 2");
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({
        path: join(appFolder, "test-results", `yt-album-download-${process.platform}-${theme}.png`),
      });
    }
    await download.click();
    await expect(download).toHaveText("Retry Failed");
    await download.click();
    await expect(download).toHaveText("Downloaded");
    // Downloaded only says so: it takes no click.
    await expect(download).toHaveAttribute("aria-disabled", "true");
    expect((await seen()).actions).toEqual([
      ["download", { kind: "album", id: "MPREb_arrival" }],
      ["cancel", { kind: "album", id: "MPREb_arrival" }],
      ["retryFailed", { kind: "album", id: "MPREb_arrival" }],
    ]);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
