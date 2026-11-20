import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, star, type TestDatabase } from "@wave/client/testing";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";

const appFolder = join(import.meta.dirname, "..");
const january = Date.UTC(2024, 0, 10, 12);
const february = Date.UTC(2024, 1, 10, 12);
const march = Date.UTC(2024, 2, 10, 12);
const april = Date.UTC(2024, 3, 10, 12);

test("Library headers sort and reverse paged rows, and each list remembers its order", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-table-sort-"));
  const launch = () =>
    electron.launch({
      args: [appFolder, "--lang=en-US"],
      env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
    });
  let app: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = (yield* Database) as unknown as TestDatabase;
        const dawn = addTrack(db, {
          title: "Dawn",
          artist: "The Zebras",
          album: "Overture",
          genre: "Ambient",
          addedAt: february,
        });
        const night = addTrack(db, {
          title: "Night",
          artist: "André",
          album: "Aubade",
          genre: "Jazz",
          addedAt: january,
        });
        star(db, dawn, march);
        star(db, night, april);
        db.run(sql`WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<203)
          INSERT INTO tracks (path,folder_id,file_name,size_bytes,modified_at,title,title_sort,artist_id,artist_credit,album_id,duration_ms,added_at,scanned_at)
          SELECT '/Music/sort/'||x||'.flac', folder_id, x||'.flac',1,1,printf('Song %03d',x),printf('song %03d',x),artist_id,artist_credit,album_id,180000,1,1 FROM tracks,n WHERE tracks.id=${dawn}`);
      }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
    );
    app = await launch();
    let page = await app.firstWindow();
    await page.bringToFront();
    const open = (name: string) => page.getByRole("button", { name, exact: true }).click();
    const first = () => page.locator("#library-row-0").getByRole("gridcell").first();
    const header = (name: string) => page.getByRole("columnheader", { name, exact: true });
    const sort = (name: string) => header(name).getByRole("button");

    await open("Songs");
    const grid = page.getByRole("grid");
    await expect(first()).toHaveText("Dawn");
    await expect(header("Title")).toHaveAttribute("aria-sort", "ascending");
    await page.keyboard.press("Tab");
    await expect(sort("Title")).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(first()).toHaveText("Song 203");
    await expect(header("Title")).toHaveAttribute("aria-sort", "descending");
    await expect(grid.locator("[aria-live=polite]")).toHaveText("Song name, Z to A");
    await page.getByRole("button", { name: "Jump to a letter D" }).click();
    await expect(grid).toHaveAttribute("aria-activedescendant", "library-row-204");
    await expect(page.locator("#library-row-204")).toContainText("Dawn");

    await sort("Artist").click();
    await expect(first()).toHaveText("Night");
    await expect(header("Artist")).toHaveAttribute("aria-sort", "ascending");
    await sort("Artist").press("Space");
    await expect(first()).toHaveText("Dawn");
    await expect(header("Artist")).toHaveAttribute("aria-sort", "descending");
    await sort("Album").click();
    await expect(first()).toHaveText("Night");
    await expect(header("Album")).toHaveAttribute("aria-sort", "ascending");
    await sort("Date added").click();
    await expect(first()).toHaveText("Dawn");
    await expect(header("Date added")).toHaveAttribute("aria-sort", "descending");
    await expect(page.locator(".letter-spine")).toHaveCount(0);
    await grid.focus();
    await page.keyboard.press("n");
    await expect(grid).toHaveAttribute("aria-activedescendant", "library-row-0");
    const bounded = await page.evaluate(async () => {
      const { library } = (globalThis as unknown as { wave: WaveBridge }).wave;
      const first = await library.browse({ kind: "songs" }, 0, 200);
      const next = await library.browse({ kind: "songs" }, 200, 200);
      const oversized = await library.browse({ kind: "songs" }, 0, 201).catch(() => "refused");
      const invalid = await library.sortBy("albums", "added").catch(() => "refused");
      return {
        total: first.total,
        sizes: [first.items.length, next.items.length],
        distinct: new Set([...first.items, ...next.items].map((row) => row.id)).size,
        oversized,
        invalid,
        jump: await library.letter({ kind: "songs" }, "N"),
      };
    });
    expect(bounded).toEqual({
      total: 205,
      sizes: [200, 5],
      distinct: 205,
      oversized: "refused",
      invalid: "refused",
      jump: null,
    });

    for (const [list, before, after] of [
      ["Albums", "Aubade", "Overture"],
      ["Artists", "André", "The Zebras"],
      ["Genres", "Ambient", "Jazz"],
    ]) {
      await open(list!);
      await expect(first()).toHaveText(before!);
      await expect(
        page.getByRole("grid").getByRole("button", { name: "Title", exact: true }),
      ).toBeVisible();
      await expect(header("Songs").getByRole("button")).toHaveCount(0);
      await sort("Title").click();
      await expect(first()).toHaveText(after!);
      await expect(header("Title")).toHaveAttribute("aria-sort", "descending");
    }

    await open("Favorites");
    await expect(first()).toHaveText("Night");
    await expect(header("Date starred")).toHaveAttribute("aria-sort", "descending");
    for (const name of ["Title", "Artist", "Album", "Date added", "Date starred"])
      await expect(sort(name)).toBeVisible();
    await sort("Date starred").click();
    await expect(first()).toHaveText("Dawn");
    await expect(header("Date starred")).toHaveAttribute("aria-sort", "ascending");
    await page.screenshot({
      path: join(appFolder, "test-results", `table-sort-${process.platform}.png`),
    });

    await app.close();
    app = undefined;
    app = await launch();
    page = await app.firstWindow();
    for (const [list, name, direction] of [
      ["Songs", "Date added", "descending"],
      ["Albums", "Title", "descending"],
      ["Artists", "Title", "descending"],
      ["Genres", "Title", "descending"],
      ["Favorites", "Date starred", "ascending"],
    ]) {
      await open(list!);
      await expect(header(name!)).toHaveAttribute("aria-sort", direction!);
    }
  } finally {
    await app?.close();
    rmSync(data, { recursive: true, force: true });
  }
});
