import { copyFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { Database } from "@wave/client";
import { recordPlay } from "@wave/client/db/playHistory";
import { applyPulledPage } from "@wave/client/db/syncRows";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { EMPTY_SYNC_TABLES, ytTrackId } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";

const appFolder = join(import.meta.dirname, "..");
const day = 24 * 60 * 60 * 1000;

test("Home opens Stats and each period ranks the owner's plays", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-stats-"));
  const song = join(data, "Rock.flac");
  copyFileSync(
    join(appFolder, "../../packages/kotlin-shared/src/testFixtures/resources/fixtures/tagged.flac"),
    song,
  );
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      db.run(sql`INSERT INTO desktop_settings(key,value) VALUES('settings.ytMusic','off')`);
      const now = Date.now();
      const add = (title: string, genre: string, age: number, count: number) => {
        const id = addTrack(db, {
          title,
          artist: `${title} Artist`,
          album: `${title} Album`,
          genre,
        });
        for (let play = 0; play < count; play++)
          recordPlay(db, {
            trackId: String(id),
            startedAt: now - age * day - play,
            counted: true,
            listenedMs: 60_000,
            durationMs: 180_000,
            endReason: "skipped",
            source: "desktop",
            context: null,
          });
        return id;
      };
      const rock = add("Rock Track", "Rock", 14, 2);
      db.run(sql`UPDATE tracks SET path=${song} WHERE id=${rock}`);
      const jazz = add("Jazz Track", "Jazz", 60, 0);
      applyPulledPage(
        db,
        {
          ...EMPTY_SYNC_TABLES,
          plays: Array.from({ length: 3 }, (_, n) => ({
            id: `phone-jazz-${n}`,
            songId: "jazz-recording-key",
            startedAt: now - 60 * day - n,
            listenedMs: 60_000,
            durationMs: 180_000,
            endReason: "skipped",
            counted: true,
            contextType: null,
            contextId: null,
            source: "phone",
            importedFrom: null,
          })),
          cursor: "phone-plays",
          more: false,
        },
        new Map([["jazz-recording-key", jazz]]),
        now,
      );
      for (let n = 0; n < 101; n++) add(`Pop Track ${n}`, "Pop", 400, 1);
      const videoId = "stream-song";
      recordPlay(
        db,
        {
          trackId: ytTrackId(videoId),
          startedAt: now - 380 * day,
          counted: true,
          listenedMs: 60_000,
          durationMs: 180_000,
          endReason: "skipped",
          source: "desktop",
          context: null,
        },
        undefined,
        {
          videoId,
          title: "Streamed Track",
          artists: ["Streamed Artist"],
          album: "Streamed Album",
          albumId: null,
          explicit: false,
          artworkUrl: null,
          durationMs: 180_000,
        },
      );
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    const homeStats = page.getByRole("region", { name: "Stats", exact: true });
    await expect(homeStats.getByText("Time listened", { exact: true })).toBeVisible();
    await expect(homeStats.getByText("1 h", { exact: true })).toBeVisible();
    await expect(homeStats.getByText("107", { exact: true })).toBeVisible();
    await homeStats.getByRole("button", { name: "See all", exact: true }).click();
    const last30 = page.getByRole("tab", { name: "Last 30 days", exact: true });
    await expect(last30).toHaveAttribute("aria-selected", "true");
    const songs = page.getByRole("grid", { name: "Top songs" });
    const albums = page.getByRole("grid", { name: "Top albums" });
    const artists = page.getByRole("grid", { name: "Top artists" });
    await expect(songs.getByRole("row").nth(1)).toContainText("Rock Track");
    await expect(songs.getByRole("row").nth(1)).toContainText("2 plays");
    await expect(albums.getByRole("row").nth(1)).toContainText("Rock Track Album");
    await expect(artists.getByRole("row").nth(1)).toContainText("Rock Track Artist");
    await expect(page.getByRole("img", { name: /#1, Rock, 100%/ })).toBeVisible();
    await songs.getByRole("row").nth(1).click();
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeEnabled();
    await albums.getByRole("row").nth(1).click();
    await expect(page.getByTestId("hero")).toContainText("Rock Track Album");
    await page.keyboard.press("Alt+ArrowLeft");
    await artists.getByRole("row").nth(1).click();
    await expect(page.getByTestId("hero")).toContainText("Rock Track Artist");
    await page.keyboard.press("Alt+ArrowLeft");

    await page.getByRole("tab", { name: "Last 7 days", exact: true }).click();
    await expect(page.getByText("No plays in the last 7 days", { exact: true })).toBeVisible();
    await expect(songs).toHaveCount(0);
    await page.getByRole("tab", { name: "Last 12 months", exact: true }).click();
    await expect(songs.getByRole("row").nth(1)).toContainText("Jazz Track");
    await expect(albums.getByRole("row").nth(1)).toContainText("Jazz Track Album");
    await expect(artists.getByRole("row").nth(1)).toContainText("Jazz Track Artist");
    await expect(page.getByRole("img", { name: /#1, Jazz, 60%/ })).toBeVisible();
    await page.getByRole("tab", { name: "All time", exact: true }).click();
    await expect(songs).toHaveAttribute("aria-rowcount", "11");
    await expect(songs.getByRole("row", { name: /Streamed Track/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(albums.getByRole("row", { name: /Streamed Album/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    await expect(artists.getByRole("row", { name: /Streamed Artist/ })).toHaveAttribute(
      "aria-disabled",
      "true",
    );
    const podium = page.getByRole("img", { name: /#1, Pop/ });
    await expect(podium).toBeVisible();
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(960, 600));
    await expect(page.locator(".sidebar")).toHaveCSS("width", "64px");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await podium.screenshot({
        path: test.info().outputPath(`stats-${process.platform}-${theme}-genres.png`),
      });
      await page.getByRole("tablist").scrollIntoViewIfNeeded();
      await page.screenshot({
        path: test.info().outputPath(`stats-${process.platform}-${theme}.png`),
      });
    }
    for (const title of ["Top songs", "Top albums", "Top artists"]) {
      await page
        .getByRole("region", { name: title, exact: true })
        .getByRole("button", { name: "See all", exact: true })
        .click();
      const ranking = page.getByRole("grid", { name: title, exact: true });
      await expect(ranking).toHaveAttribute("aria-rowcount", "101");
      await ranking.focus();
      await page.keyboard.press("End");
      await expect(ranking.getByRole("row", { name: /Pop Track/ }).last()).toHaveAttribute(
        "aria-rowindex",
        "101",
      );
      await page.keyboard.press("Alt+ArrowLeft");
      await expect(page.getByRole("tab", { name: "All time", exact: true })).toHaveAttribute(
        "aria-selected",
        "true",
      );
    }

    await page.getByRole("button", { name: "Stats", exact: true }).click();
    await expect(last30).toHaveAttribute("aria-selected", "true");
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
