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
    wave: ["wave.library.counts"],
  });
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
