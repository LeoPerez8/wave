import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { Database } from "@wave/client";
import type { LibraryDatabase } from "@wave/client/db/database";
import { createPlaylist } from "@wave/client/db/playlists";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { catalogueOf } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";

/**
 * A song's Release Date (docs/spec.md, "Release date"): its dialog shows the date Wave has, takes
 * a year, a month and year or a full date and refuses anything else, and a playlist sorted by
 * release date places the song by the date typed, a streamed entry's too.
 */
const appFolder = join(import.meta.dirname, "..");
const text = catalogueOf("en", "desktop");

/** A one-second silent stereo WAV at [path]. */
const silence = (path: string) => {
  const rate = 8_000;
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

const setYtMusic = (page: Page, on: boolean) =>
  page.evaluate(
    (on) => (window as unknown as { wave: WaveBridge }).wave.settings.setYtMusic(on),
    on,
  );

test("Release Date keeps a typed date, which a playlist's release date sort uses", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-release-date-"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      const song = (title: string, artist: string, album: string, year: number) => {
        const id = addTrack(db, { title, artist, album, year });
        const path = join(data, `${title}.wav`);
        silence(path);
        db.run(sql`UPDATE tracks SET path=${path} WHERE id=${id}`);
        return { source: "library" as const, trackId: id };
      };
      createPlaylist(
        db as unknown as LibraryDatabase,
        "Evening",
        [
          song("Later", "Zed", "One", 2001),
          song("Road", "Nick Drake", "Pink Moon", 2010),
          {
            source: "stream",
            song: {
              videoId: "abcdefghijk",
              title: "Parasite",
              artists: ["Nick Drake"],
              album: "Pink Moon",
              durationMs: 124_000,
              artworkUrl: null,
              explicit: false,
            },
          },
        ],
        1,
      );
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    await setYtMusic(page, true);
    const title = (index: number) => page.locator(`#library-row-${index} .title-cell`);
    const titles = async () => [
      await title(0).innerText(),
      await title(1).innerText(),
      await title(2).innerText(),
    ];
    const dialog = page.getByRole("dialog", { name: text.playlists.releaseDateTitle });
    const field = (name: string) => dialog.getByLabel(name, { exact: true });
    const save = dialog.getByRole("button", { name: text.playlists.releaseDateSave });
    const problem = dialog.getByRole("status");
    const openReleaseDate = async (row: string) => {
      await page.getByRole("row", { name: new RegExp(row) }).click({ button: "right" });
      await page
        .getByRole("menuitem", { name: text.itemActions.labels.releaseDate, exact: true })
        .click();
      await expect(dialog).toBeVisible();
    };

    await page.getByRole("button", { name: "Evening", exact: true }).click();
    await page
      .getByRole("columnheader", { name: "Release date", exact: true })
      .getByRole("button")
      .click();
    // Oldest first, the song with no date last.
    await expect.poll(titles).toEqual(["Later", "Road", "Parasite"]);

    // The dialog shows the date the song has, and refuses what isn't a year, a month or a day.
    await openReleaseDate("Road");
    await expect(dialog).toContainText(text.desktopLibrary.releaseDateKnown("2010"));
    await expect(field(text.playlists.releaseDateYear)).toHaveValue("2010");
    await field(text.playlists.releaseDateYear).fill("72");
    await expect(problem).toHaveText(text.playlists.releaseDateImpossible);
    await expect(save).toBeDisabled();
    await field(text.playlists.releaseDateYear).fill("1972");
    await expect(problem).toHaveText(text.playlists.releaseDateHint);
    await field(text.playlists.releaseDateMonth).fill("13");
    await expect(problem).toHaveText(text.playlists.releaseDateImpossible);
    await field(text.playlists.releaseDateMonth).fill("2");
    await field(text.playlists.releaseDateDay).fill("30");
    await expect(problem).toHaveText(text.playlists.releaseDateImpossible);
    await field(text.playlists.releaseDateDay).fill("25");
    await expect(save).toBeEnabled();
    await page.screenshot({
      path: join(appFolder, "test-results", `release-date-${process.platform}.png`),
    });
    await save.click();
    await expect(dialog).toBeHidden();
    await expect.poll(titles).toEqual(["Road", "Later", "Parasite"]);
    await expect(page.locator("#library-row-0")).toContainText(
      text.playlists.releaseDate(1972, 2, 25),
    );

    // A streamed entry has none; a year alone is enough, and Enter saves it.
    await openReleaseDate("Parasite");
    await expect(dialog).toContainText(text.desktopLibrary.releaseDateUnknown);
    await expect(dialog.getByRole("button", { name: text.playlists.releaseDateClear })).toHaveCount(
      0,
    );
    await field(text.playlists.releaseDateYear).fill("1990");
    await page.keyboard.press("Enter");
    await expect(dialog).toBeHidden();
    await expect.poll(titles).toEqual(["Road", "Parasite", "Later"]);

    // Clear gives the song back the date its file has.
    await openReleaseDate("Road");
    await expect(dialog).toContainText(
      text.desktopLibrary.releaseDateKnown(text.playlists.releaseDate(1972, 2, 25)),
    );
    await dialog.getByRole("button", { name: text.playlists.releaseDateClear }).click();
    await expect(dialog).toBeHidden();
    await expect.poll(titles).toEqual(["Parasite", "Later", "Road"]);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
