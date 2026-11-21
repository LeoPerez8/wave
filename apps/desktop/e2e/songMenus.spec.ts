import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { Database } from "@wave/client";
import { createPlaylist } from "@wave/client/db/playlists";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { actionBarLabel, catalogueOf } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";

/**
 * A song's menu from the mouse and the keyboard, selection with the phone's action bar, the
 * shortcut list, Esc and Ctrl+Q, over the built app.
 */
const appFolder = join(import.meta.dirname, "..");
const text = catalogueOf("en", "desktop");
const TITLES = ["Alpha", "Bravo", "Charlie"];

/** A one-second silent stereo WAV at [path]. */
const silence = (path: string) => {
  const rate = 44_100;
  const data = Buffer.alloc(rate * 4);
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + data.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(2, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 4, 28);
  header.writeUInt16LE(4, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(data.length, 40);
  writeFileSync(path, Buffer.concat([header, data]));
};

const wave = (page: Page) =>
  page.evaluate(async () => {
    const bridge = (window as unknown as { wave: WaveBridge }).wave;
    const songs = await bridge.library.browse({ kind: "songs" }, 0, 50);
    const view = await bridge.playback.view();
    return {
      songs: songs.items.map((song) => ({ title: song.title, favorite: song.favorite })),
      current: view.current?.title ?? null,
    };
  });

/** Moves the open menu's focus down to the entry named [label]. */
const focusEntry = async (page: Page, label: string) => {
  // The entries load first; until then the keys still go to the list.
  await expect(page.locator(":focus")).toHaveAttribute("role", "menuitem");
  for (let n = 0; n < 12; n++) {
    if ((await page.evaluate(() => document.activeElement?.textContent)) === label) return;
    await page.keyboard.press("ArrowDown");
  }
  throw new Error(`No menu entry ${label}`);
};

test("song menus, selection and the window's shortcuts", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-menus-"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      TITLES.forEach((title, n) => {
        const id = addTrack(db, { title, album: "Disc", artist: "Wave", trackNumber: n + 1 });
        const path = join(data, `${title}.wav`);
        silence(path);
        db.run(sql`UPDATE tracks SET path=${path} WHERE id=${id}`);
      });
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  let closed = false;
  try {
    const page = await app.firstWindow();
    const labels = text.itemActions.labels;
    const menu = (title: string) =>
      page.getByRole("menu", { name: text.desktopLibrary.songMenu(title) });
    const toast = (message: string) => page.getByRole("status").filter({ hasText: message });
    await page.getByRole("button", { name: "Songs", exact: true }).click();
    const row = (title: string) => page.getByRole("row", { name: new RegExp(title) });

    // Right-click opens the menu at the pointer; Add to Queue queues the song with a toast.
    await row("Alpha").click({ button: "right" });
    await expect(menu("Alpha")).toBeVisible();
    for (const action of ["playNext", "addToQueue", "addToPlaylist", "favorite", "select"] as const)
      await expect(menu("Alpha").getByRole("menuitem", { name: labels[action] })).toBeVisible();
    await expect(
      menu("Alpha").getByRole("menuitem", { name: labels.removeFromLibrary }),
    ).toBeVisible();
    await menu("Alpha").getByRole("menuitem", { name: labels.addToQueue }).click();
    await expect(menu("Alpha")).toBeHidden();
    await expect(toast(text.itemActions.addedToQueue)).toBeVisible();
    // An empty queue plays it; Continue Queue then goes on after it, as on the phone.
    await expect.poll(async () => (await wave(page)).current).toBe("Alpha");

    // Shift+F10 opens the focused row's menu; Enter on Favorite stars it.
    await row("Bravo").click();
    await page.keyboard.press("Shift+F10");
    await expect(menu("Bravo")).toBeVisible();
    await focusEntry(page, labels.favorite);
    await page.keyboard.press("Enter");
    await expect(toast(text.itemActions.addedToFavorites)).toBeVisible();
    await expect
      .poll(async () => (await wave(page)).songs.find((s) => s.title === "Bravo")?.favorite)
      .toBe(true);

    // The Menu key opens it too; Esc closes it and focus goes back to the list.
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ContextMenu");
    await expect(menu("Charlie")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(menu("Charlie")).toBeHidden();
    await expect(page.getByRole("grid")).toBeFocused();

    // Select turns selection on with that song checked; Select All checks every song.
    await page.keyboard.press("Shift+F10");
    await focusEntry(page, labels.select);
    await page.keyboard.press("Enter");
    const bar = page.getByRole("toolbar", { name: text.library.selectionActions });
    await expect(bar.getByText(text.library.selected(1))).toBeVisible();
    await expect(page.getByRole("checkbox", { name: "Select “Charlie”" })).toBeChecked();
    await bar.getByRole("button", { name: text.library.selectAll }).click();
    await expect(bar.getByText(text.library.selected(3))).toBeVisible();
    // Clicking a row unchecks it, as tapping does on the phone.
    await row("Alpha").click();
    await expect(bar.getByText(text.library.selected(2))).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(bar).toBeHidden();

    // Remove from Library asks first, then takes the song out and ends selection.
    await row("Charlie").click({ button: "right" });
    await menu("Charlie").getByRole("menuitem", { name: labels.select }).click();
    await bar.getByRole("button", { name: actionBarLabel("removeFromLibrary", "en") }).click();
    const question = page.getByRole("alertdialog");
    await expect(question).toContainText(text.songDeletion.removeSong("Charlie"));
    await question.getByRole("button", { name: text.songDeletion.remove }).click();
    await expect(row("Charlie")).toHaveCount(0);
    await expect(bar).toBeHidden();
    expect((await wave(page)).songs.map((s) => s.title)).toEqual(["Alpha", "Bravo"]);

    // Ctrl+/ lists every shortcut; Esc closes the list.
    await page.keyboard.press("Control+/");
    const sheet = page.getByRole("dialog", { name: text.desktopShortcuts.title });
    await expect(sheet).toBeVisible();
    await expect(sheet.locator(".shortcut-row")).toHaveCount(25);
    await expect(sheet).toContainText(text.desktopShortcuts.labels.quit);
    for (const shortcut of ["Ctrl+Click", "Shift+Click", "Shift+↑", "Shift+↓", "Ctrl+A"])
      await expect(sheet.getByText(shortcut, { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`song-menus-${process.platform}.png`) });
    // Tab reaches the list, whose keys scroll it rather than change the volume.
    const volume = await page.evaluate(
      async () => (await (window as unknown as { wave: WaveBridge }).wave.playback.view()).volume,
    );
    await page.keyboard.press("Tab");
    await expect(sheet.getByRole("term").first()).toBeVisible();
    await expect(page.locator(".shortcut-list")).toBeFocused();
    await page.keyboard.press("ArrowDown");
    expect(
      await page.evaluate(
        async () => (await (window as unknown as { wave: WaveBridge }).wave.playback.view()).volume,
      ),
    ).toBe(volume);
    await page.keyboard.press("Escape");
    await expect(sheet).toBeHidden();

    // Ctrl+Q quits, even from the search field. Main reads it before the page, so the key
    // goes in as the system's input rather than through the page.
    await page.getByRole("searchbox").focus();
    const close = app.waitForEvent("close");
    await app.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]!.webContents.sendInputEvent({
        type: "keyDown",
        keyCode: "Q",
        modifiers: ["control"],
      }),
    );
    await close;
    closed = true;
  } finally {
    if (!closed) await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});

