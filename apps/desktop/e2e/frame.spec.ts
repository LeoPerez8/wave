import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { Database } from "@wave/client";
import { createPlaylist } from "@wave/client/db/playlists";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { catalogueOf } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { libraryLayer } from "../src/main/database.ts";

/**
 * The window frame (docs/spec-desktop.md, Window and layout): Wave's own scrollbars, a sidebar
 * whose playlists use its room and whose entries each have their own icon, the 960×600 window
 * with nothing clipped, and a side panel that closes from inside on every tab.
 */
const appFolder = join(import.meta.dirname, "..");
const shots = process.env["WAVE_SHOTS_DIR"] ?? join(appFolder, "test-results");
const text = catalogueOf("en", "desktop");
const labels = text.desktopLayout;
const PLAYLISTS = ["Alternativo mix", "Criar", "Evening", "Road Trip", "Sunday"];

/** Every element that scrolls, with the thickness of its scrollbar and the style it asks for. */
const scrollers = (page: Page) =>
  page.evaluate(() =>
    [...document.querySelectorAll<HTMLElement>("*")]
      .filter((element) => {
        const style = getComputedStyle(element);
        return (
          /auto|scroll/.test(style.overflowY) && element.scrollHeight > element.clientHeight + 1
        );
      })
      .map((element) => {
        const style = getComputedStyle(element);
        const borders = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
        return {
          name: element.className || element.tagName,
          thickness: element.offsetWidth - element.clientWidth - borders,
          width: style.scrollbarWidth,
          colour: style.scrollbarColor,
        };
      }),
  );

