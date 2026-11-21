import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { Database } from "@wave/client";
import { createPlaylist } from "@wave/client/db/playlists";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { catalogueOf } from "@wave/core";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";
import type { BrowseRow } from "../src/shared/browse.ts";

const appFolder = join(import.meta.dirname, "..");
const text = catalogueOf("en", "desktop");

/** A streamed offer's row, as main's view gives it. */
const offer = (n: number): BrowseRow => ({
  id: 0,
  videoId: `offer${String(n).padStart(6, "0")}`,
  title: `Offer ${n}`,
  artist: `Offer Artist ${n}`,
  artists: [`Offer Artist ${n}`],
  album: "",
  albumId: null,
  artworkHash: null,
  artworkUrl: null,
  durationMs: 200_000,
  count: 0,
  year: null,
  genre: null,
  trackNumber: null,
  favorite: false,
  path: null,
  unavailable: false,
});

test("a playlist's Recommended songs sit below its songs: Add, Dismiss, Refresh, a failed read's Try Again and Go to Suggestions; none with YT Music off", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-playlist-suggestions-"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      const ids = Array.from({ length: 60 }, (_, n) =>
        addTrack(db, { title: `Song ${n + 1}`, artist: "Mine" }),
      );
      createPlaylist(
        db as never,
        "Long one",
        ids.map((trackId) => ({ source: "library", trackId })),
        1,
      );
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    // Main's visit over a fixture: five offers from a pool, a slot taking the next on a tap.
    const calls = await app.evaluateHandle(
      ({ ipcMain }, pool) => {
        const seen: string[] = [];
        const world = { next: 5, showing: pool.slice(0, 5), failed: true };
        const view = () =>
          world.failed
            ? { shown: true, loading: false, error: "load", slots: [], offered: true }
            : {
                shown: true,
                loading: false,
                error: null,
                slots: world.showing.map((row) => ({ kind: "offer", key: row.videoId, row })),
                offered: true,
              };
        const take = (key: string) => {
          const at = world.showing.findIndex((row) => row.videoId === key);
          if (at < 0) return false;
          world.showing = world.showing.map((row, i) => (i === at ? pool[world.next++]! : row));
          return true;
        };
        const handle = (channel: string, run: (...args: readonly unknown[]) => unknown) => {
          ipcMain.removeHandler(channel);
          ipcMain.handle(channel, (_event, ...args: unknown[]) => {
            seen.push([channel, ...args].join(" "));
            return run(...args);
          });
        };
        handle("playlistSuggestions.view", () => view());
        handle("playlistSuggestions.add", (_id, key) => take(key as string));
        handle("playlistSuggestions.dismiss", (_id, key) => take(key as string));
        handle("playlistSuggestions.refresh", () => {
          world.showing = pool.slice(world.next, world.next + 5);
          world.next += 5;
          return "updated";
        });
        handle("playlistSuggestions.retry", () => {
          world.failed = false;
        });
        handle("playlistSuggestions.close", () => undefined);
        return seen;
      },
      Array.from({ length: 30 }, (_, n) => offer(n)),
    );
    await page.evaluate(() =>
      (window as unknown as { wave: WaveBridge }).wave.settings.setYtMusic(true),
    );
    await page.reload();
    await page
      .locator(".sidebar-playlists")
      .getByRole("button", { name: "Long one", exact: true })
      .click();
    await expect(page.getByTestId("hero")).toContainText("Long one");

    const section = page.getByTestId("playlist-suggestions");
    // The failed read: its line and Try Again; the playlist's songs stay usable.
    await expect(section).toContainText(text.playbackText.couldntLoadRecommendations);
    await expect(page.getByRole("row", { name: /Song 1\b/ }).first()).toBeVisible();

    // A long playlist's section is below what the page shows: Go to Suggestions takes it there.
    const go = page.getByRole("button", { name: text.playlists.goToSuggestions });
    await expect(go).toBeVisible();
    await go.click();
    await expect(section).toBeInViewport();
    await section.getByRole("button", { name: text.playlists.tryAgain }).click();

    const list = section.getByRole("list", { name: text.playlists.recommendedSongs });
    await expect(list.getByRole("listitem")).toHaveCount(5);
    await expect(list).toContainText("Offer 0");
    await page.screenshot({ path: test.info().outputPath("playlist-suggestions.png") });

    await list.getByRole("button", { name: text.playlists.addRecommendation("Offer 0") }).click();
    await expect(list).toContainText("Offer 5");
    await expect(list).not.toContainText("Offer 0");
    await list
      .getByRole("button", { name: text.playlists.dismissRecommendation("Offer 1") })
      .click();
    await expect(list).toContainText("Offer 6");
    await expect(list).not.toContainText("Offer 1");

    await section.getByRole("button", { name: text.playlists.refreshRecommendations }).click();
    await expect(list).toContainText("Offer 7");
    await expect(list).not.toContainText("Offer 5");
    expect(await calls.jsonValue()).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^playlistSuggestions\.add \d+ offer000000$/),
        expect.stringMatching(/^playlistSuggestions\.dismiss \d+ offer000001$/),
        expect.stringMatching(/^playlistSuggestions\.refresh \d+$/),
        expect.stringMatching(/^playlistSuggestions\.retry \d+ false$/),
      ]),
    );

    // With YT Music off there's no section, and main is asked nothing for it.
    await page.evaluate(() =>
      (window as unknown as { wave: WaveBridge }).wave.settings.setYtMusic(false),
    );
    await page.reload();
    await page
      .locator(".sidebar-playlists")
      .getByRole("button", { name: "Long one", exact: true })
      .click();
    await expect(page.getByTestId("hero")).toContainText("Long one");
    await expect(page.getByTestId("playlist-suggestions")).toHaveCount(0);
    await expect(page.getByRole("button", { name: text.playlists.goToSuggestions })).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
