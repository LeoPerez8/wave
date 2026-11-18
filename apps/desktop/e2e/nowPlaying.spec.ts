import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";
import type { PlayerView } from "../src/shared/playerView.ts";

/**
 * The side panel's Lyrics and Queue, Now Playing and the sleep timer over the real engine and
 * JVM: a sidecar `.lrc` follows playback and seeks on a click, the queue moves and removes by
 * keyboard, and the sleep timer starts and stops. Screenshots of each in light and dark.
 */
const appFolder = join(import.meta.dirname, "..");
const SECONDS = 10;

/** A [SECONDS]-second stereo WAV of a quiet tone at [hz]. */
const tone = (path: string, hz: number) => {
  const rate = 44_100;
  const frames = rate * SECONDS;
  const data = Buffer.alloc(frames * 4);
  for (let n = 0; n < frames; n++) {
    const value = Math.round(Math.sin((2 * Math.PI * hz * n) / rate) * 3000);
    data.writeInt16LE(value, n * 4);
    data.writeInt16LE(value, n * 4 + 2);
  }
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

const read = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { wave: WaveBridge }).wave.playback.view(),
  ) as Promise<PlayerView>;
const titles = (page: Page) =>
  page.evaluate(async () =>
    (await (window as unknown as { wave: WaveBridge }).wave.playback.queue(0, 50)).items.map(
      (row) => row.title,
    ),
  );
/** Pauses through the bridge: the engine may not run on a machine without an output device. */
const pause = (page: Page) =>
  page.evaluate(() => (window as unknown as { wave: WaveBridge }).wave.playback.pause());
const shot = (page: Page, name: string) =>
  page.screenshot({
    path: join(appFolder, "test-results", `now-playing-${process.platform}-${name}.png`),
  });

