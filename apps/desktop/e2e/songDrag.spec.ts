import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test, type Locator, type Page } from "@playwright/test";
import { Database } from "@wave/client";
import { createPlaylist } from "@wave/client/db/playlists";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { catalogueOf, describePlaylistAdd } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";

/**
 * Song rows dragged onto a sidebar playlist, the Queue panel and the player bar's Queue button
 * (#1217), with the sidebar wide and collapsed to icons, and a streamed playlist entry too.
 */
const appFolder = join(import.meta.dirname, "..");
const text = catalogueOf("en", "desktop");
const TITLES = ["Alpha", "Bravo", "Charlie", "Delta"];

/** Ten seconds of silent stereo WAV at [path]. */
const silence = (path: string) => {
  const rate = 44_100;
  const data = Buffer.alloc(rate * 4 * 10);
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

/** The titles of playlist [name], in its order. */
const playlistTitles = (page: Page, name: string) =>
  page.evaluate(async (name) => {
    const bridge = (window as unknown as { wave: WaveBridge }).wave;
    const lists = await bridge.library.browse({ kind: "playlists" }, 0, 50);
    const id = lists.items.find((row) => row.title === name)!.id;
    const songs = await bridge.library.browse({ kind: "playlist", id }, 0, 50);
    return songs.items.map((row) => row.title);
  }, name);

const queueTitles = (page: Page) =>
  page.evaluate(async () => {
    const bridge = (window as unknown as { wave: WaveBridge }).wave;
    return (await bridge.playback.queue(0, 50)).items.map((row) => row.title);
  });

/** Drags [from] over [to] with the mouse, checks [to]'s highlight while over it, and drops. */
const dragOnto = async (page: Page, from: Locator, to: Locator, targetX = 10) => {
  await from.hover();
  await page.mouse.down();
  // A synthetic drag gets one event per move: the drag starts, enters [to], then goes over it.
  for (const x of [targetX, targetX + 4, targetX + 8]) await to.hover({ position: { x, y: 10 } });
  await expect(to).toHaveClass(/drop-over/);
  await page.mouse.up();
  await expect(to).not.toHaveClass(/drop-over/);
};

test("songs drag onto a sidebar playlist, the Queue panel and the Queue button", async () => {
  test.setTimeout(120_000);
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-song-drag-"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      TITLES.forEach((title, n) => {
        const id = addTrack(db, { title, album: "Disc", artist: "Wave", trackNumber: n + 1 });
        const path = join(data, `${title}.wav`);
        silence(path);
        db.run(sql`UPDATE tracks SET path=${path} WHERE id=${id}`);
      });
      createPlaylist(db, "Evening", [], 1000);
      createPlaylist(
        db,
        "Online",
        [
          {
            source: "stream",
            song: {
              videoId: "abcdefghijk",
              title: "Streamed song",
              artists: ["Wave"],
              album: null,
              artworkUrl: null,
              durationMs: null,
              explicit: false,
            },
          },
        ],
        2000,
      );
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    const toast = (message: string) => page.getByRole("status").filter({ hasText: message });
    const row = (title: string) => page.getByRole("row", { name: new RegExp(title) });
    const sidebar = page.locator(".sidebar-playlists");
    const evening = sidebar.getByRole("button", { name: "Evening", exact: true });
    await page.getByRole("button", { name: "Songs", exact: true }).click();
    const find = page.locator(".find-field input");
    const expectFindInContent = async () => {
      await expect(find).toBeVisible();
      expect((await find.boundingBox())!.x).toBeGreaterThanOrEqual(
        await page.locator(".sidebar").evaluate((sidebar) => sidebar.getBoundingClientRect().right),
      );
      await expect(find).toHaveCSS("opacity", "1");
    };
    await expectFindInContent();
    await page.setViewportSize({ width: 1400, height: 900 });

    // One row onto a sidebar playlist: it highlights while over it, and the toast says so.
    await dragOnto(page, row("Alpha"), evening);
    await expect(toast(describePlaylistAdd("Evening", 1, 0, "en"))).toBeVisible();
    // Again: the phone's word for a song already in it.
    await row("Alpha").dragTo(evening);
    await expect(toast(describePlaylistAdd("Evening", 0, 1, "en"))).toBeVisible();
    // A drag over something that can't take songs highlights nothing.
    await row("Bravo").hover();
    await page.mouse.down();
    const songsNav = page.getByRole("button", { name: "Songs", exact: true });
    for (const x of [10, 14, 18]) await songsNav.hover({ position: { x, y: 10 } });
    await expect(page.locator(".drop-over")).toHaveCount(0);
    await page.mouse.up();

    // The checked rows travel together, in the order shown.
    await row("Delta").click();
    await row("Bravo").click({ modifiers: ["Control"] });
    await row("Delta").dragTo(evening);
    await expect(toast(describePlaylistAdd("Evening", 2, 0, "en"))).toBeVisible();
    expect(await playlistTitles(page, "Evening")).toEqual(["Alpha", "Bravo", "Delta"]);
    await page.keyboard.press("Escape");

    // The Queue panel: a song dropped on an Up Next row goes before it.
    await page.evaluate(async () => {
      const bridge = (window as unknown as { wave: WaveBridge }).wave;
      await bridge.playback.start({ kind: "songs" }, 0);
      await bridge.playback.pause();
    });
    await expect.poll(() => queueTitles(page)).toEqual(TITLES);
    const bar = page.locator(".player-bar");
    const queueButton = bar.getByRole("button", { name: text.desktopLayout.queue, exact: true });
    await queueButton.click();
    const queue = page.getByRole("listbox", { name: text.desktopLayout.queue });
    const queued = (title: string) => queue.getByRole("option", { name: new RegExp(`^${title},`) });
    await dragOnto(page, row("Delta"), queued("Charlie"));
    await expect(toast(text.itemActions.addedToQueue)).toBeVisible();
    await expect
      .poll(() => queueTitles(page))
      .toEqual(["Alpha", "Bravo", "Delta", "Charlie", "Delta"]);
    // The playing row takes a drop for the top of Up Next.
    await row("Charlie").dragTo(queued("Alpha"));
    await expect
      .poll(() => queueTitles(page))
      .toEqual(["Alpha", "Charlie", "Bravo", "Delta", "Charlie", "Delta"]);

    // Add to Queue follows the last dropped song, even with a context song between drops.
    await dragOnto(page, row("Bravo"), queueButton);
    await expect(toast(text.itemActions.addedToQueue)).toBeVisible();
    await expect(queue.getByRole("option")).toHaveText([
      /Alpha/,
      /Charlie/,
      /Bravo/,
      /Delta/,
      /Bravo/,
      /Charlie/,
      /Delta/,
    ]);

    // With the sidebar collapsed to icons, a playlist still takes the drop.
    await page.setViewportSize({ width: 1000, height: 900 });
    await expect(evening.locator(".nav-monogram")).toBeVisible();
    await expectFindInContent();
    await dragOnto(page, row("Charlie"), evening);
    await expect(toast(describePlaylistAdd("Evening", 1, 0, "en"))).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath(`song-drag-collapsed-${process.platform}.png`),
    });
    await page.setViewportSize({ width: 1400, height: 900 });

    // A streamed song drags the same way.
    await sidebar.getByRole("button", { name: "Online", exact: true }).click();
    await dragOnto(page, row("Streamed song"), evening);
    await expect(toast(describePlaylistAdd("Evening", 1, 0, "en"))).toBeVisible();
    expect(await playlistTitles(page, "Evening")).toEqual([
      "Alpha",
      "Bravo",
      "Delta",
      "Charlie",
      "Streamed song",
    ]);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
