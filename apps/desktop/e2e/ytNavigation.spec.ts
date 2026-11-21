import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { catalogueOf } from "@wave/core";

import type { WaveBridge } from "../src/shared/bridge.ts";
import type { PlayerView } from "../src/shared/playerView.ts";

/**
 * YouTube Music's artists and albums reached from Search and from a streamed song's names, in
 * the built app against the live YouTube Music (#1184): Search's Artists and Albums shelves, a
 * result row's artist and album names, the player bar's and Now Playing's, each opening its page,
 * and Back coming back to where it was. A bot check (#1144) ends the search in the quiet line,
 * which the `yt-navigation` annotation says instead of failing. CI stops before playing, as
 * YouTube often refuses streams to CI runners.
 */
const appFolder = join(import.meta.dirname, "..");
const text = catalogueOf("en", "desktop");

const view = (page: Page) =>
  page.evaluate(() =>
    (window as unknown as { wave: WaveBridge }).wave.playback.view(),
  ) as Promise<PlayerView>;

test("YT Music artists and albums open from Search, a result's names, the bar and Now Playing", async () => {
  test.setTimeout(240_000);
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-ytnav-"));
  mkdirSync(join(data, "Music"));
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Music") },
  });
  try {
    const page = await app.firstWindow();
    const back = page.getByRole("button", { name: text.desktopLayout.back, exact: true });
    const field = page.getByRole("searchbox", { name: text.desktopLayout.search });
    await field.fill("Chappell Roan");
    const results = page.getByTestId("yt-results");
    const quiet = page.getByTestId("yt-status");
    await expect(results.or(quiet)).toBeVisible({ timeout: 45_000 });
    if (await quiet.isVisible()) {
      test.info().annotations.push({ type: "yt-navigation", description: await quiet.innerText() });
      return;
    }
    const artists = results.getByRole("region", { name: text.playbackText.artists });
    const albums = results.getByRole("region", { name: text.playbackText.albums });
    await expect(artists.getByRole("button").first()).toBeVisible();
    await expect(albums.getByRole("button").first()).toBeVisible();
    await artists.scrollIntoViewIfNeeded();
    await page.screenshot({ path: "test-results/yt-navigation-search.png" });

    // An artist of the Artists shelf, then Back to the same results.
    await artists.getByRole("button").first().click();
    await expect(page.getByTestId("yt-artist")).toBeVisible({ timeout: 45_000 });
    await expect(page.getByTestId("yt-artist").locator("h1")).toHaveText(/\S/);
    await back.click();
    await expect(field).toHaveValue("Chappell Roan");
    await expect(artists.getByRole("button").first()).toBeVisible({ timeout: 45_000 });

    // An album of the Albums shelf.
    await albums.getByRole("button").first().click();
    await expect(page.getByTestId("yt-album")).toBeVisible({ timeout: 45_000 });
    await back.click();
    await expect(results).toBeVisible({ timeout: 45_000 });

    // A result row's artist and album names.
    const songs = page.getByTestId("yt-songs");
    const goToArtist = `${text.itemActions.labels.goToArtist}, `;
    const goToAlbum = `${text.itemActions.labels.goToAlbum}, `;
    await songs
      .getByRole("button", { name: new RegExp(`^${goToArtist}`) })
      .first()
      .click()
      .catch(async (e) => {
        console.log(
          "DIAG YT",
          JSON.stringify({
            songs: await songs.count(),
            text: (await page.locator("main").innerText()).slice(0, 3000),
            buttons: await songs
              .getByRole("button")
              .evaluateAll((all) =>
                all.slice(0, 20).map((b) => b.getAttribute("aria-label") ?? b.textContent),
              ),
          }),
        );
        throw e;
      });
    await expect(page.getByTestId("yt-artist")).toBeVisible({ timeout: 45_000 });
    await page.screenshot({ path: "test-results/yt-navigation-artist.png" });
    await back.click();
    await songs
      .getByRole("button", { name: new RegExp(`^${goToAlbum}`) })
      .first()
      .click();
    await expect(page.getByTestId("yt-album")).toBeVisible({ timeout: 45_000 });
    await page.screenshot({ path: "test-results/yt-navigation-album.png" });
    await back.click();
    await expect(songs).toBeVisible({ timeout: 45_000 });
    if (process.env["CI"] !== undefined) return;

    // A streamed song playing: the bar's names, then Now Playing's.
    await songs.getByRole("listitem").first().locator(".yt-row").dblclick();
    await expect
      .poll(async () => (await view(page)).current?.videoId, { timeout: 30_000 })
      .toBeTruthy();
    const bar = page.locator(".player-bar");
    await expect(bar.getByRole("button", { name: new RegExp(`^${goToArtist}`) })).toBeVisible();
    await page.screenshot({ path: "test-results/yt-navigation-bar.png" });
    await bar
      .getByRole("button", { name: new RegExp(`^${goToArtist}`) })
      .first()
      .click();
    await expect(page.getByTestId("yt-artist")).toBeVisible({ timeout: 45_000 });
    await back.click();
    await expect(page.getByTestId("search-page")).toBeVisible();

    // The title opens Now Playing; the names under it are links of their own.
    await bar.locator(".player-now .player-title").click();
    const nowPlaying = page.getByTestId("now-playing");
    await expect(nowPlaying).toBeVisible();
    await page.screenshot({ path: "test-results/yt-navigation-now-playing.png" });
    await nowPlaying.getByRole("button", { name: new RegExp(`^${goToAlbum}`) }).click();
    await expect(nowPlaying).toBeHidden();
    await expect(page.getByTestId("yt-album")).toBeVisible({ timeout: 45_000 });
    await back.click();
    await expect(page.getByTestId("search-page")).toBeVisible();
    // The title opens Now Playing; the names under it are links of their own.
    await bar.locator(".player-now .player-title").click();
    await nowPlaying
      .getByRole("button", { name: new RegExp(`^${goToArtist}`) })
      .first()
      .click();
    await expect(page.getByTestId("yt-artist")).toBeVisible({ timeout: 45_000 });
    await back.click();
    await expect(page.getByTestId("search-page")).toBeVisible();
    await page.evaluate(() => (window as unknown as { wave: WaveBridge }).wave.playback.pause());
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
