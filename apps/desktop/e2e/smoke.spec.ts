import { spawn } from "node:child_process";
import { createRequire } from "node:module";
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
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { catalogueOf } from "@wave/core";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";

const appFolder = join(import.meta.dirname, "..");
/** From Node, the electron package is the path of its executable. */
const electronPath = createRequire(import.meta.url)("electron") as string;
let dataFolder: string;
let app: ElectronApplication;
let page: Page;

/** The app as a user starts it, in English, on a Library of three songs. */
test.beforeAll(async () => {
  dataFolder = mkdtempSync(join(tmpdir(), "wave-e2e-"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      for (const title of ["Pink Moon", "Place to Be", "Road"]) addTrack(db, { title });
    }).pipe(Effect.provide(libraryLayer(join(dataFolder, "wave.db")))),
  );
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

test("the window shows the Library's song count from the database", async () => {
  await expect(page.getByTestId("song-count")).toHaveText(
    catalogueOf("en", "desktop").library.songCount(3),
  );
  await page.screenshot({ path: join(appFolder, "test-results", "library.png") });
});

test("the page has no Node and only the typed bridge", async () => {
  const reach = await page.evaluate(() => {
    const paths = (value: unknown, path: string): string[] =>
      typeof value === "object" && value !== null
        ? Object.entries(value).flatMap(([key, inner]) => paths(inner, `${path}.${key}`))
        : [path];
    return {
      require: typeof (globalThis as { require?: unknown }).require,
      process: typeof (globalThis as { process?: unknown }).process,
      wave: paths((globalThis as { wave?: unknown }).wave, "wave"),
    };
  });
  expect(reach).toEqual({
    require: "undefined",
    process: "undefined",
    wave: [
      "wave.system.mediaBackend",
      "wave.playback.view",
      "wave.playback.start",
      "wave.playback.startYt",
      "wave.playback.command",
      "wave.playback.play",
      "wave.playback.pause",
      "wave.playback.seek",
      "wave.playback.undo",
      "wave.playback.dismissUndo",
      "wave.playback.favorite",
      "wave.playback.volume",
      "wave.playback.queue",
      "wave.playback.setSleepTimer",
      "wave.lyrics.song",
      "wave.library.artwork",
      "wave.library.cover",
      "wave.library.browse",
      "wave.library.letter",
      "wave.library.counts",
      "wave.library.scanStatus",
      "wave.library.refresh",
      "wave.library.songs",
      "wave.library.roots",
      "wave.library.exclusions",
      "wave.library.addRoot",
      "wave.library.exclude",
      "wave.library.removeRoot",
      "wave.library.include",
      "wave.songs.actions",
      "wave.songs.run",
      "wave.player.load",
      "wave.player.play",
      "wave.player.pause",
      "wave.player.seek",
      "wave.player.status",
      "wave.tags.read",
      "wave.settings.appearance",
      "wave.settings.window",
      "wave.settings.setWindow",
      "wave.settings.setAppearance",
      "wave.settings.playback",
      "wave.settings.setPlayback",
      "wave.settings.ytMusic",
      "wave.settings.setYtMusic",
      "wave.yt.search",
      "wave.yt.artwork",
      "wave.yt.artist",
      "wave.yt.findArtist",
      "wave.yt.album",
      "wave.yt.related",
      "wave.yt.queue",
      "wave.discover.picks",
      "wave.discover.mixes",
      "wave.discover.playMix",
      "wave.magicQueue.start",
      "wave.magicQueue.startStreamed",
      "wave.magicQueue.view",
      "wave.magicQueue.retry",
      "wave.downloads.view",
      "wave.downloads.rows",
      "wave.downloads.album",
      "wave.downloads.yt",
      "wave.downloads.missing",
      "wave.downloads.missingAction",
      "wave.downloads.retry",
      "wave.downloads.cancel",
      "wave.downloads.clearFailed",
      "wave.downloads.folder",
      "wave.downloads.pickFolder",
      "wave.downloads.bestQuality",
      "wave.downloads.setBestQuality",
      "wave.account.view",
      "wave.account.signIn",
      "wave.account.cancelSignIn",
      "wave.account.signOut",
      "wave.account.signOutEverywhere",
      "wave.account.answerInvitation",
      "wave.playlists.checkName",
      "wave.playlists.newName",
      "wave.playlists.create",
      "wave.playlists.rename",
      "wave.playlists.delete",
      "wave.playlists.info",
      "wave.playlists.undoRemove",
      "wave.playlists.move",
      "wave.playlists.graveyard",
      "wave.playlists.restore",
      "wave.playlists.forget",
      "wave.playlists.chooseImport",
      "wave.playlists.runImport",
      "wave.playlists.pickImage",
      "wave.playlists.adjustImage",
      "wave.playlists.saveImage",
      "wave.playlists.cancelImage",
      "wave.playlists.removeImage",
      "wave.playlists.image",
      "wave.search.library",
      "wave.search.recent",
      "wave.search.remember",
      "wave.search.clearRecent",
      "wave.home.view",
      "wave.home.play",
      "wave.links.open",
      "wave.links.importPlaylist",
      "wave.links.copySong",
      "wave.links.copyPlaylist",
    ],
  });
});

test("Settings › Playback keeps a change to Crossfade, Normalize Volume and Buffer", async () => {
  const text = catalogueOf("en", "desktop");
  await page.getByRole("button", { name: text.desktopLayout.settings, exact: true }).click();
  await page.getByRole("button", { name: text.desktopLayout.playback, exact: true }).click();
  const crossfade = page.getByRole("slider", { name: text.settings.crossfade });
  await expect(crossfade).toHaveAttribute("aria-valuetext", text.settings.off);
  await crossfade.fill("6.5");
  await expect(crossfade).toHaveAttribute("aria-valuetext", text.settings.seconds(6.5));
  await page.getByRole("switch", { name: text.settings.normalizeVolume }).uncheck();
  await page.getByRole("combobox", { name: text.settings.buffer }).selectOption(String(10));
  await expect
    .poll(() =>
      page.evaluate(() => (window as unknown as { wave: WaveBridge }).wave.settings.playback()),
    )
    .toEqual({ crossfadeSeconds: 6.5, normalizeVolume: false, bufferMinutes: 10 });
});

test("the CSP stops the page evaluating strings as code", async () => {
  // Playwright's own page.evaluate bypasses the CSP, so the probe runs as the page's script.
  const outcome = await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0]?.webContents.executeJavaScript(
      "(() => { try { new Function('return 1')(); return 'ran'; } catch (error) { return error.name; } })()",
    ),
  );
  expect(outcome).toBe("EvalError");
});

