import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
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
 * The player bar over the real engine: a double-click plays the list from that row, the keys
 * pause and skip, a song ending moves on by itself, and a relaunch restores the queue paused.
 * On a machine without an output device the engine keeps time without one.
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

test("a row plays its list; the keys pause and skip; a relaunch restores it paused", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-playback-"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      // The queue must end at its third song: online, Continue with Magic Queue would add to it.
      db.run(
        sql`INSERT INTO desktop_synced_preferences (key, value) VALUES ('settings.continueQueue', 'off')`,
      );
      for (let n = 1; n <= 3; n++) {
        const id = addTrack(db, {
          title: `Song ${n}`,
          album: "Gapless",
          artist: "Wave",
          durationMs: SECONDS * 1000,
          trackNumber: n,
        });
        const path = join(data, `song-${n}.wav`);
        tone(path, 220 * n);
        db.run(sql`UPDATE tracks SET path=${path} WHERE id=${id}`);
      }
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const launch = () =>
    electron.launch({
      args: [appFolder, "--lang=en-US"],
      env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    const player = () => page.locator(".player-bar");
    const pause = () => player().getByRole("button", { name: "Pause", exact: true });
    const play = () => player().getByRole("button", { name: "Play", exact: true });
    await page.getByRole("button", { name: "Songs", exact: true }).click();
    await page.getByRole("row", { name: /Song 1/ }).dblclick();
    await expect(pause()).toBeEnabled();
    expect((await read(page)).current?.title).toBe("Song 1");

    await page.keyboard.press("Space");
    await expect(play()).toBeEnabled();
    expect((await read(page)).status.state).toBe("paused");
    await page.keyboard.press("Space");
    await expect(pause()).toBeEnabled();

    await page.keyboard.press("Control+ArrowRight");
    await expect.poll(async () => (await read(page)).current?.title).toBe("Song 2");
    // The next song loads paused and then plays; it keeps playing once it does.
    await expect.poll(async () => (await read(page)).status.state).toBe("playing");
    await page.keyboard.press("Control+l");
    await expect.poll(async () => (await read(page)).current?.favorite).toBe(true);

    // Near its end, the song moves on to the next one by itself.
    await page.evaluate(
      (ms) => (window as unknown as { wave: WaveBridge }).wave.playback.seek(ms),
      SECONDS * 1000 - 500,
    );
    await expect.poll(async () => (await read(page)).current?.title).toBe("Song 3");
    await pause().click();
    await expect(play()).toBeEnabled();
    const before = await read(page);
    await page.screenshot({ path: test.info().outputPath(`playback-${process.platform}.png`) });
    await app.close();

    app = await launch();
    page = await app.firstWindow();
    await expect.poll(async () => (await read(page)).current?.title).toBe("Song 3");
    const after = await read(page);
    expect(after.status.state).toBe("paused");
    expect(after.length).toBe(3);
    expect(Math.abs(after.status.positionMs - before.status.positionMs)).toBeLessThan(150);
    await expect(play()).toBeEnabled();
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
