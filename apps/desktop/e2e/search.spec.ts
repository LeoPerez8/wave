import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { Database } from "@wave/client";
import { createPlaylist } from "@wave/client/db/playlists";
import { keepLyricsSearchText } from "@wave/client/db/lyricsSearchIndex";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { catalogueOf } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";

/**
 * Search over the built app: Ctrl+F, the top result, Songs, lyrics hits and shelves, playing a
 * result by double-click and Enter, and recent searches kept and cleared.
 */
const appFolder = join(import.meta.dirname, "..");
const text = catalogueOf("en", "desktop");
const SONGS = [
  { title: "Pink Moon", artist: "Nick Drake", album: "Pink Moon" },
  { title: "Road", artist: "Nick Drake", album: "Pink Moon" },
  { title: "Things Behind the Sun", artist: "Nick Drake", album: "Pink Moon" },
  { title: "Harvest", artist: "Neil Young", album: "Harvest" },
];

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

const playing = (page: Page) =>
  page.evaluate(async () => {
    const view = await (window as unknown as { wave: WaveBridge }).wave.playback.view();
    return { title: view.current?.title, length: view.length };
  });

test("Search finds, plays and remembers as on the phone", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-search-"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      for (const song of SONGS) {
        const id = addTrack(db, song);
        const path = join(data, `${song.title}.wav`);
        silence(path);
        db.run(sql`UPDATE tracks SET path=${path} WHERE id=${id}`);
        if (song.title === "Harvest")
          keepLyricsSearchText(db, id, "Did I see you down\nUnder a pink moon tonight");
      }
      createPlaylist(db, "Drake at night", [], 1);
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const launch = () =>
    electron.launch({
      args: [appFolder, "--lang=en-US"],
      env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
    });
  let app = await launch();
  try {
    const page = await app.firstWindow();
    const field = page.getByRole("searchbox", { name: text.desktopLayout.search });
    const results = page.getByTestId("search-page");

    // Ctrl+F focuses the field and opens Search; nothing searched yet.
    await page.getByRole("button", { name: text.desktopLayout.songs, exact: true }).click();
    await page.keyboard.press("Control+f");
    await expect(field).toBeFocused();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(text.desktopLayout.search);
    await expect(page.getByTestId("search-empty")).toContainText(
      text.playbackText.searchYourLibrary,
    );

    // The top result, Songs, the lyrics hit and the shelves, in Core's order.
    await field.fill("pink moon");
    await expect(page.getByTestId("search-top")).toHaveAccessibleName(
      `Pink Moon, ${text.desktopLayout.album}`,
    );
    await expect(page.getByTestId("search-song")).toHaveText([
      /^Pink Moon/,
      /^Road/,
      /^Things Behind the Sun/,
    ]);
    await expect(page.getByTestId("search-songs").getByRole("heading")).toHaveText(
      `${text.playbackText.songs} · 3`,
    );
    await expect(page.getByTestId("search-lyric")).toHaveText([/^Harvest.*pink moon tonight/]);
    await expect(page.getByTestId("search-lyric").locator("mark")).toHaveText(["pink", "moon"]);
    await expect(page.getByTestId("search-shelf-album")).toContainText("Pink Moon");
    await page.screenshot({ path: join(appFolder, "test-results", "search.png") });

    // Double-click plays a song alone; Enter on a lyrics hit plays it.
    await page.getByTestId("search-song").filter({ hasText: "Road" }).dblclick();
    await expect.poll(() => playing(page)).toEqual({ title: "Road", length: 1 });
    await page.getByTestId("search-lyric").focus();
    await page.keyboard.press("Enter");
    await expect.poll(() => playing(page)).toEqual({ title: "Harvest", length: 1 });

    // A playlist found by its name opens; nothing found says so.
    await field.fill("drake at");
    await page.getByTestId("search-top").click();
    await expect(page.getByRole("heading", { level: 1 })).toHaveText("Drake at night");
    await field.fill("zzzz");
    await expect(results).toContainText(text.playbackText.nothingInYourLibraryMatchesValue("zzzz"));

    // Searches played or opened are kept, newest first; picking one searches it; Clear empties.
    await field.fill("");
    const recent = page.getByTestId("recent-searches");
    await expect(recent.getByRole("listitem")).toHaveText(["drake at", "pink moon"]);
    await recent.getByRole("listitem").filter({ hasText: "pink moon" }).click();
    await expect(field).toHaveValue("pink moon");
    await expect(page.getByTestId("search-top")).toBeVisible();
    await field.fill("");
    await expect(recent.getByRole("listitem")).toHaveText(["pink moon", "drake at"]);

    // They're kept after a restart, until Clear.
    await app.close();
    app = await launch();
    const again = await app.firstWindow();
    await expect(again.getByRole("searchbox", { name: text.desktopLayout.search })).toBeVisible();
    await again.keyboard.press("Control+f");
    const kept = again.getByTestId("recent-searches");
    await expect(kept.getByRole("listitem")).toHaveText(["pink moon", "drake at"]);
    await kept.getByRole("button", { name: text.playbackText.clear }).click();
    await expect(again.getByTestId("search-empty")).toBeVisible();
  } finally {
    await app.close().catch(() => {});
    rmSync(data, { recursive: true, force: true });
  }
});
