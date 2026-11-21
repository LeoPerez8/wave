import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test, type Page } from "@playwright/test";

import type { WaveBridge } from "../src/shared/bridge.ts";
import type { PlayerView } from "../src/shared/playerView.ts";

/**
 * A streamed YouTube Music song's menu (#1180), against the live YouTube Music: a Search result's
 * right-click, the player bar's menu and star, a Queue row's right-click and Now Playing's Add to
 * Playlist and Download. YouTube may ask a machine for a bot check (#1144); the test then stops
 * at the quiet line and says so in its `yt-search` annotation. Screenshots go to `test-results/`.
 */
const appFolder = join(import.meta.dirname, "..");

const view = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { wave: WaveBridge }).wave.playback.view(),
  ) as Promise<PlayerView>;

const shot = (page: Page, name: string) =>
  page.screenshot({ path: `test-results/streamed-${name}-${process.platform}.png` });

test("a streamed song's menu from Search, the player bar, the Queue and Now Playing", async () => {
  test.setTimeout(240_000);
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-streamed-"));
  mkdirSync(join(data, "Music"));
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Music") },
  });
  try {
    const page = await app.firstWindow();
    await page.setViewportSize({ width: 1400, height: 900 });
    await page.evaluate(() =>
      (window as unknown as { wave: WaveBridge }).wave.playlists.create("Evening"),
    );
    await page.getByRole("searchbox", { name: "Search" }).fill("nick drake pink moon");
    // The Library is empty, so YouTube Music is asked straight away.
    const results = page.getByTestId("yt-results");
    const quiet = page.getByTestId("yt-status");
    await expect(results.or(quiet)).toBeVisible({ timeout: 45_000 });
    if (await quiet.isVisible()) {
      test.info().annotations.push({ type: "yt-search", description: await quiet.innerText() });
      return;
    }
    const first = results.getByRole("listitem").first().locator(".yt-row");
    const menu = page.getByRole("menu");

    // Search: right-click opens the song menu.
    await first.click({ button: "right" });
    await expect(menu).toBeVisible();
    for (const entry of ["Play Next", "Add to Queue", "Add to Playlist", "Favorite", "Download"])
      await expect(menu.getByRole("menuitem", { name: entry, exact: true })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Go to Artist" })).toBeVisible();
    await shot(page, "search-menu");
    await menu.getByRole("menuitem", { name: "Add to Playlist" }).click();
    await menu.getByRole("menuitem", { name: "Evening" }).click();
    await expect(page.getByRole("status").filter({ hasText: "Evening" })).toBeVisible();
    // The song's download started with it, and says nothing that would take the toast's place.
    const downloads = await page.evaluate(() =>
      (window as unknown as { wave: WaveBridge }).wave.downloads.view(),
    );
    expect(downloads.rows).toBe(1);
    expect(downloads.notice).toBeNull();

    // The player bar: its menu and star, for the song streaming.
    await first.dblclick();
    await expect
      .poll(async () => (await view(page)).current?.videoId, { timeout: 30_000 })
      .toBeTruthy();
    const bar = page.locator(".player-bar");
    const star = bar.getByRole("button", { name: "Favorite", exact: true });
    await expect(star).toBeEnabled();
    await star.click();
    await expect(star).toHaveAttribute("aria-pressed", "true");
    await star.click();
    await expect(star).toHaveAttribute("aria-pressed", "false");
    await bar.getByRole("button", { name: "Song menu" }).click();
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Add to Playlist" })).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Play Next" })).toHaveCount(0);
    await shot(page, "bar-menu");
    await page.keyboard.press("Escape");

    // The Queue: right-click on a streamed row.
    await bar.getByRole("button", { name: "Queue", exact: true }).click();
    const row = page.locator(".queue-row").first();
    await expect(row).toBeVisible();
    await row.click({ button: "right" });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole("menuitem", { name: "Favorite" })).toBeVisible();
    await shot(page, "queue-menu");
    await page.keyboard.press("Escape");

    // Now Playing: Add to Playlist and Download.
    await bar.locator(".player-now .player-title").click();
    const actions = page.getByTestId("now-playing-actions");
    await expect(actions.getByRole("button", { name: "Add to Playlist" })).toBeVisible();
    // Add to Playlist asked for the song's download: Download follows it until it's here.
    await expect(
      actions.getByRole("button", {
        name: /^(Download|Waiting to download|Downloading.*|Downloaded)$/,
      }),
    ).toBeVisible();
    await shot(page, "now-playing");
    // YouTube often refuses streams to CI runners' addresses, so CI stops before the download.
    if (process.env["CI"] !== undefined) return;
    await expect(actions.getByRole("button", { name: "Downloaded" })).toBeVisible({
      timeout: 90_000,
    });
    await shot(page, "now-playing-downloaded");
    // Its playlist entry became the Library's song.
    await expect
      .poll(
        () =>
          page.evaluate(async () => {
            const wave = (window as unknown as { wave: WaveBridge }).wave;
            const lists = await wave.library.browse({ kind: "playlists" }, 0, 10);
            const id = lists.items.find((row) => row.title === "Evening")!.id;
            return (await wave.library.browse({ kind: "playlist", id }, 0, 10)).total;
          }),
        { timeout: 30_000 },
      )
      .toBe(1);
    await actions.getByRole("button", { name: "Add to Playlist" }).click();
    await expect(menu.getByRole("menuitem", { name: "Evening" })).toBeVisible();
    await page.keyboard.press("Escape");
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
