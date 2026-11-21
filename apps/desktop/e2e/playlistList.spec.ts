import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type Locator, type Page } from "@playwright/test";
import { Database } from "@wave/client";
import { createPlaylist } from "@wave/client/db/playlists";
import type { TestDatabase } from "@wave/client/testing";
import { catalogueOf } from "@wave/core";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";

const text = catalogueOf("en", "desktop");
const DAY = 86_400_000;

const dragOnto = async (page: Page, from: Locator, to: Locator) => {
  await from.hover();
  await page.mouse.down();
  // A synthetic drag gets one event per move: the drag starts, enters [to], then goes over it.
  for (const x of [10, 14, 18]) await to.hover({ position: { x, y: 10 } });
  await expect(to).toHaveClass(/drop-over/);
  await page.mouse.up();
  await expect(to).not.toHaveClass(/drop-over/);
};

test("the Playlists page sorts, arranges and shows playlists as a table or a grid", async () => {
  test.setTimeout(120_000);
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-playlist-list-"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      // Made a day apart: Charlie is the newest.
      for (const [day, name] of ["Bravo", "Alpha", "Charlie"].entries())
        createPlaylist(db, name, [], (day + 1) * DAY);
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const launch = () =>
    electron.launch({
      args: [join(import.meta.dirname, ".."), "--lang=en-US"],
      env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
    });
  let app = await launch();
  try {
    let page = await app.firstWindow();
    const sidebar = () => page.locator(".sidebar-playlists .nav-item .truncate");
    const rows = () => page.locator(".table-row");
    const row = (name: string) => rows().filter({ hasText: name });
    const tiles = () => page.locator(".playlist-grid .tile");
    const tile = (name: string) => page.locator(".playlist-grid").getByRole("button", { name });
    const sortBy = () => page.getByRole("combobox", { name: text.playlists.sortBy });
    const showAs = (layout: "list" | "grid") =>
      page
        .getByRole("group", { name: text.playlists.showAs })
        .getByRole("button", { name: text.playlists.layouts[layout] });
    const menu = page.getByRole("menu");
    const entry = (name: string) => menu.getByRole("menuitem", { name, exact: true });

    await page.getByRole("button", { name: "Playlists", exact: true }).click();
    await expect(page.getByTestId("playlist-count")).toHaveText(text.playlists.playlistCount(3));
    await expect(rows()).toHaveText([/Alpha/, /Bravo/, /Charlie/]);
    await expect(sidebar()).toHaveText(["Alpha", "Bravo", "Charlie"]);
    await expect(sortBy()).toHaveValue("name");

    await sortBy().selectOption({ label: text.playlists.sorts.added });
    await expect(rows()).toHaveText([/Charlie/, /Alpha/, /Bravo/]);
    await expect(sidebar()).toHaveText(["Charlie", "Alpha", "Bravo"]);
    // Only Custom arranges by hand.
    await row("Bravo").click({ button: "right" });
    await expect(entry(text.itemActions.labels.addToQueue)).toBeVisible();
    await expect(entry(text.playlists.moveUp)).toHaveCount(0);
    await page.keyboard.press("Escape");

    // Custom starts from the order shown; the top has no Move up, the bottom no Move down.
    await sortBy().selectOption({ label: text.playlists.sorts.custom });
    await expect(rows()).toHaveText([/Charlie/, /Alpha/, /Bravo/]);
    await row("Charlie").click({ button: "right" });
    await expect(entry(text.playlists.moveDown)).toBeVisible();
    await expect(entry(text.playlists.moveUp)).toHaveCount(0);
    await page.keyboard.press("Escape");
    await row("Bravo").click({ button: "right" });
    await expect(entry(text.playlists.moveDown)).toHaveCount(0);
    await entry(text.playlists.moveUp).click();
    await expect(rows()).toHaveText([/Charlie/, /Bravo/, /Alpha/]);
    await expect(sidebar()).toHaveText(["Charlie", "Bravo", "Alpha"]);

    await dragOnto(page, row("Alpha"), row("Charlie"));
    await expect(rows()).toHaveText([/Alpha/, /Charlie/, /Bravo/]);
    await expect(sidebar()).toHaveText(["Alpha", "Charlie", "Bravo"]);

    await showAs("grid").click();
    await expect(showAs("grid")).toHaveAttribute("aria-pressed", "true");
    await expect(tiles()).toHaveText([/Alpha/, /Charlie/, /Bravo/]);
    await dragOnto(page, tile("Bravo"), tile("Alpha"));
    await expect(tiles()).toHaveText([/Bravo/, /Alpha/, /Charlie/]);
    // A cover's menu has the same Move Up and Move Down.
    await tile("Charlie").click({ button: "right" });
    await expect(entry(text.playlists.moveDown)).toHaveCount(0);
    await entry(text.playlists.moveUp).click();
    await expect(tiles()).toHaveText([/Bravo/, /Charlie/, /Alpha/]);
    await page.screenshot({
      path: test.info().outputPath(`playlist-list-${process.platform}.png`),
    });

    // Kept: the grid, Custom and its order come back after a restart.
    await app.close();
    app = await launch();
    page = await app.firstWindow();
    await expect(sidebar()).toHaveText(["Bravo", "Charlie", "Alpha"]);
    await page.getByRole("button", { name: "Playlists", exact: true }).click();
    await expect(showAs("grid")).toHaveAttribute("aria-pressed", "true");
    await expect(sortBy()).toHaveValue("custom");
    await expect(tiles()).toHaveText([/Bravo/, /Charlie/, /Alpha/]);
    await tile("Alpha").click();
    await expect(page.getByTestId("hero")).toContainText("Alpha");
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
