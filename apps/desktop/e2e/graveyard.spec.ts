import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { Database } from "@wave/client";
import type { LibraryDatabase } from "@wave/client/db/database";
import {
  createPlaylist,
  removePlaylistItems,
  selectPlaylistEntries,
} from "@wave/client/db/playlists";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { catalogueOf } from "@wave/core";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";

/**
 * A playlist's Graveyard (#1222): a double-click or Enter plays a song without restoring it, and
 * right-click, Shift+F10 and the Menu key open the song's own menu with Restore and Remove from
 * Graveyard in it, for a Library song and a streamed one. Main's side of the play (the queue it
 * starts) has unit tests of its own; here a handler in its place records what the window asked.
 */
const appFolder = join(import.meta.dirname, "..");
const text = catalogueOf("en", "desktop");

const seed = (data: string) =>
  Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as LibraryDatabase;
      const [alpha, bravo] = ["Alpha", "Bravo"].map((title, n) =>
        addTrack(db as unknown as TestDatabase, {
          title,
          album: "Disc",
          artist: "Wave",
          trackNumber: n + 1,
        }),
      );
      const { playlistId } = createPlaylist(
        db,
        "Evening",
        [
          { source: "library", trackId: alpha! },
          { source: "library", trackId: bravo! },
          {
            source: "stream",
            song: {
              videoId: "northernsky",
              title: "Northern Sky",
              artists: ["Nick Drake"],
              album: "Bryter Layter",
              durationMs: 222_000,
              artworkUrl: null,
              explicit: false,
            },
          },
        ],
        0,
      );
      const [, bravoEntry, streamEntry] = selectPlaylistEntries(db, playlistId);
      removePlaylistItems(db, playlistId, [bravoEntry!.itemId], 1_000);
      removePlaylistItems(db, playlistId, [streamEntry!.itemId], 2_000);
      return { playlistId, bravo: bravoEntry!.itemId, stream: streamEntry!.itemId };
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );

test("a Graveyard song plays without coming back, and has its song menu", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-graveyard-"));
  const seeded = await seed(data);
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId("home")).toBeVisible();
    await app.evaluate(({ ipcMain }) => {
      const played: unknown[] = [];
      (globalThis as { graveyardPlays?: unknown[] }).graveyardPlays = played;
      ipcMain.removeHandler("playlists.playGraveyard");
      ipcMain.handle("playlists.playGraveyard", (_event, ...args) => {
        played.push(args);
        return { kind: "playing", streamed: 0, leftOut: 0 };
      });
    });
    const plays = () =>
      app.evaluate(() => (globalThis as { graveyardPlays?: unknown[] }).graveyardPlays!);
    const labels = text.itemActions.labels;

    await page
      .locator(".sidebar-playlists")
      .getByRole("button", { name: "Evening", exact: true })
      .click();
    await page.getByRole("button", { name: text.playlists.playlistActions }).click();
    await page.getByRole("menuitem", { name: text.playlists.graveyard }).click();
    const graveyard = page.getByRole("list", { name: text.playlists.graveyard });
    const buried = (title: string) => graveyard.getByRole("listitem").filter({ hasText: title });
    // Newest removal first: the streamed song, then Bravo.
    await expect(graveyard.getByRole("listitem")).toHaveText([/Northern Sky/, /Bravo/]);

    // Double-click and Enter play, and the song stays in the Graveyard.
    await buried("Bravo").locator(".graveyard-copy").dblclick();
    await buried("Northern Sky").focus();
    await page.keyboard.press("Enter");
    await expect.poll(plays).toEqual([
      [seeded.playlistId, seeded.bravo],
      [seeded.playlistId, seeded.stream],
    ]);
    await expect(graveyard.getByRole("listitem")).toHaveCount(2);

    // Right-click: a Library song's own menu, with Restore and Remove from Graveyard.
    const menu = page.getByRole("menu");
    await buried("Bravo").click({ button: "right" });
    await expect(menu.getByRole("menuitem", { name: labels.addToQueue })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: text.playlists.restore })).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: text.playlists.removeFromGraveyard }),
    ).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: labels.select })).toHaveCount(0);
    await page.keyboard.press("Escape");
    await expect(menu).toHaveCount(0);

    // Shift+F10 and the Menu key: a streamed song's menu, with the same two.
    await buried("Northern Sky").focus();
    await page.keyboard.press("Shift+F10");
    await expect(menu.getByRole("menuitem", { name: labels.addToQueue })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: text.playlists.restore })).toBeVisible();
    await page.keyboard.press("Escape");
    await buried("Northern Sky").focus();
    await page.keyboard.press("ContextMenu");
    await expect(
      menu.getByRole("menuitem", { name: text.playlists.removeFromGraveyard }),
    ).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`graveyard-${process.platform}.png`) });

    // The menu's Restore puts the song back on the playlist's page.
    await menu.getByRole("menuitem", { name: text.playlists.restore }).click();
    await expect(buried("Northern Sky")).toHaveCount(0);
    await expect(buried("Bravo")).toBeVisible();
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
