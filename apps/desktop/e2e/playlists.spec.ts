import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { catalogueOf, scanPath } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { libraryLayer } from "../src/main/database.ts";

/**
 * Playlists over the built app: New Playlist from the sidebar, Rename, Add to Playlist, Remove
 * from Playlist and its Graveyard, an M3U import and Delete, each showing in the sidebar at once.
 */
const appFolder = join(import.meta.dirname, "..");
const text = catalogueOf("en", "desktop");
const TITLES = ["Alpha", "Bravo", "Charlie"];

test("playlists: create, rename, add, remove, Graveyard, import and delete", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-playlists-"));
  const paths = TITLES.map((title) => join(data, `${title}.mp3`));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      TITLES.forEach((title, n) => {
        const id = addTrack(db, { title, album: "Disc", artist: "Wave", trackNumber: n + 1 });
        db.run(sql`UPDATE tracks SET path=${scanPath(paths[n]!, process.platform)} WHERE id=${id}`);
      });
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  // Another player's export: a BOM, a comment, two songs Wave has and one it hasn't.
  const m3u = join(data, "Road Trip.m3u8");
  writeFileSync(
    m3u,
    `﻿#EXTM3U\r\n#EXTINF:1,Wave - Bravo\r\n${paths[1]}\r\n${join(data, "Gone.mp3")}\r\n${paths[2]}\r\n`,
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    const labels = text.itemActions.labels;
    const sidebar = page.locator(".sidebar-playlists");
    const inSidebar = (name: string) => sidebar.getByRole("button", { name, exact: true });
    const row = (title: string) => page.getByRole("row", { name: new RegExp(title) });

    // New Playlist suggests a name; Create opens the new playlist and lists it in the sidebar.
    await sidebar.getByRole("button", { name: text.desktopLayout.newPlaylist }).last().click();
    const naming = page.getByRole("dialog", { name: text.playlists.newPlaylistTitle });
    const name = naming.getByRole("textbox", { name: text.playlists.playlistName });
    await expect(name).toHaveValue(text.playlists.defaultName);
    await name.fill("Morning");
    await naming.getByRole("button", { name: text.playlists.create }).click();
    await expect(page.getByRole("heading", { name: "Morning" })).toBeVisible();
    await expect(inSidebar("Morning")).toBeVisible();

    // Rename from the sidebar's menu; a taken or empty name can't be saved.
    await inSidebar("Morning").click({ button: "right" });
    await page.getByRole("menuitem", { name: labels.renamePlaylist }).click();
    const renaming = page.getByRole("dialog", { name: text.playlists.renamePlaylist });
    await renaming.getByRole("textbox").fill(" ");
    await expect(renaming).toContainText(text.playlists.nameEmpty);
    await expect(renaming.getByRole("button", { name: text.playlists.rename })).toBeDisabled();
    await renaming.getByRole("textbox").fill("Evening");
    await renaming.getByRole("button", { name: text.playlists.rename }).click();
    await expect(inSidebar("Evening")).toBeVisible();
    await expect(inSidebar("Morning")).toHaveCount(0);

    // Change Image frames a photo; the page shows it, and Adjust Image is offered.
    const cover = join(
      appFolder,
      "../../packages/kotlin-shared/src/testFixtures/resources/fixtures/cover.png",
    );
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, cover);
    const actions = page.getByRole("button", { name: text.playlists.playlistActions });
    await actions.click();
    await page.getByRole("menuitem", { name: labels.changeImage }).click();
    const cropper = page.getByRole("dialog", { name: text.library.moveAndScale });
    await cropper.getByRole("button", { name: text.library.zoomIn }).click();
    await page.screenshot({
      path: test.info().outputPath(`playlist-image-${process.platform}.png`),
    });
    await cropper.getByRole("button", { name: text.library.done }).click();
    await expect(page.locator(".hero .artwork img")).toBeVisible();
    await actions.click();
    await expect(page.getByRole("menuitem", { name: labels.adjustImage })).toBeVisible();
    await page.keyboard.press("Escape");

    // Add to Playlist from the song menu.
    await page.getByRole("button", { name: "Songs", exact: true }).click();
    for (const title of ["Alpha", "Bravo"]) {
      await row(title).click({ button: "right" });
      await page.getByRole("menuitem", { name: labels.addToPlaylist }).click();
      await page.getByRole("menuitem", { name: "Evening" }).click();
      await expect(
        page.getByRole("status").filter({ hasText: text.playlists.added(1, "Evening") }),
      ).toBeVisible();
    }

    // Remove from Playlist takes Alpha out with an Undo; the Graveyard restores it.
    await inSidebar("Evening").click();
    await expect(row("Bravo")).toBeVisible();
    await row("Alpha").click({ button: "right" });
    await page.getByRole("menuitem", { name: labels.removeFromPlaylist }).click();
    await expect(
      page.getByRole("status").filter({ hasText: text.playlists.removed(1) }),
    ).toBeVisible();
    await expect(row("Alpha")).toHaveCount(0);
    await page.getByRole("button", { name: text.playlists.playlistActions }).click();
    await page.getByRole("menuitem", { name: text.playlists.graveyard }).click();
    await expect(page.getByRole("heading", { name: text.playlists.graveyard })).toBeVisible();
    const buried = page.getByRole("listitem").filter({ hasText: "Alpha" });
    await buried.getByRole("button", { name: text.playlists.restore }).click();
    await expect(buried).toHaveCount(0);
    await inSidebar("Evening").click();
    await expect(row("Alpha")).toBeVisible();

    // Import Playlists matches the file's songs and summarises what it left out.
    await app.evaluate(({ dialog }, path) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [path] });
    }, m3u);
    await page.getByRole("button", { name: text.desktopLayout.playlists, exact: true }).click();
    await page.getByRole("button", { name: text.playlists.importPlaylists }).click();
    await page.getByRole("menuitem", { name: text.imports.fromFiles }).click();
    const summary = page.getByRole("alertdialog", { name: text.imports.importedName("Road Trip") });
    await expect(summary).toContainText(text.imports.notInLibrary(1));
    await summary.getByRole("button", { name: text.imports.ok }).click();
    await inSidebar("Road Trip").click();
    await expect(row("Bravo")).toBeVisible();
    await expect(row("Charlie")).toBeVisible();
    await expect(row("Alpha")).toHaveCount(0);

    // Delete asks first, then the playlist leaves the sidebar.
    await inSidebar("Evening").click({ button: "right" });
    await page.getByRole("menuitem", { name: labels.deletePlaylist }).click();
    const question = page.getByRole("alertdialog");
    await expect(question).toContainText(text.playlists.deleteOne("Evening"));
    await question.getByRole("button", { name: text.playlists.delete }).click();
    await expect(inSidebar("Evening")).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath(`playlists-${process.platform}.png`) });
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
