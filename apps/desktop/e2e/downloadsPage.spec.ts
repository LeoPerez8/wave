import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test, type Page } from "@playwright/test";

import type { WaveBridge } from "../src/shared/bridge.ts";
import type { DownloadRow } from "../src/shared/downloads.ts";
import { Database } from "@wave/client";
import { createPlaylist } from "@wave/client/db/playlists";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";

/**
 * The Downloads page in the built app with the real JVM's journal, offline so nothing leaves the
 * queue: the summary line and the run panel, the groups, a queue of over a thousand songs in a
 * bounded list, a group and a song moved by drag and by Move Up, and the failed section once the
 * songs fail for want of a source (YT Music and Download in best quality are off, so nothing is
 * asked of any service).
 */
const appFolder = join(import.meta.dirname, "..");
const PLAYLIST_SONGS = 1_200;

type Wave = { wave: WaveBridge };
const bridge = <A>(page: Page, run: (wave: WaveBridge) => Promise<A>): Promise<A> =>
  page.evaluate(`(${run.toString()})(window.wave)`) as Promise<A>;
/** The page's first [limit] rows as main lists them: `# name` for a header, else the song's title. */
const listed = async (page: Page, limit: number) => {
  const rows = await page.evaluate(
    (count) => (window as unknown as Wave).wave.downloads.rows(0, count, true),
    limit,
  );
  return rows.items.map((row: DownloadRow) =>
    row.kind === "header" || row.kind === "startedHeader"
      ? `# ${row.name}`
      : "title" in row
        ? row.title
        : `## ${row.line}`,
  );
};
/** A song's title or a group's name. */
const named = (row: DownloadRow) => ("title" in row ? row.title : "name" in row ? row.name : "");
const shot = (page: Page, name: string) =>
  page.screenshot({ path: test.info().outputPath(`downloads-${name}-${process.platform}.png`) });

