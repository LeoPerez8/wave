import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, star, type TestDatabase } from "@wave/client/testing";
import { recordPlay } from "@wave/client/db/playHistory";
import { parseHomeArrangement, storedHomeArrangement } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";

const appFolder = join(import.meta.dirname, "..");

test("Home shows the phone's local sections, follows the saved arrangement and opens its music", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-home-"));
  const cover = join(
    appFolder,
    "../../packages/kotlin-shared/src/testFixtures/resources/fixtures/cover.png",
  );
  const hash = createHash("sha1").update(readFileSync(cover)).digest("hex");
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      for (const [i, title, album, artist] of [
        [0, "Pink Moon", "Pink Moon", "Nick Drake"],
        [1, "Road", "Pink Moon", "Nick Drake"],
        [2, "Harvest", "Harvest", "Neil Young"],
        [3, "Blue", "Blue", "Joni Mitchell"],
      ] as const) {
        const id = addTrack(db, {
          title,
          album,
          artist,
          addedAt: i * 1000,
          durationMs: 180000,
          artworkHash: hash,
        });
        star(db, id, i * 1000);
        for (let n = 0; n <= i; n++)
          recordPlay(db, {
            trackId: String(id),
            startedAt: 10000 + i * 100 + n,
            counted: true,
            listenedMs: 180000,
            durationMs: 180000,
            endReason: "completed",
            source: "desktop",
            context: null,
          });
      }
      db.run(sql`UPDATE artwork SET path=${cover}, thumb_path=${cover} WHERE hash=${hash}`);
      db.run(sql`UPDATE artists SET artwork_hash=${hash}`);
      db.run(sql`INSERT INTO desktop_settings(key,value) VALUES('settings.ytMusic','off')`);
      const arrangement = parseHomeArrangement(null);
      const stored = storedHomeArrangement({
        ...arrangement,
        sections: ["favorites", ...arrangement.sections.filter((id) => id !== "favorites")],
      });
      db.run(
        sql`INSERT INTO desktop_synced_preferences(key,value) VALUES('settings.homeArrangement',${stored!})`,
      );
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    await page.bringToFront();
    const home = page.getByTestId("home");
    await expect(home.locator("h2")).toHaveText([
      "Favorites",
      "Recently added",
      "Recently played",
      "Most played",
      "Most played albums",
      "Most played artists",
      "Stats",
    ]);
    const table = home.getByRole("grid", { name: "Most played" });
    await expect(table.getByRole("row").nth(1)).toContainText("Blue");
    await expect(table.getByRole("row").nth(1)).toContainText("4 plays");
    await expect(table.getByRole("row").nth(1)).toHaveCSS("height", "40px");
    await table.focus();
    await page.keyboard.press("End");
    await expect(table).toHaveAttribute("aria-activedescendant", "home-most-played-3");
    await page.keyboard.press("Shift+F10");
    await page.getByRole("menuitem", { name: "Go to Album", exact: true }).click();
    await expect(page.getByTestId("hero")).toContainText("Pink Moon");
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(
      home.locator('[data-section="favorites"]').getByRole("button", { name: /Blue/ }),
    ).toBeVisible();
    await home.getByRole("grid", { name: "Most played" }).focus();
    await page.keyboard.press("End");
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.locator(".content").evaluate((el) => {
        el.scrollTop = 0;
      });
      await expect(home.locator("img").first()).toBeVisible();
      await page.screenshot({
        path: join(appFolder, "test-results", `home-${process.platform}-${theme}.png`),
      });
      await home.locator('[data-section="most-played"]').scrollIntoViewIfNeeded();
      await page.screenshot({
        path: join(appFolder, "test-results", `home-${process.platform}-${theme}-rankings.png`),
      });
    }
    await page.evaluate(async () => {
      const wave = (window as unknown as { wave: WaveBridge }).wave;
      const home = await wave.home.view();
      const song = home.items.find((section) => section.id === "most-played")!.rows.items[0]!;
      await wave.songs.run({ scope: { kind: "songs" }, ids: [song.id] }, "removeFromLibrary");
    });
    await expect(table.getByRole("row").nth(1)).toContainText("Harvest");
    await expect(table).toHaveAttribute("aria-rowcount", "4");
    await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(960, 600));
    await expect(page.locator(".sidebar")).toHaveCSS("width", "64px");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
      true,
    );
    await home
      .locator('[data-section="recently-added"]')
      .getByRole("button", { name: /Harvest/ })
      .click();
    await expect(page.getByTestId("hero")).toContainText("Harvest");
    await page.keyboard.press("Alt+ArrowLeft");
    await expect(page.getByTestId("home").locator("h2").first()).toHaveText("Favorites");
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});

test("the first scan reports progress on Home and leaves browsing available", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-home-scan-"));
  const music = join(data, "Music");
  mkdirSync(music);
  const fixture = join(
    appFolder,
    "../../packages/kotlin-shared/src/testFixtures/resources/fixtures/tagged.flac",
  );
  for (let i = 0; i < 120; i++) copyFileSync(fixture, join(music, `${i}.flac`));
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: music },
  });
  try {
    const page = await app.firstWindow();
    await page.bringToFront();
    await expect(page.getByRole("heading", { name: "Home", exact: true })).toBeVisible();
    await expect(page.getByTestId("scan-progress")).toBeVisible();
    await expect(page.getByRole("progressbar")).toHaveAccessibleName("Scanning…");
    await page.getByRole("button", { name: "Songs", exact: true }).click();
    await expect(page.getByRole("grid", { name: "Songs" })).toBeVisible();
    await expect
      .poll(
        () =>
          page.evaluate(() =>
            (window as unknown as { wave: WaveBridge }).wave.library.scanStatus(),
          ),
        { timeout: 15000 },
      )
      .toMatchObject({ status: "done", filesRead: 120 });
    await page.getByRole("button", { name: "Home", exact: true }).click();
    await expect(
      page.getByTestId("home").getByRole("heading", { name: "Recently added" }),
    ).toBeVisible();
    await expect(page.getByTestId("scan-progress")).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});

test("a Home read that fails offers Try Again and recovers", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-home-retry-"));
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    // The first load finishes before the reload, so it can't land after it and replace its page.
    await expect(page.getByTestId("home")).toBeVisible();
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("home.view");
      ipcMain.handle("home.view", () => {
        throw new Error("Fixture read failure");
      });
    });
    await page.reload();
    const home = page.getByTestId("home");
    await expect(home.getByRole("button", { name: "Try Again" })).toBeVisible();
    await app.evaluate(({ ipcMain }) => {
      ipcMain.removeHandler("home.view");
      ipcMain.handle("home.view", () => ({ items: [], total: 0, offset: 0, hint: "empty" }));
    });
    await home.getByRole("button", { name: "Try Again" }).click();
    await expect(home.getByRole("heading", { name: "Nothing here yet" })).toBeVisible();
    await expect(home.getByRole("button", { name: "Try Again" })).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
