import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";
import type { PlaybackStatus } from "../src/shared/playback.ts";

/**
 * The engine in the built app, from the window's bridge. On a machine without an output device
 * the engine keeps time without one, so these run on CI too; listening is the owner's.
 */
const appFolder = join(import.meta.dirname, "..");
const fixtures = join(appFolder, "native", "engine", "tests", "fixtures");
let dataFolder: string;
let app: ElectronApplication;
let page: Page;

const libraryFiles = [
  ["tone-alac.m4a", "ALAC Tone"],
  ["tone-he-aac-v1.m4a", "HE-AAC v1 Tone"],
  ["tone-he-aac-v2.m4a", "HE-AAC v2 Tone"],
] as const;

test.beforeAll(async () => {
  dataFolder = mkdtempSync(join(tmpdir(), "wave-e2e-audio-"));
  // The decoder fixtures are short and have no artist tags, so the scanner treats them as recordings.
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      for (const [file, title] of libraryFiles) {
        const path = join(dataFolder, file);
        copyFileSync(join(fixtures, file), path);
        const id = addTrack(db, { title, artist: "Wave Test", durationMs: 1_000 });
        db.run(sql`UPDATE tracks SET path=${path} WHERE id=${id}`);
      }
    }).pipe(Effect.provide(libraryLayer(join(dataFolder, "wave.db")))),
  );
  app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: dataFolder, WAVE_MUSIC_DIR: join(dataFolder, "Absent") },
  });
  page = await app.firstWindow();
});

test.afterAll(async () => {
  await app.close();
  rmSync(dataFolder, { recursive: true, force: true });
});

type PlayerCall = "load" | "play" | "pause" | "seek" | "status";

const player = (call: PlayerCall, arg?: string | number): Promise<PlaybackStatus> =>
  page.evaluate(
    ([call, arg]) => {
      type Call = (...args: unknown[]) => Promise<PlaybackStatus>;
      const bridge = (globalThis as unknown as { wave: { player: Record<PlayerCall, Call> } }).wave
        .player;
      return bridge[call](...(arg === undefined ? [] : [arg]));
    },
    [call, arg] as const,
  );

/** The audio process's pid, from Electron's process list. */
const audioPid = () =>
  app.evaluate(
    ({ app }) => app.getAppMetrics().find((metric) => metric.name === "Wave audio")?.pid,
  );

for (const [format, file] of [
  ["wav", "tone.wav"],
  ["flac", "tone.flac"],
  ["mp3", "tone.mp3"],
  ["m4a", "tone.m4a"],
  ["ogg", "tone.ogg"],
  ["opus", "tone.opus"],
  ["ALAC", "tone-alac.m4a"],
  ["HE-AAC v1", "tone-he-aac-v1.m4a"],
  ["HE-AAC v2", "tone-he-aac-v2.m4a"],
] as const)
  test(`a ${format} file plays, pauses, seeks and reports its position`, async () => {
    const loaded = await player("load", join(fixtures, file));
    expect(loaded.state).toBe("paused");
    expect(loaded.positionMs).toBe(0);
    expect(loaded.durationMs).toBeGreaterThan(950);
    expect(loaded.durationMs).toBeLessThan(1_050);

    expect((await player("play")).state).toBe("playing");
    await expect.poll(async () => (await player("status")).positionMs).toBeGreaterThan(150);
    // Which output played it ("none": the engine kept time without one).
    const device = (await player("status")).device ?? "none";
    test.info().annotations.push({ type: "device", description: device });

    const paused = await player("pause");
    expect(paused.state).toBe("paused");
    await page.waitForTimeout(200);
    expect((await player("status")).positionMs).toBe(paused.positionMs);

    expect(await player("seek", 600)).toMatchObject({ state: "paused", positionMs: 600 });
    await player("play");
    await expect.poll(async () => (await player("status")).state).toBe("ended");
    expect((await player("status")).positionMs).toBeGreaterThan(950);
  });

test("killing the audio process leaves the window up, and playback starts again", async () => {
  await player("load", join(fixtures, "tone.flac"));
  await player("seek", 300);
  const first = await audioPid();
  expect(first).toBeDefined();
  process.kill(first as number);

  await expect.poll(audioPid).not.toBe(first);
  await expect.poll(audioPid).toBeDefined();
  expect(app.windows()).toHaveLength(1);
  expect(await page.evaluate(() => document.readyState)).toBe("complete");

  await expect
    .poll(() => player("status").catch(() => undefined))
    .toMatchObject({ state: "paused", positionMs: 300 });
  expect((await player("play")).state).toBe("playing");
  await expect.poll(async () => (await player("status")).positionMs).toBeGreaterThan(450);
});

test("a file the engine can't read is refused with its code", async () => {
  await expect(player("load", join(fixtures, "missing.flac"))).rejects.toThrow(/\[not-found\]/);
  await expect(player("load", "relative/tone.flac")).rejects.toThrow(/Refused player\.load/);
});

test("ALAC and both HE-AAC profiles play from the Songs table", async () => {
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  const playerBar = page.locator(".player-bar");
  const pause = playerBar.getByRole("button", { name: "Pause", exact: true });
  const songs = page.getByRole("grid", { name: "Songs" });
  for (const [, title] of libraryFiles) {
    await songs.getByRole("row").filter({ hasText: title }).dblclick();
    await expect(playerBar.locator(".player-now .player-title")).toHaveText(title);
    await expect(pause).toBeEnabled();
    await expect.poll(async () => (await player("status")).positionMs).toBeGreaterThan(100);
  }
  await page.screenshot({ path: test.info().outputPath(`audio-codecs-${process.platform}.png`) });
});
