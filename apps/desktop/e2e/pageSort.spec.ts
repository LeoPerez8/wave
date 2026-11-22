import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { Database } from "@wave/client";
import type { LibraryDatabase } from "@wave/client/db/database";
import { createPlaylist } from "@wave/client/db/playlists";
import { saveYtArtist } from "@wave/client/db/ytArtists";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { catalogueOf, identityKey } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";

/**
 * A playlist's, an artist's and a genre's songs sort from their headers: a playlist keeps its
 * own sort and offers Move Up and Move Down only in Custom, an artist's page lists their first
 * songs by Popular while their Songs view sorts them all, and Play starts the queue in the order
 * shown.
 */
const appFolder = join(import.meta.dirname, "..");
const text = catalogueOf("en", "desktop");
const MS = 2_000;

/** A silent stereo WAV, [MS] long. */
const silence = (path: string) => {
  const rate = 8_000;
  const data = Buffer.alloc((rate * MS * 4) / 1000);
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

/** The titles still to play, the current one first. */
const queue = (page: Page) =>
  page.evaluate(async () => {
    const { playback } = (globalThis as unknown as { wave: WaveBridge }).wave;
    const rows = await playback.queue(0, 20);
    return rows.items.filter((row) => !row.history).map((row) => row.title);
  });

test("playlist, artist and genre pages sort their songs and play in the order shown", async () => {
  // Three pages, six Plays and a relaunch: more than the default minute on a busy machine.
  test.setTimeout(180_000);
  const data = mkdtempSync(join(tmpdir(), "wave-page-sort-"));
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
        // The queue ends at its last song: online, Continue with Magic Queue would add to it.
        db.run(
          sql`INSERT INTO desktop_synced_preferences (key, value) VALUES ('settings.continueQueue', 'off')`,
        );
        const song = (
          title: string,
          artist: string,
          album: string,
          added: number,
          year?: number,
          genre = "Jazz",
        ) => {
          const id = addTrack(db, {
            title,
            artist,
            album,
            genre,
            durationMs: MS,
            addedAt: Date.UTC(2024, added, 10, 12),
            ...(year === undefined ? {} : { year }),
          });
          const path = join(data, `${title}.wav`);
          silence(path);
          db.run(sql`UPDATE tracks SET path=${path} WHERE id=${id}`);
          return { source: "library" as const, trackId: id };
        };
        const entries = [
          song("Banana", "Zed", "One", 0, 2001),
          song("Cherry", "Amy", "Two", 1, 1990),
          song("Apple", "Zed", "Three", 2),
        ];
        // Zed's songs past the artist page's first five, in a genre of their own.
        for (const [index, title] of ["Fig", "Grape", "Kiwi", "Lemon"].entries())
          song(title, "Zed", "Four", 3 + index, undefined, "Folk");
        const library = db as unknown as LibraryDatabase;
        createPlaylist(library, "Fruit", entries, 1);
        createPlaylist(library, "Other", entries, 2);
        // Each entry joined its playlist after the one before it.
        db.run(sql`UPDATE playlist_items SET added_at = id`);
        // YouTube Music's list of Zed's songs, saved as the artist page saves it: Banana leads.
        saveYtArtist(library, identityKey("Zed"), {
          outcome: "found",
          checkedAt: Date.now(),
          browseId: "UCRr1xG_2WIDs18a6cIiCxeA",
          page: {
            name: "Zed",
            songs: [],
            songsPlaylistId: null,
            allSongs: [
              {
                videoId: "aaaaaaaaaaa",
                title: "Banana",
                artists: ["Zed"],
                album: "One",
                durationMs: MS,
                artworkUrl: null,
                explicit: false,
              },
            ],
            albums: [],
            singles: [],
            similar: [],
          },
        } as Parameters<typeof saveYtArtist>[2]);
      }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
    );
    app = await launch();
    let page = await app.firstWindow();
    await page.bringToFront();
    const open = (name: string) => page.getByRole("button", { name, exact: true }).click();
    const title = (index: number) => page.locator(`#library-row-${index} .title-cell`);
    const titles = async () => [
      await title(0).innerText(),
      await title(1).innerText(),
      await title(2).innerText(),
    ];
    // The song table's own headers: an artist's listening stats have a Title column too.
    const header = (name: string) =>
      page
        .getByRole("columnheader", { name, exact: true })
        .and(page.locator(':not([data-testid="artist-listening-stats"] *)'));
    const sort = (name: string) => header(name).getByRole("button");
    const play = () =>
      page.getByTestId("hero").getByRole("button", { name: "Play", exact: true }).click();
    // An artist's Songs view has its Play under its heading.
    const playSongs = () =>
      page.locator(".page-heading").getByRole("button", { name: "Play", exact: true }).click();
    const zedSongs = ["Fig", "Grape", "Kiwi", "Lemon"];
    const seeMore = () =>
      page
        .getByTestId("artist-page")
        .getByRole("button", { name: text.library.seeMore, exact: true })
        .click();
    const menuHas = async (row: number, name: string) => {
      await title(row).click({ button: "right" });
      await expect(page.getByRole("menu")).toBeVisible();
      const count = await page.getByRole("menuitem", { name, exact: true }).count();
      await page.keyboard.press("Escape");
      return count === 1;
    };

    // A playlist opens in its own order, where a song can be moved.
    await open("Fruit");
    await expect(title(0)).toHaveText("Banana");
    await expect(header("Custom")).toHaveAttribute("aria-sort", "ascending");
    expect(await menuHas(0, text.playlists.moveDown)).toBe(true);

    // Sorted by title: the rows keep their own places in the "#" column, and nothing moves.
    await sort("Title").click();
    await expect(title(0)).toHaveText("Apple");
    await expect.poll(titles).toEqual(["Apple", "Banana", "Cherry"]);
    await expect(header("Title")).toHaveAttribute("aria-sort", "ascending");
    await expect(header("Custom")).not.toHaveAttribute("aria-sort");
    await expect(page.locator("#library-row-0 .order-column")).toHaveText("3");
    await expect(page.getByRole("grid").locator("[aria-live=polite]")).toHaveText(
      "Song name, A to Z",
    );
    expect(await menuHas(0, text.playlists.moveUp)).toBe(false);
    expect(await menuHas(0, text.playlists.moveDown)).toBe(false);
    await play();
    await expect.poll(() => queue(page)).toEqual(["Apple", "Banana", "Cherry"]);

    await sort("Title").click();
    await expect(title(0)).toHaveText("Cherry");
    await expect(header("Title")).toHaveAttribute("aria-sort", "descending");
    await sort("Artist").click();
    await expect(title(0)).toHaveText("Cherry");
    await sort("Album").click();
    await expect(title(0)).toHaveText("Banana");
    await sort("Date added").click();
    await expect.poll(titles).toEqual(["Apple", "Cherry", "Banana"]);
    // Oldest first, and the song with no date last.
    await sort("Release date").click();
    await expect(title(0)).toHaveText("Cherry");
    await expect.poll(titles).toEqual(["Cherry", "Banana", "Apple"]);
    await expect(header("Release date")).toHaveAttribute("aria-sort", "ascending");
    await expect(page.locator("#library-row-0")).toContainText("1990");
    await page.screenshot({
      path: join(appFolder, "test-results", `page-sort-playlist-${process.platform}.png`),
    });

    // The other playlist never left its own order.
    await open("Other");
    await expect(title(0)).toHaveText("Banana");
    await expect(header("Custom")).toHaveAttribute("aria-sort", "ascending");
    expect(await menuHas(0, text.playlists.moveDown)).toBe(true);
    const refused = await page.evaluate(async () => {
      const { library } = (globalThis as unknown as { wave: WaveBridge }).wave;
      return [
        await library.sortBy("playlist", "popular", 1).catch(() => "refused"),
        await library.sortBy("playlist", "title").catch(() => "refused"),
        await library.sortBy("genre", "releaseDate").catch(() => "refused"),
      ];
    });
    expect(refused).toEqual(["refused", "refused", "refused"]);

    // An artist's page lists their first five songs by Popular, YouTube Music's order first, and
    // Play plays them all in that order.
    await open("Artists");
    await page.getByRole("row", { name: /Zed/ }).dblclick();
    const popular = page.getByRole("list", { name: "Popular" }).getByRole("listitem");
    await expect(popular).toHaveCount(5);
    await expect(popular.first()).toHaveText(/Banana/);
    await play();
    await expect.poll(async () => (await queue(page)).length).toBe(6);
    expect((await queue(page))[0]).toBe("Banana");
    await page.screenshot({
      path: join(appFolder, "test-results", `page-sort-artist-popular-${process.platform}.png`),
    });
    // Their Songs view opens by Popular too: with Online, one list in YouTube Music's order under
    // the table's header, which sorts it back into the Library's table.
    await seeMore();
    await expect(popular).toHaveCount(6);
    await expect(header("Popular")).toHaveAttribute("aria-sort", "ascending");
    await sort("Title").click();
    await expect(popular).toHaveCount(0);
    await expect(title(0)).toBeVisible();
    await expect(title(0)).toHaveText("Apple");
    await expect(header("Title")).toHaveAttribute("aria-sort", "ascending");
    await expect(page.locator("#library-row-1 .order-column")).toHaveText("1");
    await playSongs();
    await expect.poll(() => queue(page)).toEqual(["Apple", "Banana", ...zedSongs]);
    // With Library, Popular orders the Library's own songs by their ranks.
    await page.getByRole("button", { name: "Library", exact: true }).click();
    await sort("Popular").click();
    await expect(title(0)).toBeVisible();
    await expect(title(0)).toHaveText("Banana");
    await expect(page.locator("#library-row-0 .order-column")).toHaveText("1");
    await playSongs();
    await expect.poll(async () => (await queue(page))[0]).toBe("Banana");
    await sort("Title").click();
    await expect(title(0)).toHaveText("Apple");
    await page.screenshot({
      path: join(appFolder, "test-results", `page-sort-artist-${process.platform}.png`),
    });

    await open("Genres");
    await page.getByRole("row", { name: /Jazz/ }).dblclick();
    await expect(title(0)).toHaveText("Apple");
    await sort("Artist").click();
    await expect(title(0)).toHaveText("Cherry");
    await sort("Artist").click();
    await expect(title(1)).toHaveText("Apple");
    await expect.poll(titles).toEqual(["Banana", "Apple", "Cherry"]);
    await expect(header("Artist")).toHaveAttribute("aria-sort", "descending");
    await play();
    await expect.poll(() => queue(page)).toEqual(["Banana", "Apple", "Cherry"]);

    // Each choice is kept: the playlist's own, the artists' and the genres'.
    await app.close();
    app = undefined;
    app = await launch();
    page = await app.firstWindow();
    await open("Fruit");
    await expect(header("Release date")).toHaveAttribute("aria-sort", "ascending");
    await expect(title(0)).toHaveText("Cherry");
    await sort("Custom").click();
    await expect(title(0)).toHaveText("Banana");
    expect(await menuHas(0, text.playlists.moveDown)).toBe(true);
    await open("Other");
    await expect(header("Custom")).toHaveAttribute("aria-sort", "ascending");
    await open("Artists");
    await page.getByRole("row", { name: /Zed/ }).dblclick();
    await seeMore();
    await expect(header("Title")).toHaveAttribute("aria-sort", "ascending");
    await expect(title(0)).toHaveText("Apple");
    await open("Genres");
    await page.getByRole("row", { name: /Jazz/ }).dblclick();
    await expect(header("Artist")).toHaveAttribute("aria-sort", "descending");
  } finally {
    await app?.close();
    rmSync(data, { recursive: true, force: true });
  }
});
