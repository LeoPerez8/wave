import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { catalogueOf } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";
import type { PlayerView } from "../src/shared/playerView.ts";
import type { MagicQueueView } from "../src/shared/ytPages.ts";

/**
 * The Queue tab's bar and Up Next (#1228): its shuffle and repeat toggles change the player
 * bar's state and follow it, Up Next counts its songs, a Magic Queue's songs sit under a heading
 * naming its seed with placeholder rows while a batch loads and a line when it comes back empty,
 * and after scrolling away a button brings the playing song back. The Magic Queue is main's
 * `magicQueue.view` stubbed, as a seed with no account behind it.
 */
const appFolder = join(import.meta.dirname, "..");
const SONGS = 30;
const text = catalogueOf("en", "desktop");
const words = text.playbackText;
const layout = text.desktopLayout;

/**
 * A minute of mono 8 kHz silence, as long as the songs' 1:00: a shorter file ends on its own
 * on a slow runner before the spec pauses it, and the queue moves on.
 */
const silence = (path: string) => {
  const rate = 8_000;
  const data = Buffer.alloc(rate * 2 * 60);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
};

const read = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { wave: WaveBridge }).wave.playback.view(),
  ) as Promise<PlayerView>;

test("the Queue tab's toggles, count, Magic Queue heading, placeholders and way back", async () => {
  test.setTimeout(120_000);
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-queue-panel-"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      db.run(sql`INSERT INTO desktop_settings (key, value) VALUES ('settings.ytMusic', 'off')`);
      db.run(
        sql`INSERT INTO desktop_synced_preferences (key, value) VALUES ('settings.continueQueue', 'off')`,
      );
      for (let n = 1; n <= SONGS; n++) {
        const id = addTrack(db, {
          title: `Song ${String(n).padStart(2, "0")}`,
          album: "Tides",
          artist: "Wave",
          durationMs: 60_000,
          trackNumber: n,
        });
        const path = join(data, `song-${n}.wav`);
        silence(path);
        db.run(sql`UPDATE tracks SET path=${path} WHERE id=${id}`);
      }
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    const magic = await app.evaluateHandle(({ ipcMain }) => {
      const state: { view: MagicQueueView } = { view: { title: null, status: "idle" } };
      ipcMain.removeHandler("magicQueue.view");
      ipcMain.handle("magicQueue.view", () => state.view);
      return state;
    });
    await page.getByRole("button", { name: "Songs", exact: true }).click();
    await page.getByRole("row", { name: /Song 01/ }).dblclick();
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeEnabled();
    await page.evaluate(() => (window as unknown as { wave: WaveBridge }).wave.playback.pause());

    const bar = page.locator(".player-bar");
    await bar.getByRole("button", { name: layout.queue, exact: true }).click();
    const panel = page.getByRole("tabpanel");
    const list = panel.getByRole("listbox", { name: layout.queue });

    // Up Next counts its songs.
    await expect(list.getByText(words.upNext, { exact: true })).toBeVisible();
    await expect(list.getByText(words.songCount(SONGS - 1))).toBeVisible();

    // The panel's toggles and the bar's change the same state.
    const shuffle = (scope: typeof bar) =>
      scope.getByRole("button", { name: layout.shuffle, exact: true });
    await shuffle(panel).click();
    await expect.poll(async () => (await read(page)).shuffle).toBe(true);
    await expect(shuffle(bar)).toHaveAttribute("aria-pressed", "true");
    await expect(shuffle(panel)).toHaveAttribute("aria-pressed", "true");
    await shuffle(bar).click();
    await expect(shuffle(panel)).toHaveAttribute("aria-pressed", "false");
    await panel.getByRole("button", { name: layout.repeatOff, exact: true }).click();
    await expect.poll(async () => (await read(page)).repeat).toBe("all");
    await expect(bar.getByRole("button", { name: layout.repeatAll, exact: true })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await bar.getByRole("button", { name: layout.repeatAll, exact: true }).click();
    await expect(panel.getByRole("button", { name: layout.repeatOne, exact: true })).toBeVisible();
    await panel.getByRole("button", { name: layout.repeatOne, exact: true }).click();
    await expect.poll(async () => (await read(page)).repeat).toBe("off");

    // Scrolled away from the playing song, a button brings it back.
    const back = panel.getByRole("button", { name: words.backToCurrentSong });
    await expect(back).toBeHidden();
    await list.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event("scroll"));
    });
    await expect(back).toBeVisible();
    await back.click();
    await expect(list.getByRole("option", { name: /Song 01/ })).toBeInViewport();
    await expect(back).toBeHidden();

    // A Magic Queue: its seed heads Up Next, placeholders stand in while its batch loads...
    const placeholders = list.getByTestId("queue-placeholder");
    await magic.evaluate((state) => {
      state.view = { title: "Pink Moon", status: "loading" };
    });
    // The panel reads the Magic Queue as the queue changes.
    await page.evaluate(() =>
      (window as unknown as { wave: WaveBridge }).wave.playback.command({ type: "next" }),
    );
    await page.evaluate(() => (window as unknown as { wave: WaveBridge }).wave.playback.pause());
    await expect(list.getByText(words.magicQueueFrom("Pink Moon"))).toBeVisible();
    await expect(list.getByText(words.songCount(SONGS - 2))).toBeVisible();
    await list.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
      element.dispatchEvent(new Event("scroll"));
    });
    await expect(placeholders).toHaveCount(3);
    await expect(list).toHaveAttribute("aria-busy", "true");
    await page.screenshot({
      path: test.info().outputPath(`queue-panel-loading-${process.platform}.png`),
    });

    // ...and a batch that came back empty says so.
    await magic.evaluate((state) => {
      state.view = { title: "Pink Moon", status: "empty" };
    });
    await expect(list.getByText(words.noSongsFoundLikeValue("Pink Moon"))).toBeVisible();
    await expect(placeholders).toHaveCount(0);
    await expect(list).not.toHaveAttribute("aria-busy", "true");
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
