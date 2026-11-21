import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type Locator } from "@playwright/test";
import { Database } from "@wave/client";
import { createPlaylist } from "@wave/client/db/playlists";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { catalogueOf, describePlaylistAdd } from "@wave/core";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";

const text = catalogueOf("en", "desktop");
const labels = text.itemActions.labels;

test("collection menus open in the Library, Home, Search and the sidebar", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-collection-menus-"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      const tracks = ["Zulu", "Alpha"].map((title, index) => ({
        source: "library" as const,
        trackId: addTrack(db, {
          title,
          album: "Moon Album",
          artist: "Moon Artist",
          genre: "Moon Genre",
          trackNumber: index + 1,
        }),
      }));
      createPlaylist(db, "Moon Playlist", tracks, 1000);
      createPlaylist(db, "Destination", [], 2000);
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [join(import.meta.dirname, ".."), "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    const menu = page.getByRole("menu");
    const entry = (name: string) => menu.getByRole("menuitem", { name, exact: true });
    const open = async (item: Locator) => {
      await item.click({ button: "right" });
      await expect(entry(labels.playNext)).toBeVisible();
    };
    const close = async () => {
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
    };
    const kinds = [
      ["Albums", "Moon Album"],
      ["Artists", "Moon Artist"],
      ["Genres", "Moon Genre"],
      ["Playlists", "Moon Playlist"],
    ];
    for (const [list, title] of kinds) {
      await page.getByRole("button", { name: list, exact: true }).click();
      const row = page.getByRole("row", { name: new RegExp(title!) });
      await open(row);
      await expect(entry(text.itemActions.playLabels.play)).toBeVisible();
      await expect(entry(text.itemActions.playLabels.shuffle)).toBeVisible();
      await expect(entry(labels.select)).toBeVisible();
      await expect(entry(labels.fixSongs)).toBeVisible();
      await expect(entry(labels.magicQueue)).toHaveCount(list === "Genres" ? 0 : 1);
      await expect(entry(labels.goToArtist)).toHaveCount(list === "Albums" ? 1 : 0);
      await close();
      await page.keyboard.press("Shift+F10");
      await expect(entry(labels.playNext)).toBeVisible();
      await close();
      await page.keyboard.press("ContextMenu");
      await expect(entry(labels.addToQueue)).toBeVisible();
      await close();
    }

    await page.getByRole("button", { name: "Albums", exact: true }).click();
    await open(page.getByRole("row", { name: /Moon Album/ }));
    await entry(labels.select).click();
    const selection = page.getByRole("toolbar", { name: text.library.selectionActions });
    await expect(selection.getByText(text.library.selected(1))).toBeVisible();
    await expect(page.getByRole("row", { name: /Moon Album/ })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await selection.getByRole("button", { name: text.library.done }).click();

    await page.getByRole("button", { name: text.desktopLayout.home, exact: true }).click();
    await open(page.getByRole("button", { name: "Moon Album, Moon Artist", exact: true }));
    await close();

    await page.getByRole("searchbox").fill("Moon");
    await open(page.getByTestId("search-shelf-album").getByRole("listitem").first());
    await close();
    await open(page.getByTestId("search-top"));
    await close();

    const sidebar = page.locator(".sidebar-playlists");
    const playlist = sidebar.getByRole("button", { name: "Moon Playlist", exact: true });
    await playlist.focus();
    await playlist.press("Shift+F10");
    await expect(entry(labels.renamePlaylist)).toBeVisible();
    await expect(entry(labels.changeImage)).toBeVisible();
    await expect(entry(text.share.copyLink)).toBeVisible();
    await expect(entry(labels.deletePlaylist)).toBeVisible();
    await close();
    await expect(playlist).toBeFocused();
    await playlist.press("ContextMenu");
    await expect(entry(labels.playNext)).toBeVisible();
    await entry(labels.addToPlaylist).click();
    await entry("Destination").click();
    await expect(
      page.getByRole("status").filter({ hasText: describePlaylistAdd("Destination", 2, 0, "en") }),
    ).toBeVisible();
    await sidebar.getByRole("button", { name: "Destination", exact: true }).click();
    await expect(page.getByRole("row").filter({ hasText: /Zulu|Alpha/ })).toContainText([
      "Zulu",
      "Alpha",
    ]);
    await open(playlist);
    await page.screenshot({
      path: test.info().outputPath(`collection-menus-${process.platform}.png`),
    });
    await close();
    await page.getByRole("button", { name: text.desktopLayout.settings, exact: true }).click();
    await page.getByRole("button", { name: text.desktopLayout.accounts, exact: true }).click();
    await page.getByRole("checkbox", { name: text.settings.useYTMusic }).uncheck();
    await open(playlist);
    await expect(entry(labels.magicQueue)).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
