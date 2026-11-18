import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
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

test.beforeAll(async () => {
  dataFolder = mkdtempSync(join(tmpdir(), "wave-e2e-audio-"));
  app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: dataFolder },
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

for (const format of ["wav", "flac", "mp3", "m4a", "ogg", "opus"])
  test(`a ${format} file plays, pauses, seeks and reports its position`, async () => {
    const loaded = await player("load", join(fixtures, `tone.${format}`));
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
