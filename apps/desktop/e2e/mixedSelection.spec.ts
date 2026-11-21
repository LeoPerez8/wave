import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { Database } from "@wave/client";
import { createPlaylist } from "@wave/client/db/playlists";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { actionBarLabel, catalogueOf, describePlaylistAdd } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";

const text = catalogueOf("en", "desktop");

test("albums, artists, genres and playlists check together and with Search's songs", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-mixed-selection-"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      for (const [index, title] of ["Moon Zulu", "Moon Alpha"].entries())
        addTrack(db, {
          title,
          album: "Moon Album",
          artist: "Moon Artist",
          genre: "Moon Genre",
          trackNumber: index + 1,
        });
      addTrack(db, { title: "Moon Loose", album: "Other Disc", artist: "Other", genre: "Pop" });
      const gone = addTrack(db, { title: "Gone", album: "Lost Album", artist: "Away" });
      db.run(sql`UPDATE tracks SET path = NULL WHERE id = ${gone}`);
      createPlaylist(db, "Destination", [], 1000);
      createPlaylist(db, "Second", [], 2000);
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [join(import.meta.dirname, ".."), "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    const bar = page.getByRole("toolbar", { name: text.library.selectionActions });
    const action = (name: Parameters<typeof actionBarLabel>[0]) =>
      bar.getByRole("button", { name: actionBarLabel(name), exact: true });
    const list = (name: string) => page.getByRole("button", { name, exact: true }).click();
    const row = (title: string) => page.getByRole("row", { name: new RegExp(title) });
    const ctrl = { modifiers: ["Control" as const] };

    // Albums: Ctrl+click checks rows; a checked album with a song that has no file offers Download.
    await list("Albums");
    await row("Moon Album").click(ctrl);
    await expect(bar).toBeHidden();
    await row("Other Disc").click(ctrl);
    await expect(bar.getByText(text.library.selected(2))).toBeVisible();
    await expect(row("Moon Album")).toHaveAttribute("aria-selected", "true");
    for (const name of ["playNext", "addToQueue", "addToPlaylist"] as const)
      await expect(action(name)).toBeVisible();
    await expect(action("download")).toHaveCount(0);
    await expect(action("favorite")).toHaveCount(0);
    await row("Lost Album").click(ctrl);
    await expect(bar.getByText(text.library.selected(3))).toBeVisible();
    await expect(action("download")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(bar).toBeHidden();
    // Shift+click checks the rows between the two clicks.
    await row("Lost Album").click();
    await row("Other Disc").click({ modifiers: ["Shift"] });
    await expect(bar.getByText(text.library.selected(3))).toBeVisible();
    await bar.getByRole("button", { name: text.library.done }).click();
    await expect(bar).toBeHidden();

    for (const [name, first, second] of [
      ["Artists", "Moon Artist", "Other"],
      ["Genres", "Moon Genre", "Pop"],
      ["Playlists", "Destination", "Second"],
    ] as const) {
      await list(name);
      await row(first).click(ctrl);
      await row(second).click(ctrl);
      await expect(bar.getByText(text.library.selected(2))).toBeVisible();
      await expect(action("addToPlaylist")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(bar).toBeHidden();
    }

    // Search: a song and an album checked together go to a playlist in one action.
    await page.getByRole("searchbox").fill("Moon");
    const song = page.getByTestId("search-song").filter({ hasText: "Moon Loose" });
    const album = page.getByTestId("search-shelf-album").getByRole("listitem").first();
    await song.click(ctrl);
    await album.click(ctrl);
    await expect(bar).toHaveCount(1);
    await expect(bar.getByText(text.library.selected(2))).toBeVisible();
    await expect(album.getByRole("checkbox")).toBeChecked();
    await expect(action("favorite")).toHaveCount(0);
    await expect(action("download")).toHaveCount(0);
    await page.screenshot({
      path: test.info().outputPath(`mixed-selection-${process.platform}.png`),
    });
    await action("addToPlaylist").click();
    await page
      .getByRole("menu")
      .getByRole("menuitem", { name: "Destination", exact: true })
      .click();
    await expect(
      page.getByRole("status").filter({ hasText: describePlaylistAdd("Destination", 3, 0, "en") }),
    ).toBeVisible();
    await expect(bar).toBeHidden();
    await page.locator(".sidebar-playlists").getByRole("button", { name: "Destination" }).click();
    await expect(page.getByRole("row").filter({ hasText: /Moon/ })).toContainText([
      "Moon Loose",
      "Moon Zulu",
      "Moon Alpha",
    ]);

    // Select from a tile's menu shows the checkboxes, and a click then checks a song too.
    await page.getByRole("searchbox").fill("Moon");
    await album.click({ button: "right" });
    await page
      .getByRole("menu")
      .getByRole("menuitem", { name: text.itemActions.labels.select, exact: true })
      .click();
    await expect(bar.getByText(text.library.selected(1))).toBeVisible();
    await song.click();
    await expect(bar.getByText(text.library.selected(2))).toBeVisible();
    await bar.getByRole("button", { name: text.library.done }).click();
    await expect(bar).toBeHidden();
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
