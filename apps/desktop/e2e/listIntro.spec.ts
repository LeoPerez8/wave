import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, star, type TestDatabase } from "@wave/client/testing";
import { catalogueOf, scanPath } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";

const appFolder = join(import.meta.dirname, "..");
const text = catalogueOf("en", "desktop");

/** A silent stereo WAV of [seconds] at [path]. */
const silence = (path: string, seconds: number) => {
  const rate = 44_100;
  const data = Buffer.alloc(rate * 4 * seconds);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
};

/** The queue's titles in order, and whether shuffle is on. */
const queue = (page: Page) =>
  page.evaluate(async () => {
    const bridge = (window as unknown as { wave: WaveBridge }).wave;
    const view = await bridge.playback.view();
    const rows = await bridge.playback.queue(0, 50);
    return {
      current: view.current?.title ?? null,
      shuffle: view.shuffle,
      titles: rows.items.map((row) => row.title),
    };
  });

test("Songs and Favorites start with Play, Shuffle and a song count that follows the Library", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-list-intro-"));
  mkdirSync(join(data, "Music"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      for (const [title, starred] of [
        ["Alpha", false],
        ["Bravo", true],
        ["Charlie", true],
      ] as const) {
        const file = join(data, "Music", `${title}.wav`);
        silence(file, 60);
        const id = addTrack(db, { title, artist: "Wave Test", album: "Intro" });
        const stored = scanPath(realpathSync.native(file), process.platform);
        db.run(sql`UPDATE tracks SET path=${stored} WHERE id=${id}`);
        if (starred) star(db, id, Date.UTC(2024, 0, title === "Bravo" ? 1 : 2));
      }
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    const heading = page.locator(".page-heading");
    const play = heading.getByRole("button", { name: text.desktopLayout.play, exact: true });
    const shuffle = heading.getByRole("button", { name: text.desktopLayout.shuffle, exact: true });
    const count = page.getByTestId("song-count");
    const toast = page.getByRole("status").filter({ hasText: text.playbackText.newQueuePlaying });
    const open = (name: string) => page.getByRole("button", { name, exact: true }).click();

    await open("Songs");
    await expect(count).toHaveText("3 songs");
    await expect(page.locator("#library-row-0").getByRole("gridcell").first()).toHaveText("Alpha");

    // Play starts the list from its first song, in the order shown.
    await play.click();
    await expect
      .poll(() => queue(page))
      .toEqual({
        current: "Alpha",
        shuffle: false,
        titles: ["Alpha", "Bravo", "Charlie"],
      });
    await expect(toast).toBeHidden();

    // Sorted the other way, Play follows; it replaces the queue, so Undo is offered.
    await page
      .getByRole("columnheader", { name: "Title", exact: true })
      .getByRole("button")
      .click();
    await expect(page.locator("#library-row-0").getByRole("gridcell").first()).toHaveText(
      "Charlie",
    );
    await play.click();
    await expect
      .poll(() => queue(page))
      .toEqual({
        current: "Charlie",
        shuffle: false,
        titles: ["Charlie", "Bravo", "Alpha"],
      });
    await expect(toast).toBeVisible();
    await expect(toast.getByRole("button", { name: text.playbackText.undo })).toBeVisible();

    // Shuffle starts the same songs shuffled.
    await shuffle.click();
    await expect.poll(async () => (await queue(page)).shuffle).toBe(true);
    expect((await queue(page)).titles.toSorted()).toEqual(["Alpha", "Bravo", "Charlie"]);

    // Favorites: its own count, Play in its order, and the count follows a new star.
    await open("Favorites");
    await expect(count).toHaveText("2 songs");
    const firstFavorite = await page
      .locator("#library-row-0")
      .getByRole("gridcell")
      .first()
      .textContent();
    await play.click();
    await expect.poll(async () => (await queue(page)).current).toBe(firstFavorite);
    await expect.poll(async () => (await queue(page)).shuffle).toBe(false);
    expect((await queue(page)).titles.toSorted()).toEqual(["Bravo", "Charlie"]);
    await page.evaluate(async () => {
      const bridge = (window as unknown as { wave: WaveBridge }).wave;
      const songs = await bridge.library.browse({ kind: "songs" }, 0, 50);
      const alpha = songs.items.find((song) => song.title === "Alpha")!;
      await bridge.playback.start({ kind: "songs" }, songs.items.indexOf(alpha));
      await bridge.playback.favorite();
    });
    await expect(count).toHaveText("3 songs");

    // Other pages keep their own heading.
    await open("Albums");
    await expect(play).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
