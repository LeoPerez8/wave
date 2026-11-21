import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { catalogueOf } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";

/**
 * A Library album's page (#1221): a "Disc n" head before each disc's songs, and with YT Music
 * on the Library | Online toggle, Online joining the release's other songs among the Library's.
 * YouTube Music is answered by handlers the test puts in main's place (main's side has unit
 * tests of its own), so nothing here asks the network.
 */
const appFolder = join(import.meta.dirname, "..");
const text = catalogueOf("en", "desktop");

const seed = (data: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      // Listed out of order: the page orders them by disc, then track.
      for (const [title, disc, track] of [
        ["Second Disc Opener", 2, 1],
        ["First Disc Closer", 1, 2],
        ["Second Disc Closer", 2, 2],
        ["First Disc Opener", 1, 1],
      ] as const) {
        const id = addTrack(db, {
          title,
          album: "Double",
          artist: "Band",
          trackNumber: track,
          durationMs: 180000,
        });
        db.run(sql`UPDATE tracks SET disc_number=${disc} WHERE id=${id}`);
      }
      addTrack(db, { title: "Only Song", album: "Single", artist: "Band", trackNumber: 1 });
      db.run(sql`INSERT INTO desktop_settings(key,value) VALUES('settings.ytMusic','on')`);
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );

test("an album heads each disc, and Online joins its release's other songs", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-album-discs-"));
  await seed(data);
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId("home")).toBeVisible();
    await app.evaluate(({ ipcMain }) => {
      const row = (title: string, trackNumber: number, videoId?: string) => ({
        id: videoId === undefined ? trackNumber : 0,
        ...(videoId === undefined ? {} : { videoId, artists: ["Band"], albumId: null }),
        title,
        artist: "Band",
        album: "Double",
        artworkHash: null,
        artworkUrl: null,
        durationMs: 180000,
        count: 1,
        year: null,
        genre: null,
        trackNumber,
        favorite: false,
        path: null,
        unavailable: false,
      });
      const seen = { asked: [] as unknown[], played: [] as unknown[], offline: false };
      (globalThis as { albumOnline?: typeof seen }).albumOnline = seen;
      ipcMain.removeHandler("artistPage.albumSection");
      ipcMain.handle("artistPage.albumSection", (_event, _albumId, pick) => {
        const base = { asks: false, retry: null, discs: [], release: null };
        if (pick !== "online") return { ...base, toggle: "library", note: null, tracks: null };
        if (seen.offline)
          return { ...base, toggle: "online", note: "offline", retry: "artist", tracks: null };
        return {
          ...base,
          toggle: "online",
          note: null,
          release: "MPREdouble",
          tracks: [
            row("First Disc Opener", 1),
            row("Streamed Song", 2, "streamed001"),
            row("First Disc Closer", 3),
          ],
          discs: [],
        };
      });
      ipcMain.removeHandler("artistPage.albumAsk");
      ipcMain.handle("artistPage.albumAsk", (_event, ...args) => void seen.asked.push(args));
      ipcMain.removeHandler("artistPage.albumPlay");
      ipcMain.handle("artistPage.albumPlay", (_event, ...args) => {
        seen.played.push(args);
        return { kind: "playing", streamed: 1, leftOut: 0 };
      });
      ipcMain.removeHandler("downloads.ytList");
      ipcMain.handle("downloads.ytList", () => ({
        button: { action: "download", label: "Download" },
        line: null,
      }));
    });
    const seen = () =>
      app.evaluate(
        () =>
          (globalThis as { albumOnline?: { asked: unknown[]; played: unknown[] } }).albumOnline!,
      );

    await page.getByRole("button", { name: "Albums", exact: true }).click();
    await page.getByRole("row", { name: /Double/ }).dblclick();
    const hero = page.getByTestId("hero");
    await expect(hero.locator("h1")).toHaveText("Double");
    const table = page.getByRole("grid");
    // Each disc's head, then its songs by track number.
    await expect(table.getByRole("rowheader")).toHaveText([
      text.library.disc(1),
      text.library.disc(2),
    ]);
    await expect(table.getByRole("row").filter({ hasText: /Disc (Opener|Closer)/ })).toHaveText([
      /First Disc Opener/,
      /First Disc Closer/,
      /Second Disc Opener/,
      /Second Disc Closer/,
    ]);
    await page.screenshot({ path: "test-results/album-discs.png" });

    // Online joins the release's other song among the Library's, and Play plays them all.
    const online = hero.getByRole("button", { name: text.library.online, exact: true });
    await expect(online).toHaveAttribute("aria-pressed", "false");
    await online.click();
    await expect(online).toHaveAttribute("aria-pressed", "true");
    const list = page.getByRole("list", { name: "Songs", exact: true });
    await expect(list.getByRole("listitem")).toHaveText([
      /First Disc Opener/,
      /Streamed Song/,
      /First Disc Closer/,
    ]);
    await expect(hero).toContainText("3 songs");
    await expect(hero.getByRole("button", { name: "Download" })).toBeVisible();
    await page.screenshot({ path: "test-results/album-online.png" });
    await hero.getByRole("button", { name: "Play", exact: true }).click();
    await expect
      .poll(async () => (await seen()).played)
      .toEqual([[expect.any(Number), "online", null, false]]);
    await list.getByRole("listitem", { name: /Streamed Song/ }).dblclick();
    await expect
      .poll(async () => (await seen()).played.at(-1))
      .toEqual([expect.any(Number), "online", 1, false]);

    // Library shows the album as it is again.
    await hero.getByRole("button", { name: text.library.library, exact: true }).click();
    await expect(table.getByRole("rowheader")).toHaveCount(2);
    await expect(list).toHaveCount(0);

    // Offline, Online is a quiet line, and picking it again asks again.
    await app.evaluate(() => {
      (globalThis as { albumOnline?: { offline: boolean } }).albumOnline!.offline = true;
    });
    await online.click();
    await expect(page.getByTestId("album-online-note")).toHaveText(text.library.offlineTapOnline);
    await online.click();
    await expect.poll(async () => (await seen()).asked.length).toBeGreaterThan(0);

    // A one-disc album has no head.
    await page.getByRole("button", { name: "Albums", exact: true }).click();
    await page.getByRole("row", { name: /Single/ }).dblclick();
    await expect(hero.locator("h1")).toHaveText("Single");
    await expect(table.getByRole("row", { name: /Only Song/ })).toBeVisible();
    await expect(table.getByRole("rowheader")).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
