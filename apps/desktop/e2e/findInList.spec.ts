import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { createPlaylist } from "@wave/client/db/playlists";
import { catalogueOf, scanPath } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";

const appFolder = join(import.meta.dirname, "..");
const shots = join(appFolder, "test-results");
const text = catalogueOf("en", "desktop");

/** A silent stereo WAV of [seconds] at [path]. */
const silence = (path: string, seconds: number) => {
  const rate = 44_100;
  const data = Buffer.alloc(rate * 4 * seconds);
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

/** The queue's titles in order. */
const queued = (page: Page) =>
  page.evaluate(async () => {
    const bridge = (window as unknown as { wave: WaveBridge }).wave;
    const rows = await bridge.playback.queue(0, 50);
    return rows.items.map((row) => row.title);
  });

test("a list page's Find narrows its rows, and Play and Select All act on the rows found", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-find-in-list-"));
  mkdirSync(join(data, "Music"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      const ids: number[] = [];
      for (const [title, artist] of [
        ["Diva", "Beyoncé"],
        ["Halo", "Beyoncé"],
        ["Hello", "Adele"],
      ] as const) {
        const file = join(data, "Music", `${title}.wav`);
        silence(file, 30);
        const id = addTrack(db, { title, artist, album: `${artist} Hits` });
        const stored = scanPath(realpathSync.native(file), process.platform);
        db.run(sql`UPDATE tracks SET path=${stored} WHERE id=${id}`);
        ids.push(id);
      }
      createPlaylist(
        db as never,
        "Mix",
        ids.map((trackId) => ({ source: "library" as const, trackId })),
        0,
      );
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    const open = (name: string) => page.getByRole("button", { name, exact: true }).click();
    const titles = () => page.locator("[role=row][id^=library-row] [role=gridcell]:first-child");
    const count = page.getByTestId("song-count");
    const find = page.getByRole("textbox", { name: text.library.find.songs });

    await open("Songs");
    await expect(count).toHaveText("3 songs");
    // Core's matching: case and accents don't count, and words match from their start.
    await find.fill("beyo");
    await expect(titles()).toHaveText(["Diva", "Halo"]);
    await expect(count).toHaveText("2 songs");
    await page.screenshot({ path: join(shots, `find-in-songs-${process.platform}.png`) });

    // Play queues the rows found, in the order shown.
    await page
      .locator(".page-heading")
      .getByRole("button", { name: text.desktopLayout.play, exact: true })
      .click();
    await expect.poll(() => queued(page)).toEqual(["Diva", "Halo"]);

    // Select All checks the rows found.
    await page.getByRole("grid").focus();
    await page.keyboard.press("Control+A");
    const bar = page.getByRole("toolbar", { name: text.library.selectionActions });
    await expect(bar.getByText(text.library.selected(2))).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(bar).toBeHidden();

    // A query that finds nothing says so.
    await find.fill("zzz");
    await expect(page.getByRole("status").filter({ hasText: "No songs match" })).toBeVisible();

    // Esc clears the field and gives the focus back to the list.
    await find.press("Escape");
    await expect(find).toHaveValue("");
    await expect(titles()).toHaveText(["Diva", "Halo", "Hello"]);
    await expect(page.getByRole("grid")).toBeFocused();

    // Ctrl+F stays the Library Search.
    await page.keyboard.press("Control+F");
    await expect(page.getByRole("searchbox", { name: text.desktopLayout.search })).toBeFocused();

    // The lists of lists find by name.
    await open("Artists");
    await page.getByRole("textbox", { name: text.library.find.artists }).fill("ade");
    await expect(titles()).toHaveText(["Adele"]);

    // A playlist's page finds in its songs, keeping each song's place in the playlist.
    await open("Mix");
    await page.getByRole("textbox", { name: text.library.find.playlist }).fill("hel");
    await expect(titles()).toHaveCount(1);
    await expect(page.getByRole("row", { name: /Hello/ })).toBeVisible();
    await page.screenshot({ path: join(shots, `find-in-playlist-${process.platform}.png`) });
    await page
      .getByTestId("hero")
      .getByRole("button", { name: text.desktopLayout.play, exact: true })
      .click();
    await expect.poll(() => queued(page)).toEqual(["Hello"]);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
