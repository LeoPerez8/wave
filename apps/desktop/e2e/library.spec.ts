import { copyFileSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import type { WaveBridge } from "../src/shared/bridge.ts";

const appFolder = join(import.meta.dirname, "..");
const fixture = join(
  appFolder,
  "../../packages/kotlin-shared/src/testFixtures/resources/fixtures/tagged.flac",
);
let folder: string;
let music: string;
let app: ElectronApplication;
let page: Page;
let firstId: number;
test.describe.configure({ mode: "serial" });

const launch = async () => {
  app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: join(folder, "data"), WAVE_MUSIC_DIR: music },
  });
  page = await app.firstWindow();
  await page.bringToFront();
};

const songs = () =>
  page.evaluate(() => (window as unknown as { wave: WaveBridge }).wave.library.songs(0, 200));
const songById = async (id: number) => {
  const first = await songs();
  for (let offset = 0; offset < first.total; offset += 200) {
    const pageOfSongs =
      offset === 0
        ? first
        : await page.evaluate(
            (offset) => (window as unknown as { wave: WaveBridge }).wave.library.songs(offset, 200),
            offset,
          );
    const song = pageOfSongs.items.find((song) => song.id === id);
    if (song !== undefined) return song;
  }
  return undefined;
};
const status = () =>
  page.evaluate(() => (window as unknown as { wave: WaveBridge }).wave.library.scanStatus());
const done = () =>
  expect.poll(async () => (await status()).status, { timeout: 30000 }).toBe("done");

test.beforeAll(async () => {
  folder = mkdtempSync(join(tmpdir(), "wave-library-e2e-"));
  music = join(folder, "Music");
  mkdirSync(music);
  for (let i = 0; i < 1200; i++)
    copyFileSync(fixture, join(music, `${String(i).padStart(4, "0")}.flac`));
  await launch();
});

test.afterAll(async () => {
  await app?.close();
  rmSync(folder, { recursive: true, force: true });
});

test("first launch shows progress, indexes Music with Kotlin and keeps list reads paged", async () => {
  await expect(page.getByTestId("scan-progress")).toBeVisible();
  await page.screenshot({ path: join(appFolder, "test-results", "library-progress.png") });
  await done();
  expect((await songs()).total).toBe(1200);
  expect((await songs()).items).toHaveLength(200);
  const covers = await page.evaluate(() =>
    (window as unknown as { wave: WaveBridge }).wave.library.browse({ kind: "albums" }, 0, 10),
  );
  expect(covers.items[0]?.artworkHash).toMatch(/^[a-f0-9]{40}$/);
  const image = await page.evaluate(
    (hash) => (window as unknown as { wave: WaveBridge }).wave.library.artwork(hash, true),
    covers.items[0]!.artworkHash!,
  );
  expect(image).toMatch(/^data:image\/jpeg;base64,/);
  firstId = (await songs()).items.find((song) => song.path?.endsWith("/0000.flac"))!.id;
  await page.screenshot({ path: join(appFolder, "test-results", "library-scanned.png") });
});

test("watching adds, changes, renames and deletes files without refresh", async () => {
  copyFileSync(fixture, join(music, "Added.flac"));
  await expect.poll(async () => (await songs()).total, { timeout: 15000 }).toBe(1201);
  renameSync(join(music, "0000.flac"), join(music, "Renamed.flac"));
  await expect
    .poll(async () => (await songById(firstId))?.path, { timeout: 15000 })
    .toMatch(/\/Renamed.flac$/);
  // A changed file becomes an untagged file: filename fallback proves its tags were reread.
  writeFileSync(join(music, "Renamed.flac"), "not a tagged audio file");
  await expect
    .poll(async () => (await songById(firstId))?.title, { timeout: 15000 })
    .toBe("Renamed");
  rmSync(join(music, "Added.flac"));
  await expect.poll(async () => (await songs()).total, { timeout: 15000 }).toBe(1200);
});

test("a disconnected root stays grey and refuses playback, then comes back with the same ids", async () => {
  await done();
  renameSync(music, join(folder, "Disconnected"));
  await expect
    .poll(async () => (await songs()).items.every((song) => song.unavailable), { timeout: 15000 })
    .toBe(true);
  expect((await songs()).total).toBe(1200);
  await expect(page.getByRole("row", { disabled: true }).first()).toBeVisible();
  const path = (await songs()).items[0]!.path!;
  const failure = await page.evaluate(async (path) => {
    try {
      await (window as unknown as { wave: WaveBridge }).wave.player.load(path);
      return "played";
    } catch (error) {
      return String(error);
    }
  }, path);
  expect(failure).toContain("folder-unavailable");
  await page.screenshot({ path: join(appFolder, "test-results", "library-unavailable.png") });
  renameSync(join(folder, "Disconnected"), music);
  await expect
    .poll(async () => (await songs()).items.every((song) => !song.unavailable), { timeout: 15000 })
    .toBe(true);
  expect((await songById(firstId))?.id).toBe(firstId);
});

test("F5 scans without reloading the window and opening catches changes made while closed", async () => {
  const revision = (await status()).revision;
  await page.keyboard.press("F5");
  await expect
    .poll(async () => (await status()).revision, { timeout: 15000 })
    .toBeGreaterThan(revision);
  await app.close();
  copyFileSync(fixture, join(music, "WhileClosed.flac"));
  await launch();
  await done();
  expect((await songs()).total).toBe(1201);
});

test("Settings adds a picked folder, filters recordings, excludes and includes a subfolder", async () => {
  const other = join(folder, "Other");
  mkdirSync(join(other, "Album"), { recursive: true });
  mkdirSync(join(other, "Recordings"));
  copyFileSync(fixture, join(other, "Album", "Extra.flac"));
  copyFileSync(fixture, join(other, "Recordings", "Note.flac"));
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const pick = (path: string) =>
    app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, path);
  await pick(other);
  await page.getByRole("button", { name: "Add folder", exact: true }).click();
  await expect.poll(async () => (await songs()).total, { timeout: 15000 }).toBe(1202);
  await done();
  await pick(join(other, "Album"));
  await page.getByRole("button", { name: "Exclude folder", exact: true }).click();
  await expect.poll(async () => (await songs()).total, { timeout: 15000 }).toBe(1201);
  await done();
  await page.getByRole("button", { name: "Stop excluding", exact: true }).click();
  await expect.poll(async () => (await songs()).total, { timeout: 15000 }).toBe(1202);
  await done();
  await page.getByRole("button", { name: /Remove .*Other/ }).click();
  await expect.poll(async () => (await songs()).total, { timeout: 15000 }).toBe(1201);
});