test("table gestures select off-screen songs and right-click uses the clicked row's selection", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-table-selection-"));
  const title = (index: number) => `Selection ${String(index).padStart(5, "0")}`;
  const total = 10_250;
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      const first = addTrack(db, { title: title(0), album: "Selection", artist: "Wave" });
      db.run(sql`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<${total - 1})
        INSERT INTO tracks (path,folder_id,file_name,size_bytes,modified_at,title,title_sort,artist_id,artist_credit,album_id,duration_ms,added_at,scanned_at)
        SELECT '/Music/selection/'||x||'.flac',folder_id,x||'.flac',1,1,printf('Selection %05d',x),printf('selection %05d',x),artist_id,artist_credit,album_id,180000,1,1
        FROM tracks,n WHERE tracks.id=${first}`);
      createPlaylist(
        db,
        "Mixed selection",
        [
          { source: "library", trackId: first },
          {
            source: "stream",
            song: {
              videoId: "abcdefghijk",
              title: "Online selection",
              artists: ["Wave"],
              album: null,
              artworkUrl: null,
              durationMs: null,
              explicit: false,
            },
          },
        ],
        1000,
      );
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    const grid = page.getByRole("grid");
    const bar = page.getByRole("toolbar", { name: text.library.selectionActions });

    await page.getByRole("button", { name: "Favorites", exact: true }).click();
    await expect(grid).toHaveAttribute("aria-rowcount", "1");
    await grid.press("Shift+ArrowDown");
    await grid.press("Shift+ArrowUp");
    await expect(grid).toBeFocused();
    await expect(grid).not.toHaveAttribute("aria-activedescendant", /.+/);
    await expect(bar).toBeHidden();

    await page.getByRole("button", { name: "Songs", exact: true }).click();
    const row = (index: number) => grid.getByRole("row", { name: new RegExp(title(index)) });
    const count = (n: number) => bar.getByText(text.library.selected(n));
    const favorited = (index: number) =>
      expect.poll(
        async () => (await wave(page)).songs.find((song) => song.title === title(index))?.favorite,
      );

    await row(0).click();
    await row(2).click({ modifiers: ["Control"] });
    await expect(count(2)).toBeVisible();
    await expect(row(0)).toHaveAttribute("aria-selected", "true");
    await expect(row(1)).toHaveAttribute("aria-selected", "false");
    await row(2).click({ modifiers: ["Control"] });
    await expect(bar).toBeHidden();
    await expect(row(2)).toHaveAttribute("aria-selected", "false");
    await row(2).click({ modifiers: ["Control"] });
    await expect(count(2)).toBeVisible();

    await row(1).click({ button: "right" });
    await page
      .getByRole("menu", { name: text.desktopLibrary.songMenu(title(1)) })
      .getByRole("menuitem", { name: text.itemActions.labels.favorite })
      .click();
    await favorited(1).toBe(true);
    await favorited(0).toBe(false);
    await expect(count(2)).toBeVisible();
    await row(2).click({ button: "right" });
    await page
      .getByRole("menu", { name: text.desktopLibrary.songMenu(text.library.selected(2)) })
      .getByRole("menuitem", { name: text.itemActions.labels.favorite })
      .click();
    await favorited(0).toBe(true);
    await favorited(2).toBe(true);
    await expect(bar).toBeHidden();

    await row(0).click();
    await page.keyboard.press("End");
    // The middle pages have never been in the viewport or its overscan.
    await row(total - 1).click({ modifiers: ["Shift"] });
    await expect(count(total)).toBeVisible();
    await expect(
      bar.getByRole("button", { name: actionBarLabel("favorite", "en"), exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(bar).toBeHidden();
    await expect(row(total - 1)).toHaveAttribute("aria-selected", "false");

    await page.keyboard.press("Home");
    await page.keyboard.press("Shift+ArrowDown");
    await page.keyboard.press("Shift+ArrowDown");
    await expect(count(3)).toBeVisible();
    await page.keyboard.press("Shift+ArrowUp");
    await expect(count(2)).toBeVisible();
    await expect(row(2)).toHaveAttribute("aria-selected", "false");
    await page.keyboard.press("Control+a");
    await expect(count(total)).toBeVisible();
    await row(1).click({ modifiers: ["Control"] });
    await expect(count(total - 1)).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath(`table-selection-${process.platform}.png`),
    });
    await page.keyboard.press("Escape");
    await expect(bar).toBeHidden();

    const search = page.getByRole("searchbox");
    await search.fill(title(0));
    await search.press("Control+a");
    await expect(search).toBeFocused();
    await expect(bar).toBeHidden();
    await search.fill("Selection");
    const searchSongs = page.getByTestId("search-song");
    await searchSongs.first().click();
    await page.keyboard.press("Shift+ArrowDown");
    await expect(count(2)).toBeVisible();
    await expect(searchSongs.nth(1)).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(bar).toBeHidden();

    await page.getByRole("button", { name: "Mixed selection", exact: true }).click();
    const online = grid.getByRole("row", { name: /Online selection/ });
    await online.click({ button: "right" });
    await page.getByRole("menuitem", { name: text.itemActions.labels.select, exact: true }).click();
    await expect(count(1)).toBeVisible();
    await row(0).click({ modifiers: ["Control"] });
    await expect(count(2)).toBeVisible();
    await online.click({ button: "right" });
    await page.getByRole("menuitem", { name: text.itemActions.labels.removeFromPlaylist }).click();
    await expect(online).toHaveCount(0);
    await expect(row(0)).toHaveCount(0);
    await page.getByRole("button", { name: text.playlists.undo, exact: true }).click();
    await expect(online).toBeVisible();
    await expect(row(0)).toBeVisible();
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