test("lyrics follow and seek, the queue moves by keyboard, Now Playing tints, the sleep timer runs", async () => {
  test.setTimeout(150_000);
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-now-playing-"));
  const cover = join(
    appFolder,
    "../../packages/kotlin-shared/src/testFixtures/resources/fixtures/cover.png",
  );
  const hash = createHash("sha1").update(readFileSync(cover)).digest("hex");
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      for (let n = 1; n <= 4; n++) {
        const id = addTrack(db, {
          title: `Song ${n}`,
          album: "Tides",
          artist: "Wave",
          durationMs: SECONDS * 1000,
          trackNumber: n,
          ...(n === 1 ? { artworkHash: hash } : {}),
        });
        const path = join(data, `song-${n}.wav`);
        tone(path, 220 * n);
        db.run(sql`UPDATE tracks SET path=${path} WHERE id=${id}`);
      }
      db.run(sql`UPDATE artwork SET path=${cover}, thumb_path=${cover} WHERE hash=${hash}`);
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  writeFileSync(
    join(data, "song-1.lrc"),
    [
      "[00:00.20]The tide comes in",
      "[00:03.00]The tide goes out",
      "[00:06.00]And the shore stays",
      "[00:08.50]Where it was",
    ].join("\n"),
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    // Nothing goes online: the sidecar is the only lyrics there are.
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Songs", exact: true }).click();
    await page.getByRole("row", { name: /Song 1/ }).dblclick();
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeEnabled();

    // Lyrics: the sung line follows playback; a click on a line seeks there.
    await page.getByRole("button", { name: "Lyrics", exact: true }).click();
    await expect(page.locator(".desktop-shell")).toHaveAttribute("data-panel", "lyrics");
    const lyrics = page.getByRole("listbox", { name: "Lyrics" });
    await expect(lyrics.getByRole("option", { name: "The tide comes in" })).toBeVisible();
    await page.getByRole("option", { name: "And the shore stays" }).click();
    await expect.poll(async () => Math.round((await read(page)).status.positionMs / 100)).toBe(60);
    await pause(page);
    await expect(lyrics.locator("[aria-current=true]")).toHaveText("And the shore stays");
    // The keyboard: one tab stop, ↑ and Home move, Enter seeks.
    await lyrics.focus();
    await page.keyboard.press("Home");
    await expect(lyrics).toHaveAttribute("aria-activedescendant", "lyric-0");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect.poll(async () => Math.round((await read(page)).status.positionMs / 100)).toBe(30);
    await expect(lyrics.locator("[aria-current=true]")).toHaveText("The tide goes out");
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await shot(page, `${theme}-lyrics`);
    }

    // Now Playing: from the bar's artwork or title, tinted from the artwork; Esc closes it.
    await page.getByTitle("Opens Now Playing").click();
    const nowPlaying = page.getByRole("dialog", { name: "Now Playing" });
    await expect(nowPlaying).toBeVisible();
    await expect(page.getByRole("button", { name: "Close Now Playing" })).toBeFocused();
    await expect(nowPlaying.getByRole("option", { name: "The tide goes out" })).toBeVisible();
    await expect
      .poll(() => nowPlaying.evaluate((element) => element.style.background))
      .toContain("linear-gradient");
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.waitForTimeout(300);
      await shot(page, `${theme}-now-playing`);
    }
    await page.keyboard.press("Escape");
    await expect(nowPlaying).toBeHidden();
    await expect(page.getByTitle("Opens Now Playing")).toBeFocused();

    // Queue: History, the playing song and Up Next; ↓, Alt+↓ and Delete.
    await page.keyboard.press("Control+ArrowRight");
    await expect.poll(async () => (await read(page)).current?.title).toBe("Song 2");
    await pause(page);
    await page.getByRole("button", { name: "Queue", exact: true }).click();
    const queue = page.getByRole("listbox", { name: "Queue" });
    await expect(queue.getByText("History")).toBeVisible();
    await expect(queue.getByRole("option", { name: /Song 4/ })).toBeVisible();
    await queue.focus();
    await expect(queue).toHaveAttribute("aria-activedescendant", "queue-row-1");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Alt+ArrowDown");
    await expect.poll(() => titles(page)).toEqual(["Song 1", "Song 2", "Song 4", "Song 3"]);
    await expect(queue).toHaveAttribute("aria-activedescendant", "queue-row-3");
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await shot(page, `${theme}-queue`);
    }
    await page.keyboard.press("Delete");
    await expect.poll(() => titles(page)).toEqual(["Song 1", "Song 2", "Song 4"]);
    await expect(queue).toBeFocused();
    await page.keyboard.press("Home");
    await expect(queue).toHaveAttribute("aria-activedescendant", "queue-row-0");
    await page.keyboard.press("Enter");
    await expect.poll(async () => (await read(page)).current?.title).toBe("Song 1");

    // Sleep timer: a custom duration shows its countdown; End of Track pauses at the end.
    await page.getByRole("button", { name: "Sleep Timer", exact: true }).click();
    await page.getByRole("menuitem", { name: "Custom…" }).click();
    const custom = page.getByRole("dialog", { name: "Pause After" });
    await expect(custom).toContainText("1 h 30 min");
    await custom.getByRole("button", { name: "Longer" }).click();
    await expect(custom).toContainText("1 h 45 min");
    await custom.getByRole("button", { name: "Start Timer" }).click();
    await expect(page.getByRole("button", { name: /^Sleep Timer · 1:4\d:\d\d$/ })).toBeVisible();
    await page.getByRole("button", { name: /^Sleep Timer · / }).click();
    await page.getByRole("menuitem", { name: "End of Track" }).click();
    await expect(page.getByRole("button", { name: "Sleep Timer · End of track" })).toBeVisible();
    // Pausing at the track's end is main's (sleepTimer.test.ts); here the timer turns off.
    await page.getByRole("button", { name: "Sleep Timer · End of track" }).click();
    await page.getByRole("menuitem", { name: "Turn Off Timer" }).click();
    await expect(page.getByRole("button", { name: "Sleep Timer", exact: true })).toBeVisible();
    expect((await read(page)).sleepTimer).toBeNull();
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
