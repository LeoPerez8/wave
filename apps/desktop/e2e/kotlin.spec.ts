import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import type { SongTags } from "../src/shared/tags.ts";

/**
 * The shared Kotlin in the built app, on the JVM `pnpm build:jvm` built, from the window's
 * bridge. Reads the tag fixtures the phone's tests read.
 */
const appFolder = join(import.meta.dirname, "..");
const fixtures = join(
  appFolder,
  "..",
  "..",
  "packages",
  "kotlin-shared",
  "src",
  "testFixtures",
  "resources",
  "fixtures",
);
let dataFolder: string;
let app: ElectronApplication;
let page: Page;

test.beforeAll(async () => {
  dataFolder = mkdtempSync(join(tmpdir(), "wave-e2e-kotlin-"));
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

const readTags = (path: string): Promise<SongTags> =>
  page.evaluate(
    (path) =>
      (
        globalThis as unknown as { wave: { tags: { read: (path: string) => Promise<SongTags> } } }
      ).wave.tags.read(path),
    path,
  );

/** The JVM's pid: main's child running java. */
const jvmPid = async (): Promise<number | undefined> => {
  // Main's own pid: on Windows, Playwright's process is a launcher in front of it.
  const main = await app.evaluate(() => process.pid);
  const found =
    process.platform === "win32"
      ? execFileSync(
          "powershell.exe",
          [
            "-NoProfile",
            "-Command",
            `(Get-CimInstance Win32_Process -Filter "ParentProcessId=${main} AND Name='java.exe'").ProcessId`,
          ],
          { encoding: "utf8" },
        )
      : execFileSync("ps", ["-o", "pid=,comm=", "--ppid", String(main)], { encoding: "utf8" })
          .split("\n")
          .filter((line) => line.trim().endsWith("java"))
          .join("\n");
  const pid = Number.parseInt(found.trim(), 10);
  return Number.isNaN(pid) ? undefined : pid;
};

/** The JVM's resident memory in MB, as the OS reports it. */
const residentMb = (pid: number): number => {
  const bytes =
    process.platform === "win32"
      ? Number(
          execFileSync(
            "powershell.exe",
            ["-NoProfile", "-Command", `(Get-Process -Id ${pid}).WorkingSet64`],
            { encoding: "utf8" },
          ),
        )
      : Number(/VmRSS:\s+(\d+) kB/.exec(readFileSync(`/proc/${pid}/status`, "utf8"))?.[1]) * 1024;
  return Math.round(bytes / 1024 / 1024);
};

for (const file of [
  "tagged.mp3",
  "tagged.flac",
  "tagged-aac.m4a",
  "tagged.ogg",
  "tagged.opus",
  "tagged.wav",
])
  test(`the JVM reads ${file}'s tags`, async () => {
    expect(await readTags(join(fixtures, file))).toMatchObject({
      title: "Wave Fixture",
      artist: "Fixture Artist",
      album: "Fixture Album",
      genre: "Ambient",
    });
  });

test("a file that isn't there reads as untagged, as on the phone", async () => {
  expect(await readTags(join(fixtures, "missing.flac"))).toMatchObject({
    title: null,
    artist: null,
    durationMs: 0,
  });
  await expect(readTags("relative/tagged.flac")).rejects.toThrow(/Refused tags\.read/);
});

test("the JVM's memory at rest is recorded", async () => {
  await readTags(join(fixtures, "tagged.flac"));
  await page.waitForTimeout(5_000);
  const pid = await jvmPid();
  expect(pid).toBeDefined();
  const mb = residentMb(pid as number);
  test.info().annotations.push({ type: "jvm-resident-mb", description: String(mb) });
  console.log(`JVM resident at rest: ${mb} MB (${process.platform})`);
  expect(mb).toBeGreaterThan(0);
});

test("killing the JVM fails the call it held, and the next call works", async () => {
  const song = join(fixtures, "tagged.flac");
  const first = await jvmPid();
  expect(first).toBeDefined();
  // Reads one after another, so a read is waiting on the JVM when it dies.
  await page.evaluate((song) => {
    const state = globalThis as unknown as {
      wave: { tags: { read: (path: string) => Promise<unknown> } };
      outcomes: string[];
      reading: boolean;
    };
    state.outcomes = [];
    state.reading = true;
    void (async () => {
      while (state.reading)
        state.outcomes.push(
          await state.wave.tags.read(song).then(
            () => "read",
            (error: unknown) => String(error),
          ),
        );
    })();
  }, song);
  await expect
    .poll(() =>
      page.evaluate(() => (globalThis as unknown as { outcomes: string[] }).outcomes.length),
    )
    .toBeGreaterThan(0);
  process.kill(first as number);

  const outcomes = () =>
    page.evaluate(() => (globalThis as unknown as { outcomes: string[] }).outcomes);
  await expect
    .poll(async () => (await outcomes()).some((outcome) => outcome !== "read"))
    .toBe(true);
  // The last outcome is a read again: the restarted JVM answers.
  await expect.poll(async () => (await outcomes()).at(-1)).toBe("read");
  await page.evaluate(() => {
    (globalThis as unknown as { reading: boolean }).reading = false;
  });
  const failures = (await outcomes()).filter((outcome) => outcome !== "read");
  for (const failure of failures) expect(failure).toMatch(/\[ERR_UNEXPECTED\]/);
  expect(await jvmPid()).not.toBe(first);
  expect(app.windows()).toHaveLength(1);
});
