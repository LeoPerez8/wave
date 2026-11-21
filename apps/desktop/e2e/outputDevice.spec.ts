/**
 * Settings › Playback › Output in the real window, on the system's real outputs: the list,
 * moving a song to another output where it is, and the choice after a restart. A machine with
 * no output (CI) shows only System default; unplugging is covered against a fake in
 * `src/main/bridge.test.ts` and by the owner.
 */
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { catalogueOf } from "@wave/core";
import type { WaveBridge } from "../src/shared/bridge.ts";

const appFolder = join(import.meta.dirname, "..");
const song = join(appFolder, "native", "engine", "tests", "fixtures", "tone.flac");
const text = catalogueOf("en", "desktop");

const launch = (dataFolder: string) =>
  electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: dataFolder, WAVE_MUSIC_DIR: join(dataFolder, "Absent") },
  });

const outputSelect = async (page: Page) => {
  await page.getByRole("button", { name: text.desktopLayout.settings, exact: true }).click();
  await page.getByRole("button", { name: text.desktopLayout.playback, exact: true }).click();
  return page.getByRole("combobox", { name: text.desktopOutput.output });
};

const status = (page: Page) =>
  page.evaluate(() => (window as unknown as { wave: WaveBridge }).wave.player.status());

test("an output picked in Settings takes the song where it is and is kept", async () => {
  const dataFolder = mkdtempSync(join(tmpdir(), "wave-e2e-output-"));
  let app: ElectronApplication | undefined;
  try {
    app = await launch(dataFolder);
    let page = await app.firstWindow();
    let select = await outputSelect(page);
    await expect(select).toHaveValue("");
    await expect(select.locator("option").first()).toHaveText(text.desktopOutput.systemDefault);

    // The list is the system's own, in the engine's order, after System default.
    await expect
      .poll(async () => (await status(page)).device !== undefined || process.env.CI !== undefined)
      .toBe(true);
    const { outputs } = await page.evaluate(() =>
      (window as unknown as { wave: WaveBridge }).wave.settings.outputs(),
    );
    await expect(select.locator("option")).toHaveText([
      text.desktopOutput.systemDefault,
      ...outputs.map((output) => output.name),
    ]);
    mkdirSync(join(appFolder, "test-results"), { recursive: true });
    await page.screenshot({
      path: join(appFolder, "test-results", `output-device-${process.platform}.png`),
    });
    test.info().annotations.push({ type: "outputs", description: String(outputs.length) });
    if (outputs.length === 0) return;

    await page.evaluate(async (path) => {
      const { player } = (window as unknown as { wave: WaveBridge }).wave;
      await player.load(path);
      await player.seek(400);
    }, song);
    const playing = (await status(page)).device;
    const picked = outputs.find((output) => output.name !== playing) ?? outputs[0]!;
    const before = Date.now();
    await select.selectOption(picked.id);
    await expect
      .poll(async () => (await status(page)).device, { intervals: [25], timeout: 1_000 })
      .toBe(picked.name);
    test.info().annotations.push({ type: "moved-ms", description: String(Date.now() - before) });
    expect((await status(page)).positionMs).toBe(400);

    await app.close();
    app = await launch(dataFolder);
    page = await app.firstWindow();
    select = await outputSelect(page);
    await expect(select).toHaveValue(picked.id);
    await expect.poll(async () => (await status(page)).device).toBe(picked.name);

    await select.selectOption("");
    await expect(select).toHaveValue("");
    await expect
      .poll(() =>
        page.evaluate(() => (window as unknown as { wave: WaveBridge }).wave.settings.outputs()),
      )
      .toMatchObject({ chosen: null });
  } finally {
    await app?.close();
    rmSync(dataFolder, { recursive: true, force: true });
  }
});
