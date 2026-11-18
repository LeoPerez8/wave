import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test, type Page } from "@playwright/test";

import type { WaveBridge } from "../src/shared/bridge.ts";
import type { PlayerView } from "../src/shared/playerView.ts";

/**
 * YT Music in the built app with the JVM `pnpm build:jvm` built, against the live YouTube Music:
 * the setting and the sidebar's entries, then Search's YouTube Music songs, one played, seeked
 * and moved on from. YouTube may ask a machine for a bot check (#1144); the search then ends in
 * the quiet line, and the test says so in its `yt-search` annotation instead of failing.
 * YouTube often refuses streams to CI runners' addresses, so CI stops after the search.
 */
const appFolder = join(import.meta.dirname, "..");

const view = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { wave: WaveBridge }).wave.playback.view(),
  ) as Promise<PlayerView>;

test("YT Music: the setting, the sidebar, Search's results, and a song that plays and seeks", async () => {
  test.setTimeout(150_000);
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-yt-"));
  mkdirSync(join(data, "Music"));
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Music") },
  });
  try {
    const page = await app.firstWindow();
    const sidebar = page.locator(".sidebar");
    // A narrow window hides the sidebar's headings, so the entries say whether YT Music is on.
    await expect(sidebar.getByRole("button", { name: "Discover" })).toBeVisible();
    await expect(sidebar.getByRole("button", { name: "Magic Queue" })).toBeEnabled();
    await expect(sidebar.getByRole("button", { name: "Downloads" })).toBeEnabled();

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Accounts" }).click();
    const toggle = page.getByRole("checkbox", { name: "Use YT Music" });
    await expect(toggle).toBeChecked();
    await toggle.uncheck();
    await expect(sidebar.getByRole("button", { name: "Discover" })).toBeHidden();
    await page.getByRole("searchbox", { name: "Search" }).fill("nick drake pink moon");
    await page.waitForTimeout(1_500);
    await expect(page.getByTestId("yt-results")).toHaveCount(0);
    await expect(page.getByTestId("yt-status")).toHaveCount(0);

    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Accounts" }).click();
    await page.getByRole("checkbox", { name: "Use YT Music" }).check();
    // The field kept the text, so it changes to bring Search back.
    await page.getByRole("searchbox", { name: "Search" }).fill("nick drake pink moo");
    await page.getByRole("searchbox", { name: "Search" }).fill("nick drake pink moon");
    const results = page.getByTestId("yt-results");
    const quiet = page.getByTestId("yt-status");
    await expect(results.or(quiet)).toBeVisible({ timeout: 45_000 });
    await page.screenshot({ path: "test-results/yt-search.png" });
    if (await quiet.isVisible()) {
      test.info().annotations.push({ type: "yt-search", description: await quiet.innerText() });
      return;
    }
    const rows = results.getByRole("listitem");
    test.info().annotations.push({ type: "yt-search", description: `${await rows.count()} songs` });
    if (process.env["CI"] !== undefined) return;
    await rows.first().dblclick();
    await expect
      .poll(async () => (await view(page)).current?.videoId, { timeout: 30_000 })
      .toBeTruthy();
    await expect
      .poll(async () => (await view(page)).status.state, { timeout: 60_000 })
      .toBe("playing");
    await expect
      .poll(async () => (await view(page)).status.positionMs, { timeout: 30_000 })
      .toBeGreaterThan(1_000);
    await page.screenshot({ path: "test-results/yt-playing.png" });

    await page.evaluate(() =>
      (window as unknown as { wave: WaveBridge }).wave.playback.seek(90_000),
    );
    await expect
      .poll(async () => (await view(page)).status.positionMs, { timeout: 30_000 })
      .toBeGreaterThan(90_000);

    const first = (await view(page)).current?.videoId;
    await page.evaluate(() =>
      (window as unknown as { wave: WaveBridge }).wave.playback.command({ type: "next" }),
    );
    await expect
      .poll(async () => (await view(page)).current?.videoId, { timeout: 30_000 })
      .not.toBe(first);
    await expect
      .poll(async () => (await view(page)).status.state, { timeout: 60_000 })
      .toBe("playing");
    test.info().annotations.push({
      type: "yt-device",
      description: (await view(page)).status.device ?? "none",
    });
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
