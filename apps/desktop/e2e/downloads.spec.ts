import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test, type Page } from "@playwright/test";

import type { WaveBridge } from "../src/shared/bridge.ts";
import type { DownloadsView } from "../src/shared/downloads.ts";
import type { SongTags } from "../src/shared/tags.ts";

/**
 * Downloads in the built app with the JVM `pnpm build:jvm` built, against the live YouTube
 * Music: Settings › Downloads' folder, a Search result downloaded from its Download button, the
 * sidebar's percentage and the Downloads page, and the file in the Library with its tags.
 * YouTube may refuse a machine (#1144) or CI's addresses, so the test stops after the search
 * there and says so in its annotation.
 */
const appFolder = join(import.meta.dirname, "..");

type Wave = { wave: WaveBridge & { tags: { read: (path: string) => Promise<SongTags> } } };
const downloads = (page: Page) =>
  page.evaluate(() => (window as unknown as Wave).wave.downloads.view()) as Promise<DownloadsView>;

/** The audio files under [folder], at any depth. */
const audioFiles = (folder: string): string[] =>
  readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) return audioFiles(path);
    return /\.(m4a|mp3)$/i.test(name) ? [path] : [];
  });

test("a YouTube Music song downloads into the Library with its tags", async () => {
  test.setTimeout(240_000);
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-downloads-"));
  const music = join(data, "Music");
  mkdirSync(music);
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: music },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Downloads", exact: true }).last().click();
    // The Library keeps its folders as resolved paths with forward slashes.
    await expect(page.getByTestId("downloads-folder")).toHaveText(
      /wave-e2e-downloads-\w+[/\\]Music$/,
    );
    await expect(
      page.getByRole("checkbox", { name: "Download in best quality" }),
    ).not.toBeChecked();

    await page.getByRole("searchbox", { name: "Search" }).fill("nick drake pink moon");
    const results = page.getByTestId("yt-results");
    const quiet = page.getByTestId("yt-status");
    await expect(results.or(quiet)).toBeVisible({ timeout: 45_000 });
    if (await quiet.isVisible()) {
      test.info().annotations.push({ type: "downloads", description: await quiet.innerText() });
      return;
    }
    if (process.env["CI"] !== undefined) return;
    await results
      .getByRole("button", { name: /^Download, / })
      .first()
      .click();
    await expect.poll(async () => (await downloads(page)).run?.total, { timeout: 15_000 }).toBe(1);

    await page.getByTestId("downloads-nav").click();
    await expect(page.getByTestId("downloads-page")).toBeVisible();
    await page.screenshot({ path: "test-results/downloads-page.png" });
    // The run ends once its song is in the Library or has failed; a failure says why.
    await expect
      .poll(async () => (await downloads(page)).progress, { timeout: 180_000, intervals: [1_000] })
      .toBeNull();
    const rows = await page.evaluate(() => (window as unknown as Wave).wave.downloads.rows(0, 10));
    expect(rows.items.map((row) => row.status)).toEqual([]);
    await expect(page.getByText("Songs you download show here")).toBeVisible();

    const [file] = audioFiles(music);
    expect(file).toBeDefined();
    const tags = await page.evaluate(
      (path) => (window as unknown as Wave).wave.tags.read(path),
      file!,
    );
    test.info().annotations.push({ type: "downloads", description: file! });
    expect(tags.title).toBeTruthy();
    expect(tags.artist).toBeTruthy();
    expect(tags.album).toBeTruthy();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Wave).wave.library.counts()), {
        timeout: 30_000,
      })
      .toMatchObject({ songs: 1 });
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
