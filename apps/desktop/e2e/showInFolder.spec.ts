import { copyFileSync, mkdirSync, mkdtempSync, realpathSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, normalize } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { Database } from "@wave/client";
import type { LibraryDatabase } from "@wave/client/db/database";
import { createPlaylist } from "@wave/client/db/playlists";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { catalogueOf } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";

/**
 * Show in Folder (docs/spec-desktop.md, the song menu): a song with a file opens the file manager
 * on it, found by main from the song's id; a missing or streamed song has no such entry, and a
 * song in a folder whose drive isn't connected says so.
 */
const appFolder = join(import.meta.dirname, "..");
const text = catalogueOf("en", "desktop");
const fixture = join(
  appFolder,
  "../../packages/kotlin-shared/src/testFixtures/resources/fixtures/tagged.flac",
);

test("Show in Folder opens the file manager on a song's file, and only where it can", async () => {
  // Its long name: Windows can give the temporary folder as a short one.
  const folder = realpathSync.native(mkdtempSync(join(tmpdir(), "wave-e2e-show-in-folder-")));
  const data = join(folder, "data");
  const music = join(folder, "Music");
  mkdirSync(data);
  mkdirSync(music);
  copyFileSync(fixture, join(music, "Road.flac"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      // A missing song: the account has it, this computer has no file of it.
      const missing = addTrack(db, { title: "Absent Song", artist: "Zed", album: "Away" });
      db.run(sql`UPDATE tracks SET path=NULL WHERE id=${missing}`);
      createPlaylist(
        db as unknown as LibraryDatabase,
        "Evening",
        [
          {
            source: "stream",
            song: {
              videoId: "abcdefghijk",
              title: "Streamed Song",
              artists: ["Nick Drake"],
              album: "Pink Moon",
              durationMs: 124_000,
              artworkUrl: null,
              explicit: false,
            },
          },
        ],
        1,
      );
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: music },
  });
  try {
    const page = await app.firstWindow();
    await page.bringToFront();
    // The file manager stands in for itself here: main's call is recorded instead.
    await app.evaluate(({ shell }) => {
      const shown: string[] = [];
      (globalThis as { shownInFolder?: string[] }).shownInFolder = shown;
      shell.showItemInFolder = (path: string) => void shown.push(path);
    });
    const shown = () =>
      app.evaluate(() => (globalThis as { shownInFolder?: string[] }).shownInFolder ?? []);
    const scanned = async () =>
      (
        await page.evaluate(() =>
          (window as unknown as { wave: WaveBridge }).wave.library.songs(0, 50),
        )
      ).items.filter((song) => song.path !== null);
    await expect.poll(async () => (await scanned()).length, { timeout: 30_000 }).toBe(1);
    // The file's title is its tags'.
    const fileTitle = (await scanned())[0]!.title;
    const entry = page.getByRole("menuitem", {
      name: text.desktopLibrary.showInFolder,
      exact: true,
    });
    /** Right-clicks [row]; a grey row (its drive not connected) still opens its menu. */
    const openMenu = async (row: string, grey = false) => {
      const name = new RegExp(row.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
      await page.getByRole("row", { name }).click({ button: "right", force: grey });
      await expect(page.getByRole("menu")).toBeVisible();
    };

    await page.getByRole("button", { name: "Songs", exact: true }).click();
    await openMenu(fileTitle);
    await page.screenshot({
      path: join(appFolder, "test-results", `show-in-folder-${process.platform}.png`),
    });
    await entry.click();
    await expect.poll(shown).toEqual([normalize(join(music, "Road.flac"))]);

    // A missing song has no file to show.
    await openMenu("Absent Song");
    await expect(entry).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Nor has a streamed one.
    await page.getByRole("button", { name: "Evening", exact: true }).click();
    await openMenu("Streamed Song");
    await expect(page.getByRole("menuitem").first()).toBeVisible();
    await expect(entry).toHaveCount(0);
    await page.keyboard.press("Escape");

    // A song whose drive isn't connected says so, and nothing opens.
    renameSync(music, join(folder, "Disconnected"));
    await expect
      .poll(async () => (await scanned())[0]?.unavailable, { timeout: 15_000 })
      .toBe(true);
    await page.getByRole("button", { name: "Songs", exact: true }).click();
    await openMenu(fileTitle, true);
    await entry.click();
    await expect(page.getByText(text.desktopLibrary.driveDisconnected)).toBeVisible();
    expect(await shown()).toHaveLength(1);
    // The bridge takes a song's id, never a path.
    const refused = await page.evaluate(
      async (path) => {
        try {
          await (window as unknown as { wave: WaveBridge }).wave.songs.showInFolder(path as never);
          return "shown";
        } catch {
          return "refused";
        }
      },
      join(folder, "Disconnected", "Road.flac"),
    );
    expect(refused).toBe("refused");
  } finally {
    await app.close();
    rmSync(folder, { recursive: true, force: true });
  }
});