test("the window stays on Wave; web links open in the system browser", async () => {
  await app.evaluate(({ shell }) => {
    const opened: string[] = [];
    (globalThis as { opened?: string[] }).opened = opened;
    shell.openExternal = async (url: string) => void opened.push(url);
  });
  const start = page.url();
  await page.evaluate(() => {
    window.open("https://example.com/opened");
    location.href = "https://example.com/followed";
  });
  await page.waitForTimeout(500);
  expect(page.url()).toBe(start);
  expect(app.windows()).toHaveLength(1);
  const opened = await app.evaluate(() => (globalThis as { opened?: string[] }).opened);
  expect(opened).toEqual(["https://example.com/opened", "https://example.com/followed"]);
});

test("a second launch shows and focuses the running window, then quits", async () => {
  const visible = () =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.isVisible());
  await expect.poll(visible).toBe(true);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]?.hide());
  expect(await visible()).toBe(false);
  const second = spawn(electronPath, [appFolder, "--lang=en-US"], {
    env: { ...process.env, WAVE_DATA_DIR: dataFolder },
    stdio: "ignore",
  });
  const exitCode = await new Promise<number | null>((resolve) => second.once("exit", resolve));
  expect(exitCode).toBe(0);
  await expect.poll(visible).toBe(true);
  await expect
    .poll(() => app.evaluate(({ BrowserWindow }) => BrowserWindow.getFocusedWindow() !== null))
    .toBe(true);
  expect(app.windows()).toHaveLength(1);
});

test("with YouTube Music on, Discover and the Magic Queue open from the sidebar", async () => {
  const text = catalogueOf("en", "desktop");
  await page.evaluate(() =>
    (window as unknown as { wave: WaveBridge }).wave.settings.setYtMusic(true),
  );
  await page.reload();
  await page.getByRole("button", { name: text.desktopLayout.discover, exact: true }).click();
  await expect(page.getByTestId("discover")).toBeVisible();
  await expect(page.getByTestId("discover").locator(".tile")).toHaveCount(3);
  await page.getByRole("button", { name: text.desktopLayout.magicQueue, exact: true }).click();
  await expect(page.getByTestId("magic-queue")).toContainText(text.desktopLayout.magicQueueIdle);
});
