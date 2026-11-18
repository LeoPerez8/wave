import { createHash } from "node:crypto";
import { readFileSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, star, type TestDatabase } from "@wave/client/testing";
import { createPlaylist } from "@wave/client/db/playlists";
import * as Effect from "effect/Effect";
import { sql } from "drizzle-orm";
import { libraryLayer } from "../src/main/database.ts";

const appFolder = join(import.meta.dirname, "..");
test("Library navigation, responsive tables and keyboard focus work with 50,000 songs", async () => {
  test.setTimeout(120000);
  const cover = join(
    appFolder,
    "../../packages/kotlin-shared/src/testFixtures/resources/fixtures/cover.png",
  );
  const hash = createHash("sha1").update(readFileSync(cover)).digest("hex");
  const data = mkdtempSync(join(tmpdir(), "wave-layout-"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      const first = addTrack(db, {
        title: "Pink Moon",
        album: "Pink Moon",
        artist: "Nick Drake",
        genre: "Folk",
        year: 1972,
        trackNumber: 1,
        durationMs: 124000,
        artworkHash: hash,
      });
      db.run(sql`UPDATE artwork SET path=${cover}, thumb_path=${cover} WHERE hash=${hash}`);
      db.run(sql`UPDATE artists SET artwork_hash=${hash}`);
      star(db, first, 1000);
      createPlaylist(db, "Evening", [{ source: "library", trackId: first }], 1000);
      // SQLite seeds the scale case in one transaction; startup must not scan these fixture paths.
      db.run(sql`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<49999)
      INSERT INTO tracks (path,folder_id,file_name,size_bytes,modified_at,title,title_sort,artist_id,artist_credit,album_id,duration_ms,added_at,scanned_at)
      SELECT '/Music/seed/'||x||'.flac', folder_id, x||'.flac',1,1,printf('Song %05d',x),printf('song %05d',x),artist_id,artist_credit,album_id,180000,1,1 FROM tracks,n WHERE tracks.id=${first}`);
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    await page.bringToFront();
    await page.getByRole("button", { name: "Songs", exact: true }).click();
    const table = page.getByRole("grid");
    await expect(table).toHaveAttribute("aria-rowcount", "50001");
    await expect(page.getByRole("row", { name: /Pink Moon/ }).first()).toBeVisible();
    expect(await table.getByRole("row").count()).toBeLessThan(45);
    await table.focus();
    await page.keyboard.press("End");
    await expect(table).toHaveAttribute("aria-activedescendant", "library-row-49999");
    await expect(page.locator("#library-row-49999")).toContainText("Song 49999");
    await page.keyboard.press("Home");
    await expect(page.locator("#library-row-0")).toContainText("Pink Moon");
    await page.keyboard.press("s");
    await expect(table).toHaveAttribute("aria-activedescendant", "library-row-1");
    await page.keyboard.press("PageDown");
    await page.keyboard.press("ArrowUp");
    expect(await table.getAttribute("aria-activedescendant")).not.toBe("library-row-1");
    const frames = await page.locator(".table-viewport").evaluate(async (element) => {
      const frames: number[] = [];
      let last = performance.now();
      for (let i = 0; i < 90; i++) {
        await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
        const now = performance.now();
        frames.push(now - last);
        last = now;
        element.scrollTop += 100;
      }
      return frames;
    });
    frames.sort((a, b) => a - b);
    test
      .info()
      .annotations.push({ type: "scroll-p95-ms", description: String(Math.round(frames[85]!)) });
    expect(frames[85]).toBeLessThan(100);
    expect(await table.getByRole("row").count()).toBeLessThan(45);
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      for (const name of ["Songs", "Albums", "Artists", "Playlists", "Genres", "Favorites"]) {
        await page.getByRole("button", { name, exact: true }).first().click();
        await expect(page.getByRole("grid").getByRole("row").nth(1)).toBeVisible();
        await page.screenshot({
          path: join(appFolder, "test-results", `layout-${process.platform}-${theme}-${name}.png`),
        });
        if (["Albums", "Artists", "Playlists"].includes(name)) {
          await page.getByRole("grid").focus();
          await page.keyboard.press("Enter");
          await expect(page.getByTestId("hero")).toBeVisible();
          await expect(page.getByTestId("hero").locator("img")).toBeVisible();
          await page.screenshot({
            path: join(
              appFolder,
              "test-results",
              `layout-${process.platform}-${theme}-${name}-hero.png`,
            ),
          });
          await page.keyboard.press("Alt+ArrowLeft");
        }
      }
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.setSize(960, 600),
      );
      await page.getByRole("button", { name: "Songs", exact: true }).click();
      await expect(page.locator(".sidebar")).toHaveCSS("width", "64px");
      await page.locator(".content").evaluate((element) => {
        element.style.width = "740px";
      });
      await expect(page.locator(".album-column").first()).toBeHidden();
      await page.locator(".content").evaluate((element) => {
        element.style.width = "";
      });
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(
        true,
      );
      await page.screenshot({
        path: join(appFolder, "test-results", `layout-${process.platform}-${theme}-960.png`),
      });
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0]!.setSize(1280, 800),
      );
    }
    await page.keyboard.press("Control+f");
    await expect(page.getByRole("searchbox")).toBeFocused();
    await page.getByRole("searchbox").pressSequentially("Pink Moon");
    await expect(page.getByRole("searchbox")).toBeFocused();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Search");
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Music folders" })).toBeVisible();
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({
        path: join(appFolder, "test-results", `layout-${process.platform}-${theme}-settings.png`),
      });
    }
    await page.getByRole("button", { name: "Appearance", exact: true }).click();
    await page.getByRole("combobox", { name: "Appearance" }).selectOption("light");
    await expect(page.locator(".desktop-shell")).toHaveAttribute("data-appearance", "light");
    await page.getByRole("combobox", { name: "Appearance" }).selectOption("dark");
    await expect(page.locator(".desktop-shell")).toHaveAttribute("data-appearance", "dark");
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});

test("every Library page is reachable using only the keyboard on an empty Library", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-keyboard-"));
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    await page.keyboard.press("Control+f");
    for (const name of [
      "Home",
      "Playlists",
      "Artists",
      "Albums",
      "Songs",
      "Genres",
      "Favorites",
      "Settings",
    ]) {
      for (
        let tabs = 0;
        tabs < 30 &&
        !(await page
          .getByRole("button", { name, exact: true })
          .evaluate((element) => element === document.activeElement));
        tabs++
      )
        await page.keyboard.press("Tab");
      await expect(page.getByRole("button", { name, exact: true })).toBeFocused();
      await page.keyboard.press("Enter");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(name);
      if (name !== "Settings") {
        await expect(page.getByRole("grid")).toBeFocused();
        await expect(page.getByRole("grid")).toContainText("No songs found.");
      }
    }
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
