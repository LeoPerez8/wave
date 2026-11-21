import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { Database } from "@wave/client";
import { recordPlay } from "@wave/client/db/playHistory";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { catalogueOf, recapTitle, type RecapPeriod } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";

const appFolder = join(import.meta.dirname, "..");
const en = catalogueOf("en", "desktop");

/** The month [back] months before this one, and its first instant, local time. */
const monthBack = (back: number): { readonly period: RecapPeriod; readonly start: number } => {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth() - back, 1);
  return {
    period: { kind: "month", year: start.getFullYear(), month: start.getMonth() + 1 },
    start: start.getTime(),
  };
};

const withLibrary = <A>(file: string, run: (db: TestDatabase) => A): Promise<A> =>
  Effect.runPromise(
    Effect.gen(function* () {
      return run((yield* Database) as unknown as TestDatabase);
    }).pipe(Effect.provide(libraryLayer(file))),
  );

const playCount = (db: TestDatabase) =>
  db.get<{ n: number }>(sql`SELECT count(*) AS n FROM play_events`)!.n;

test("a Recap plays its stories over the window, with its music, and a story saves and copies as an image", async () => {
  test.setTimeout(120_000);
  const data = mkdtempSync(join(tmpdir(), "wave-recap-"));
  const song = join(data, "Pink Moon.flac");
  copyFileSync(
    join(appFolder, "../../packages/kotlin-shared/src/testFixtures/resources/fixtures/tagged.flac"),
    song,
  );
  const last = monthBack(1);
  const older = monthBack(3);
  const seeded = await withLibrary(join(data, "wave.db"), (db) => {
    db.run(sql`INSERT INTO desktop_settings(key,value) VALUES('settings.ytMusic','off')`);
    const add = (title: string, artist: string, month: number, count: number) => {
      const id = addTrack(db, { title, artist, album: `${title} Album`, genre: "Folk" });
      // Six minutes a play, a few a day, in the evening.
      for (let play = 0; play < count; play++)
        recordPlay(db, {
          trackId: String(id),
          startedAt: month + (play % 20) * 24 * 60 * 60_000 + 20 * 60 * 60_000 + play * 1000,
          counted: true,
          listenedMs: 6 * 60_000,
          durationMs: 6 * 60_000,
          endReason: "completed",
          source: "desktop",
          context: null,
        });
      return id;
    };
    // Last month: 3 h 30 min. Two months ago: 2 h 54 min, so no Recap. Three months ago: 4 h.
    const moon = add("Pink Moon", "Nick Drake", last.start, 25);
    db.run(sql`UPDATE tracks SET path=${song} WHERE id=${moon}`);
    add("Road", "Nick Drake", last.start, 10);
    add("Short Month", "Somebody", monthBack(2).start, 29);
    add("Older Song", "Vashti Bunyan", older.start, 40);
    return playCount(db);
  });

  const lastTitle = recapTitle(last.period, en);
  const saved = join(data, "saved.png");
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    const playing = () =>
      page.evaluate(async () => {
        const view = await (window as unknown as { wave: WaveBridge }).wave.playback.view();
        return {
          title: view.current?.title ?? null,
          state: view.status.state,
          length: view.length,
        };
      });
    expect((await playing()).length).toBe(0);

    // Home announces the newest Recap; the month with less than three hours has none.
    const card = page.getByRole("button", {
      name: new RegExp(`Your Recap is ready.*${lastTitle}`),
    });
    await expect(card).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`recap-${process.platform}-home.png`) });
    await card.click();

    const viewer = page.getByTestId("recap-viewer");
    await expect(viewer).toBeVisible();
    await expect(viewer).toHaveAttribute("data-story", "minutes");
    await expect(viewer).toContainText(`In ${lastTitle} you listened for`);
    await expect(viewer).toContainText("210");
    // It fills the window.
    expect(
      await viewer.evaluate((element) => {
        const box = element.getBoundingClientRect();
        // Whole pixels: a scaled display leaves fractions of one.
        return [box.left, box.top, box.width - innerWidth, box.height - innerHeight].every(
          (off) => Math.abs(off) < 1,
        );
      }),
    ).toBe(true);

    // With nothing playing, the Recap's #1 song plays.
    await expect.poll(playing).toMatchObject({ title: "Pink Moon", state: "playing" });

    // Right and Left move between the stories.
    await page.keyboard.press("ArrowRight");
    await expect(viewer).toHaveAttribute("data-story", "topSongs");
    await expect(viewer).toContainText("Your top songs");
    await expect(viewer).toContainText("25 plays");
    await page.keyboard.press("ArrowLeft");
    await expect(viewer).toHaveAttribute("data-story", "minutes");

    // A story stays six seconds, then the next one shows by itself.
    const shown = Date.now();
    await expect(viewer).toHaveAttribute("data-story", "topSongs", { timeout: 9_000 });
    expect(Date.now() - shown).toBeGreaterThan(4_500);
    await page.screenshot({ path: test.info().outputPath(`recap-${process.platform}-songs.png`) });

    // Save Image: the system's save dialog opens at the phone's file name, and the file is the
    // story at 1080 by 1920.
    await app.evaluate(({ dialog }, path) => {
      const asked: unknown[] = [];
      (globalThis as { recapSaveAsked?: unknown[] }).recapSaveAsked = asked;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        asked.push(args.at(-1));
        return { canceled: false, filePath: path };
      }) as typeof dialog.showSaveDialog;
    }, saved);
    await viewer.getByRole("button", { name: "Save Image", exact: true }).click();
    await expect(page.getByText("Image saved", { exact: true })).toBeVisible();
    const asked = await app.evaluate(
      () =>
        (globalThis as { recapSaveAsked?: { defaultPath: string }[] }).recapSaveAsked![0]!
          .defaultPath,
    );
    expect(basename(asked)).toMatch(
      new RegExp(`^Wave - Recap ${lastTitle} - \\d{8}-\\d{6}\\.png$`),
    );
    const png = readFileSync(saved);
    copyFileSync(saved, test.info().outputPath(`recap-${process.platform}-image.png`));
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1920]);
    // The image is the story, not a blank card: its text and cover leave many colours.
    const colours = await app.evaluate(({ nativeImage }, path) => {
      const bitmap = nativeImage.createFromPath(path).toBitmap();
      const seen = new Set<number>();
      for (let at = 0; at < bitmap.length; at += 4 * 97) seen.add(bitmap.readUInt32LE(at));
      return seen.size;
    }, saved);
    expect(colours).toBeGreaterThan(20);

    // Copy Image: the same picture, on the clipboard.
    await app.evaluate(({ clipboard }) => clipboard.clear());
    await viewer.getByRole("button", { name: "Copy Image", exact: true }).click();
    await expect(page.getByText("Image copied", { exact: true })).toBeVisible();
    const copied = await app.evaluate(async ({ clipboard, nativeImage }) => {
      const [item] = await clipboard.read();
      const blob = await item!.getType("image/png");
      return nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer())).getSize();
    });
    expect(copied).toEqual({ width: 1080, height: 1920 });

    // The summary, the last story, stays.
    for (let presses = 0; presses < 12; presses++) {
      if ((await viewer.getAttribute("data-story")) === "summary") break;
      await page.keyboard.press("ArrowRight");
    }
    await expect(viewer).toHaveAttribute("data-story", "summary");
    await expect(viewer).toContainText("Minutes listened");
    await page.waitForTimeout(7_000);
    await expect(viewer).toHaveAttribute("data-story", "summary");
    await page.screenshot({
      path: test.info().outputPath(`recap-${process.platform}-summary.png`),
    });

    // Esc closes it: the queue is as it was, and Home stops announcing the Recap.
    await page.evaluate(() => {
      const w = window as unknown as { wave: WaveBridge; trace: string[] };
      w.trace = [];
      const start = Date.now();
      let last = "";
      const tick = async () => {
        const v = await w.wave.playback.view();
        const bar = document.querySelector(".player-bar .player-title")?.textContent;
        const line = `${v.current?.title ?? null}|${v.length}|${v.status.state}|${v.status.positionMs}|bar=${bar}`;
        if (line !== last) w.trace.push(`${Date.now() - start} ${line}`);
        last = line;
        if (Date.now() - start < 8000) setTimeout(() => void tick(), 20);
      };
      void tick();
    });
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
    await expect.poll(playing).toMatchObject({ title: null, length: 0 });
    try {
      await expect(page.locator(".player-title")).toHaveText(en.desktopLayout.nothingPlaying);
    } catch (e) {
      await page.waitForTimeout(3000);
      console.log(
        "DIAG RECAP",
        JSON.stringify(await page.evaluate(() => (window as unknown as { trace: string[] }).trace)),
      );
      throw e;
    }
    await expect(card).toHaveCount(0);

    // Stats lists every Recap, newest first, and a tile opens its stories.
    await page
      .getByRole("region", { name: "Stats", exact: true })
      .getByRole("button", { name: "See all", exact: true })
      .click();
    const tiles = page.getByRole("region", { name: "Recaps", exact: true }).getByRole("button");
    await expect(tiles).toHaveText([
      new RegExp(lastTitle),
      new RegExp(recapTitle(older.period, en)),
    ]);
    await page.screenshot({ path: test.info().outputPath(`recap-${process.platform}-stats.png`) });
    await tiles.nth(1).click();
    await expect(viewer).toContainText(recapTitle(older.period, en));
    // Its song has no file on this computer, so it stays silent.
    await page.keyboard.press("Escape");
    await expect(viewer).toHaveCount(0);
  } finally {
    await app.close();
  }
  // Watching a Recap added nothing to the play history.
  expect(await withLibrary(join(data, "wave.db"), playCount)).toBe(seeded);
  rmSync(data, { recursive: true, force: true });
});