const box = async (page: Page, selector: string) => {
  const found = await page.locator(selector).first().boundingBox();
  if (found === null) throw new Error(`${selector} has no box`);
  return found;
};
const overlaps = (
  a: { x: number; y: number; width: number; height: number },
  b: { x: number; y: number; width: number; height: number },
) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test("the frame: scrollbars, sidebar room and icons, the narrow window and the panel's close", async () => {
  test.setTimeout(120_000);
  mkdirSync(shots, { recursive: true });
  const data = mkdtempSync(join(tmpdir(), "wave-frame-"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      const first = addTrack(db, { title: "Pink Moon", album: "Pink Moon", artist: "Nick Drake" });
      PLAYLISTS.forEach((name, n) =>
        createPlaylist(db, name, [{ source: "library", trackId: first }], 1000 + n),
      );
      // Enough rows that the content and the side panel's Queue scroll.
      db.run(sql`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<299)
      INSERT INTO tracks (path,folder_id,file_name,size_bytes,modified_at,title,title_sort,artist_id,artist_credit,album_id,duration_ms,added_at,scanned_at)
      SELECT '/Music/seed/'||x||'.flac', folder_id, x||'.flac',1,1,printf('Song %03d',x),printf('song %03d',x),artist_id,artist_credit,album_id,180000,1,1 FROM tracks,n WHERE tracks.id=${first}`);
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  const resize = (width: number, height: number) =>
    app.evaluate(
      ({ BrowserWindow }, [w, h]) => BrowserWindow.getAllWindows()[0]!.setSize(w!, h!),
      [width, height],
    );
  try {
    const page = await app.firstWindow();
    await page.bringToFront();
    const sidebar = page.locator(".sidebar");
    const playlists = page.locator(".sidebar-playlists");

    // A tall window: all five playlists and New Playlist show, and nothing in the sidebar scrolls.
    await resize(1440, 1000);
    for (const name of PLAYLISTS) {
      await expect(playlists.getByRole("button", { name, exact: true })).toBeInViewport({
        ratio: 1,
      });
    }
    await expect(playlists.getByRole("button", { name: labels.newPlaylist })).toBeInViewport({
      ratio: 1,
    });
    console.log(
      "DIAG frame",
      process.platform,
      JSON.stringify(
        await sidebar.evaluate((e) => [e.scrollHeight, e.clientHeight, window.innerHeight]),
      ),
    );
    expect(await sidebar.evaluate((element) => element.scrollHeight - element.clientHeight)).toBe(
      0,
    );

    // Every page in the sidebar has its own icon, and playlists have theirs.
    await expect(sidebar.getByRole("button", { name: labels.discover, exact: true })).toBeVisible();
    const icons = await sidebar
      .locator("nav .nav-item, .settings-link")
      .evaluateAll((items) => items.map((item) => item.querySelector("path")?.getAttribute("d")));
    expect(new Set(icons).size).toBe(icons.length);
    const playlistIcon = await playlists
      .getByRole("button", { name: PLAYLISTS[0], exact: true })
      .locator("path")
      .getAttribute("d");
    expect(icons).not.toContain(playlistIcon);

    // Scrolling lists use Wave's thin scrollbar, without arrow buttons, in both themes.
    await page.getByRole("button", { name: labels.songs, exact: true }).click();
    await expect(page.getByRole("row", { name: /Song 001/ })).toBeVisible();
    await page.getByRole("button", { name: labels.queue, exact: true }).click();
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      const found = await scrollers(page);
      expect(found.length).toBeGreaterThan(0);
      for (const scroller of found) {
        expect(scroller, scroller.name).toMatchObject({
          thickness: 8,
          width: "auto",
          colour: "auto",
        });
      }
      await page.screenshot({ path: join(shots, `frame-${theme}-wide.png`) });
    }
    await page.getByRole("button", { name: labels.queue, exact: true }).click();

    // A short wide window: the sidebar scrolls as one, keeping the search field and Settings.
    await resize(1280, 640);
    const newPlaylist = playlists.getByRole("button", { name: labels.newPlaylist });
    await newPlaylist.scrollIntoViewIfNeeded();
    await expect(newPlaylist).toBeInViewport({ ratio: 1 });
    await expect(page.getByRole("searchbox")).toBeInViewport({ ratio: 1 });
    await expect(page.locator(".settings-link")).toBeInViewport({ ratio: 1 });
    await page.screenshot({ path: join(shots, "frame-dark-short.png") });

    // 960×600: the icon-only sidebar keeps every entry whole above the player bar.
    await resize(960, 600);
    await expect(sidebar).toHaveCSS("width", "64px");
    const bar = await box(page, ".player-bar");
    const settings = await box(page, ".settings-link");
    expect(settings.y + settings.height).toBeLessThanOrEqual(bar.y);
    await expect(page.locator(".settings-link")).toBeInViewport({ ratio: 1 });
    // Its scrollbar doesn't push the icons off centre (the sidebar's border takes half a pixel).
    expect(Math.abs(settings.x + settings.width / 2 - 32)).toBeLessThanOrEqual(1);
    // The playlists show as their own entries, not as a bare scrollbar.
    const firstPlaylist = playlists.getByRole("button", { name: PLAYLISTS[0], exact: true });
    await firstPlaylist.scrollIntoViewIfNeeded();
    await expect(firstPlaylist).toBeInViewport({ ratio: 1 });
    await expect(firstPlaylist.locator(".nav-monogram")).toHaveText("A");
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({ path: join(shots, `frame-${theme}-960.png`) });
    }

    // Ctrl+F's field covers no title and no sidebar entry.
    await page.getByRole("button", { name: labels.songs, exact: true }).click();
    const title = await box(page, ".content h1");
    await page.keyboard.press("Control+f");
    await expect(page.getByRole("searchbox")).toBeFocused();
    const field = await box(page, ".search-field");
    expect(overlaps(field, title)).toBe(false);
    expect(overlaps(field, await box(page, ".sidebar nav .nav-item"))).toBe(false);
    await page.screenshot({ path: join(shots, "frame-dark-960-search.png") });
    // Leaving the open field by a click on an entry opens that entry; the entries don't move.
    await page.keyboard.type("Song");
    await sidebar.getByRole("button", { name: labels.albums, exact: true }).click();
    await expect(page.locator(".content h1")).toHaveText(labels.albums);
    await expect(page.getByRole("searchbox")).toHaveValue("");

    // The side panel closes from inside on every tab, and focus goes back to the bar.
    await resize(1440, 1000);
    const panel = page.getByRole("complementary", { name: labels.sidePanel });
    for (const tab of [labels.lyrics, labels.queue, text.playbackText.related]) {
      const opener = page.getByRole("button", {
        name: tab === labels.lyrics ? labels.lyrics : labels.queue,
        exact: true,
      });
      await opener.click();
      const selected = panel.getByRole("tab", { name: tab, exact: true });
      await selected.click();
      await expect(selected).toHaveAttribute("aria-selected", "true");
      const close = panel.getByRole("button", { name: labels.closeSidePanel });
      await expect(close).toBeInViewport({ ratio: 1 });
      if (tab === text.playbackText.related) {
        await page.screenshot({ path: join(shots, "frame-dark-related.png") });
      }
      await close.press("Enter");
      await expect(panel).toBeHidden();
      await expect(opener).toBeFocused();
    }
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