test("the Downloads page groups the queue, reorders it by drag and folds the failures", async () => {
  test.setTimeout(180_000);
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-downloads-page-"));
  const seeded = await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      const road: number[] = [];
      for (let n = 1; n <= PLAYLIST_SONGS; n++)
        road.push(addTrack(db, { title: `Road ${n}`, artist: "The Travellers", album: "Miles" }));
      for (const n of [1, 2, 3])
        addTrack(db, { title: `Pink ${n}`, artist: "Nick Drake", album: "Pink Moon" });
      const singles = ["Single One", "Single Two"].map((title) =>
        addTrack(db, { title, artist: "Vashti Bunyan", album: `${title} EP` }),
      );
      db.run(sql`UPDATE tracks SET path = NULL`);
      createPlaylist(
        db,
        "Road Trip",
        road.map((trackId) => ({ source: "library" as const, trackId })),
        1000,
      );
      db.run(sql`INSERT INTO desktop_settings (key, value) VALUES ('settings.ytMusic', 'off')`);
      return { singles };
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ net }) => {
      net.isOnline = () => false;
    });
    await expect
      .poll(
        async () =>
          (await page.evaluate(() => (window as unknown as Wave).wave.downloads.view())).online,
        { timeout: 15_000 },
      )
      .toBe(false);

    // A playlist's, an album's and two single songs' downloads, asked for in that order.
    const lists = await bridge(page, async (wave) => ({
      playlist: (await wave.library.browse({ kind: "playlists" }, 0, 10)).items.find(
        (row) => row.title === "Road Trip",
      )!.id,
      album: (await wave.library.browse({ kind: "albums" }, 0, 10)).items.find(
        (row) => row.title === "Pink Moon",
      )!.id,
    }));
    await page.evaluate(
      async ({ playlist, album, singles }) => {
        const { downloads } = (window as unknown as Wave).wave;
        await downloads.missingAction("downloadAll", { kind: "playlist", id: playlist });
        await downloads.missingAction("downloadAll", { kind: "album", id: album });
        await downloads.missing(singles);
      },
      { ...lists, singles: seeded.singles },
    );

    await page.getByTestId("downloads-nav").click();
    const run = page.getByTestId("downloads-run");
    await expect(page.getByTestId("downloads-summary")).toHaveText("1,205 waiting");
    await expect(run.getByRole("progressbar")).toHaveAccessibleName(
      "0 of 1,205 downloaded, 1,205 left · Paused",
    );
    await expect(page.getByTestId("downloads-offline")).toBeVisible();
    const groups = page.getByTestId("download-group");
    const rows = page.getByTestId("download-row");
    await expect(groups.first()).toContainText("Road Trip");
    await expect(groups.first()).toContainText("0 of 1,200 · 1,200 left");
    await expect(rows.first()).toContainText("Road 1");
    await shot(page, "groups");

    // Only the rows around the view are drawn, wherever the list is scrolled to.
    const scroll = page.locator(".downloads-scroll");
    const total = PLAYLIST_SONGS + 5 + 3;
    expect(await page.locator(".downloads-list").evaluate((list) => list.clientHeight)).toBe(
      total * 52,
    );
    expect(await rows.count()).toBeLessThan(60);
    const started = Date.now();
    for (const part of [0.25, 0.5, 0.75, 1]) {
      await scroll.evaluate((element, to) => {
        element.scrollTop = element.scrollHeight * to;
      }, part);
      await expect(rows.first()).toBeVisible();
      expect(await rows.count()).toBeLessThan(60);
    }
    test.info().annotations.push({ type: "scroll-ms", description: `${Date.now() - started}` });
    await expect(rows.filter({ hasText: "Single Two" })).toBeVisible();
    const group = (name: string) => groups.filter({ hasText: name });
    await expect(group("Pink Moon")).toContainText("0 of 3 · 3 left");
    await expect(group("Songs")).toContainText("0 of 2 · 2 left");
    await shot(page, "end");

    // Dragging a group's header onto another group moves the whole group ahead of it.
    const head = async () => (await listed(page, 4)).slice(0, 4);
    await group("Songs").dragTo(group("Pink Moon"));
    await expect
      .poll(async () => {
        const all = await page.evaluate(() =>
          (window as unknown as Wave).wave.downloads.rows(1_200, 10),
        );
        return all.items.map(named);
      })
      .toEqual([
        "Road 1200",
        "Songs",
        "Single One",
        "Single Two",
        "Pink Moon",
        "Pink 1",
        "Pink 2",
        "Pink 3",
      ]);
    // Move Up takes it past the playlist: its songs are now the first to download.
    await group("Songs").hover();
    await group("Songs").getByRole("button", { name: "Move up, Songs" }).click();
    await expect.poll(head).toEqual(["# Songs", "Single One", "Single Two", "# Road Trip"]);

    // A song drags within its group only: onto another group's song it stays where it was.
    await scroll.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    const song = (title: string) => rows.filter({ hasText: title });
    await song("Pink 3").dragTo(song("Pink 1"));
    const pink = async () => {
      const all = await page.evaluate(() =>
        (window as unknown as Wave).wave.downloads.rows(1_204, 10),
      );
      return all.items.map(named);
    };
    await expect.poll(pink).toEqual(["Pink Moon", "Pink 3", "Pink 1", "Pink 2"]);
    await scroll.evaluate((element) => {
      element.scrollTop = 0;
    });
    await song("Single Two").dragTo(song("Road 5"));
    expect(await head()).toEqual(["# Songs", "Single One", "Single Two", "# Road Trip"]);
    await song("Single Two").hover();
    await song("Single Two").getByRole("button", { name: "Move up, Single Two" }).click();
    await expect.poll(head).toEqual(["# Songs", "Single Two", "Single One", "# Road Trip"]);
    await shot(page, "moved");

    // Without the playlist, the five songs left fail once online: no source is turned on.
    await page.evaluate(
      (playlist) =>
        (window as unknown as Wave).wave.downloads.missingAction("cancel", {
          kind: "playlist",
          id: playlist,
        }),
      lists.playlist,
    );
    await app.evaluate(({ net }) => {
      net.isOnline = () => true;
    });
    const failedHeader = page.getByTestId("failed-header");
    await expect(failedHeader).toContainText("5 songs failed", { timeout: 60_000 });
    // Folded by default: the count and its buttons, no song.
    await expect(rows).toHaveCount(0);
    await expect(failedHeader.getByRole("button", { name: "Retry All" })).toBeVisible();
    await expect(failedHeader.getByRole("button", { name: "Clear All" })).toBeVisible();
    await shot(page, "failed-folded");
    await failedHeader.getByRole("button", { name: "Show failed songs" }).click();
    const reason = page.getByTestId("failed-reason");
    await expect(reason).toContainText(
      "Turn on YT Music or Download in best quality in Settings · 5",
    );
    await expect(rows).toHaveCount(5);
    await shot(page, "failed-shown");
    // Remove on a song takes it alone; Retry on the reason asks again for the rest, which fail again.
    await song("Pink 2").getByRole("button", { name: "Remove" }).click();
    await expect(reason).toContainText("· 4");
    await reason.getByRole("button", { name: "Retry" }).click();
    await expect(reason).toContainText("· 4", { timeout: 60_000 });
    await reason.getByRole("button", { name: "Remove" }).click();
    await expect(failedHeader).toHaveCount(0);
    await expect(page.getByTestId("downloads-page")).toContainText("Songs you download show here");
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
