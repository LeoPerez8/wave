import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, star, type TestDatabase } from "@wave/client/testing";
import { recordPlay } from "@wave/client/db/playHistory";
import { ytTrackId, type PlayEvent } from "@wave/core";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";

const appFolder = join(import.meta.dirname, "..");
const videoId = "bcdefghijkl";

const counted = (trackId: string, startedAt: number): PlayEvent => ({
  trackId,
  startedAt,
  counted: true,
  listenedMs: 180000,
  durationMs: 180000,
  endReason: "completed",
  source: "desktop",
  context: null,
});

const scrollTop = (page: Page) => page.locator(".content").evaluate((el) => el.scrollTop);

test("Home's shelves open their full lists, Back keeps the scroll, and Most played streams", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-home-see-all-"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      // Fifteen albums: more than a Home shelf's twelve.
      for (let i = 0; i < 15; i++) {
        const id = addTrack(db, {
          title: `Song ${i}`,
          album: `Album ${i}`,
          artist: `Artist ${i}`,
          addedAt: i + 1,
          durationMs: 180000,
        });
        star(db, id, i + 1);
        recordPlay(db, counted(String(id), 1000 + i));
      }
      const song = {
        videoId,
        title: "Streamed Song",
        artists: ["Streamed Artist"],
        album: "Streamed Album",
        albumId: null,
        artworkUrl: null,
        durationMs: 180000,
        explicit: false,
      };
      for (const at of [2000, 2001, 2002])
        recordPlay(db, counted(ytTrackId(videoId), at), false, song);
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    await page.bringToFront();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1200, 700));
    const home = page.getByTestId("home");
    const heading = page.locator(".page-heading h1");

    // Most played lists the streamed song with its counted plays.
    const mostPlayed = home.getByRole("grid", { name: "Most played" });
    await expect(mostPlayed.getByRole("row").nth(1)).toContainText("Streamed Song");
    await expect(mostPlayed.getByRole("row").nth(1)).toContainText("3 plays");

    // See all, by keyboard, opens the whole list; Back returns to the same place.
    const recentlyAdded = home.locator('[data-section="recently-added"]');
    await expect(recentlyAdded.getByRole("button", { name: /Album/ })).toHaveCount(12);
    const albumsSeeAll = home
      .locator('[data-section="most-played-albums"]')
      .getByRole("button", { name: "See all", exact: true });
    await albumsSeeAll.scrollIntoViewIfNeeded();
    await albumsSeeAll.focus();
    const kept = await scrollTop(page);
    expect(kept).toBeGreaterThan(0);
    await page.keyboard.press("Enter");
    await expect(heading).toHaveText("Top albums");
    await expect(page.getByRole("grid", { name: "Top albums" })).toHaveAttribute(
      "aria-rowcount",
      "17",
    );
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(mostPlayed).toBeVisible();
    await expect.poll(() => scrollTop(page)).toBe(kept);

    await recentlyAdded.getByRole("button", { name: "See all", exact: true }).click();
    await expect(heading).toHaveText("Recently added");
    const added = page.getByRole("grid", { name: "Recently added" });
    await expect(added).toHaveAttribute("aria-rowcount", "16");
    await expect(added.getByRole("row").nth(1)).toContainText("Album 14");
    await page.screenshot({ path: join(appFolder, "test-results", "home-see-all.png") });
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(mostPlayed).toBeVisible();

    for (const [section, title, grid] of [
      ["recently-played", "Recently played", "Recently played"],
      ["most-played-artists", "Top artists", "Top artists"],
      ["favorites", "Favorites", "Favorites"],
    ] as const) {
      await home
        .locator(`[data-section="${section}"]`)
        .getByRole("button", { name: "See all", exact: true })
        .click();
      await expect(heading).toHaveText(title);
      await expect(page.getByRole("grid", { name: grid })).toBeVisible();
      await expect(page.getByRole("grid", { name: grid }).getByRole("row")).not.toHaveCount(1);
      await page.keyboard.press("Alt+ArrowLeft");
      await expect(mostPlayed).toBeVisible();
    }

    // A double-click on the streamed row streams it.
    await mostPlayed.getByRole("row").nth(1).dblclick();
    await expect
      .poll(
        async () =>
          (
            await page.evaluate(() =>
              (window as unknown as { wave: WaveBridge }).wave.playback.view(),
            )
          ).current?.videoId,
        { timeout: 30000 },
      )
      .toBe(videoId);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
