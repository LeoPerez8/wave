import { copyFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { Database } from "@wave/client";
import { recordPlay } from "@wave/client/db/playHistory";
import { deleteTracksById } from "@wave/client/db/tracks";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { ytTrackId, type PlayEvent } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";

const appFolder = join(import.meta.dirname, "..");
const shots = join(appFolder, "test-results");
const hour = 60 * 60 * 1000;
const day = 24 * hour;

test("Listening History lists every counted play, searches them all and opens a moment", async () => {
  test.setTimeout(180_000);
  const data = mkdtempSync(join(tmpdir(), "wave-history-"));
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
      const played = (trackId: string, startedAt: number, counted = true): PlayEvent => ({
        trackId,
        startedAt,
        counted,
        listenedMs: counted ? 60_000 : 1000,
        durationMs: 180_000,
        endReason: "skipped",
        source: "desktop",
        context: null,
      });
      const add = (title: string) => addTrack(db, { title, artist: `${title} Artist` });
      const rock = add("Rock Track");
      db.run(sql`UPDATE tracks SET path=${song} WHERE id=${rock}`);
      recordPlay(db, played(String(rock), now - 1000));
      recordPlay(db, played(ytTrackId("stream-song"), now - 2000), undefined, {
        videoId: "stream-song",
        title: "Streamed Track",
        artists: ["Streamed Artist"],
        album: "Streamed Album",
        albumId: null,
        explicit: false,
        artworkUrl: null,
        durationMs: 180_000,
      });
      const removed = add("Removed Track");
      recordPlay(db, played(String(removed), now - 3000));
      // A play that never counted stays out of the history.
      recordPlay(db, played(String(add("Skipped Track")), now - 4000, false));
      recordPlay(db, played(String(add("Jazz Track")), now - day));
      const pop = add("Pop Track");
      for (let n = 0; n < 3000; n++) recordPlay(db, played(String(pop), now - 2 * day - n * hour));
      recordPlay(db, played(String(add("Deep Cut")), now - 400 * day));
      deleteTracksById(db, [removed]);
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    await page
      .getByRole("complementary")
      .getByRole("button", { name: "Listening History", exact: true })
      .click();
    const grid = page.getByRole("grid", { name: "Listening History" });
    const row = (title: string) => grid.getByRole("row", { name: new RegExp(title) });
    const headers = grid.getByRole("rowheader");

    // Newest first under day headers, Library and streamed plays together.
    await expect(headers.nth(0)).toHaveText("Today");
    await expect(headers.nth(1)).toHaveText("Yesterday");
    const titles = await grid.locator("[data-play] .title-cell").allTextContents();
    expect(titles.slice(0, 5)).toEqual([
      "Rock Track",
      "Streamed Track",
      "Removed Track",
      "Jazz Track",
      "Pop Track",
    ]);
    await expect(row("Skipped Track")).toHaveCount(0);
    await expect(row("Rock Track")).toContainText("Rock Track Artist");
    await expect(row("Rock Track")).toHaveAttribute("aria-disabled", "false");
    // With YT Music off a streamed play is dimmed, as a song removed since is.
    await expect(row("Streamed Track")).toHaveAttribute("aria-disabled", "true");
    await expect(row("Removed Track")).toHaveAttribute("aria-disabled", "true");
    mkdirSync(shots, { recursive: true });
    await page.screenshot({ path: join(shots, `listening-history-${process.platform}.png`) });

    // Dimmed rows don't play.
    await row("Streamed Track").dblclick({ force: true });
    await row("Removed Track").dblclick({ force: true });
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toHaveCount(0);

    // Thousands of plays: only the rows in view are drawn, and scrolling reads more pages.
    const viewport = grid.locator(".table-viewport");
    const scrollHeight = () => viewport.evaluate((element) => element.scrollHeight);
    const first = await scrollHeight();
    for (let pages = 0; pages < 4; pages++) {
      const before = await scrollHeight();
      await viewport.evaluate((element) => element.scrollTo(0, element.scrollHeight));
      await expect.poll(scrollHeight).toBeGreaterThan(before);
    }
    expect(await scrollHeight()).toBeGreaterThan(first * 3);
    expect(await grid.locator("[data-play]").count()).toBeLessThan(60);
    await expect(row("Deep Cut")).toHaveCount(0);

    // Search finds a play older than the rows read so far.
    const find = page.getByRole("searchbox", { name: "Find in Listening History" });
    await find.fill("deep cut");
    await expect(row("Deep Cut")).toBeVisible();
    await expect(grid.locator("[data-play]")).toHaveCount(1);
    await find.fill("nothing like this");
    await expect(grid.getByText("No plays match")).toBeVisible();
    await find.fill("deep cut");

    // Go to This Moment opens the history around that play, its row tinted for 3 seconds.
    await row("Deep Cut").click({ button: "right" });
    await page.getByRole("menuitem", { name: "Go to this moment", exact: true }).click();
    await expect(row("Deep Cut")).toHaveClass(/history-moment/);
    await expect(row("Pop Track").first()).toBeVisible();
    await expect(find).toHaveCount(0);
    await page.screenshot({
      path: join(shots, `listening-history-moment-${process.platform}.png`),
    });
    await expect(row("Deep Cut")).not.toHaveClass(/history-moment/, { timeout: 6000 });
    // Back returns to the results with the same text.
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(find).toHaveValue("deep cut");
    await expect(grid.locator("[data-play]")).toHaveCount(1);

    // Clearing the field restores the full list, and a double click plays the song.
    await find.fill("");
    await expect.poll(scrollHeight).toBeGreaterThan(first);
    await viewport.evaluate((element) => element.scrollTo(0, 0));
    await row("Rock Track").dblclick();
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeEnabled();

    // Settings opens the page too.
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page
      .getByRole("navigation", { name: "Settings" })
      .getByRole("button", { name: "Listening History", exact: true })
      .click();
    await expect(headers.nth(0)).toHaveText("Today");
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
