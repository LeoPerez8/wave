import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { Database } from "@wave/client";
import { recordPlay } from "@wave/client/db/playHistory";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { catalogueOf } from "@wave/core";
import { creditSplits, relinkCredits } from "@wave/client/db/credits";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";

/**
 * A Library artist's page in the built app (#1183): the photo in its hero, the Albums and
 * Appears on shelves opening album pages, the album hero's artist link coming back, and with
 * YT Music on the Library | Online toggle. Online asks the live YouTube Music, so its answer
 * (songs and releases, or a quiet line) goes in the `artist-online` annotation instead of
 * failing, and CI stops before asking.
 */
const appFolder = join(import.meta.dirname, "..");
const text = catalogueOf("en", "desktop");

const seed = (data: string, ytMusic: "on" | "off", withHistory = false, moreSongs = false) => {
  const cover = join(
    appFolder,
    "../../packages/kotlin-shared/src/testFixtures/resources/fixtures/cover.png",
  );
  const hash = createHash("sha1").update(readFileSync(cover)).digest("hex");
  return Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      const tracks = [
        ["Pink Moon", "Pink Moon", "Nick Drake", "Nick Drake", 1972],
        ["Road", "Pink Moon", "Nick Drake", "Nick Drake", 1972],
        ["Hazey Jane II", "Bryter Layter", "Nick Drake", "Nick Drake", 1971],
        ["Time Has Told Me", "Folk Collection", "Nick Drake", "Various Artists", 1990],
        ...(withHistory
          ? ([
              ["Collaboration", "Positions", "Nick Drake, Vashti Bunyan", "Nick Drake", 1972],
              ["Quiet Song", "Quiet Album", "Quiet Artist", "Quiet Artist", 1975],
            ] as const)
          : []),
        ...(moreSongs
          ? ([
              ["Fly", "Bryter Layter", "Nick Drake", "Nick Drake", 1971],
              ["Northern Sky", "Bryter Layter", "Nick Drake", "Nick Drake", 1971],
              ["River Man", "Five Leaves Left", "Nick Drake", "Nick Drake", 1969],
            ] as const)
          : []),
      ] as const;
      const ids = new Map<string, number>();
      for (const [title, album, artist, albumArtist, year] of tracks) {
        const id = addTrack(db, {
          title,
          album,
          artist,
          albumArtist,
          year,
          durationMs: 180000,
          artworkHash: hash,
        });
        ids.set(title, id);
      }
      if (withHistory) relinkCredits(db, creditSplits());
      db.run(sql`UPDATE artwork SET path=${cover}, thumb_path=${cover} WHERE hash=${hash}`);
      db.run(sql`UPDATE artists SET artwork_hash=${hash}`);
      db.run(sql`INSERT INTO desktop_settings(key,value) VALUES('settings.ytMusic',${ytMusic})`);
      if (withHistory) {
        for (const title of ["Collaboration", "Road"]) {
          const song = join(data, `${title}.flac`);
          copyFileSync(
            join(
              appFolder,
              "../../packages/kotlin-shared/src/testFixtures/resources/fixtures/tagged.flac",
            ),
            song,
          );
          db.run(sql`UPDATE tracks SET path=${song} WHERE id=${ids.get(title)}`);
        }
        const now = Date.now();
        for (const [title, count] of [
          ["Collaboration", 2],
          ["Road", 1],
        ] as const)
          for (let index = 0; index < count; index++)
            recordPlay(db, {
              trackId: String(ids.get(title)),
              startedAt: now - (count - index),
              counted: true,
              listenedMs: 90_000,
              durationMs: 180_000,
              endReason: "completed",
              source: "desktop",
              context: null,
            });
      }
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
};

const launch = (data: string) =>
  electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });

test("an artist's page has their photo and album shelves, and an album's hero links back", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-artist-"));
  await seed(data, "off");
  const app = await launch(data);
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Artists", exact: true }).click();
    await page.getByRole("row", { name: /Nick Drake/ }).dblclick();
    const artist = page.getByTestId("artist-page");
    await expect(artist).toBeVisible();
    const hero = page.getByTestId("hero");
    await expect(hero.locator("h1")).toHaveText("Nick Drake");
    await expect(hero.locator("img")).toBeVisible();
    const albums = artist.getByRole("region", { name: text.library.albums, exact: true });
    await expect(albums.getByRole("button")).toHaveText([/Pink Moon/, /Bryter Layter/]);
    const appearsOn = artist.getByRole("region", { name: text.library.appearsOn, exact: true });
    await expect(appearsOn.getByRole("button")).toHaveText([/Folk Collection/]);
    await expect(artist.getByRole("listitem", { name: /Hazey Jane II/ })).toBeVisible();
    // YT Music is off: no toggle.
    await expect(hero.getByRole("button", { name: text.library.online, exact: true })).toHaveCount(
      0,
    );
    await page.screenshot({ path: "test-results/artist-page.png" });

    await albums.getByRole("button", { name: "Bryter Layter" }).click();
    await expect(hero.locator("h1")).toHaveText("Bryter Layter");
    await expect(page.getByRole("row", { name: /Hazey Jane II/ })).toBeVisible();
    const link = hero.getByRole("button", { name: "Nick Drake", exact: true });
    await expect(link).toBeVisible();
    await page.screenshot({ path: "test-results/artist-page-album-hero.png" });
    await link.click();
    await expect(hero.locator("h1")).toHaveText("Nick Drake");
    await expect(artist).toBeVisible();
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});

test("an artist's page shows shared listening stats, credits collaborations, and plays its ranked list", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-artist-stats-"));
  await seed(data, "off", true);
  const app = await launch(data);
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Artists", exact: true }).click();
    await page.getByRole("row", { name: /Nick Drake/ }).dblclick();
    const stats = page.getByTestId("artist-listening-stats");
    await expect(stats.getByText("3 plays", { exact: true })).toBeVisible();
    await expect(stats.getByText("4 minutes listened", { exact: true })).toBeVisible();
    await expect(stats.getByText("2 of 5 songs", { exact: true })).toBeVisible();
    await expect(stats.getByText(/^Last played/)).toBeVisible();
    const mostPlayed = stats.getByRole("row", { name: /Collaboration/ });
    await expect(mostPlayed).toBeVisible();
    await mostPlayed.click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Play Next", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(stats.getByRole("row")).toHaveText([
      /Plays$/,
      /Collaboration.*2 plays/,
      /Road.*1 play/,
    ]);
    await stats.getByRole("row", { name: /Road/ }).dblclick();
    await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Road", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Artists", exact: true }).click();
    await page.getByRole("row", { name: /Vashti Bunyan/ }).dblclick();
    const vashtiStats = page
      .getByTestId("artist-listening-stats")
      .locator(".artist-listening-facts");
    await expect(vashtiStats.getByText("2 plays", { exact: true })).toBeVisible();
    await expect(vashtiStats.getByText("1 of 1 song", { exact: true })).toBeVisible();

    await page.getByRole("button", { name: "Artists", exact: true }).click();
    await page.getByRole("row", { name: /Quiet Artist/ }).dblclick();
    await expect(page.getByTestId("artist-not-played")).toHaveText("Not played yet");
    await expect(page.getByTestId("artist-listening-stats")).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});

test("an artist's page shows their first five songs, and See more opens all of them", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-artist-songs-"));
  await seed(data, "off", false, true);
  const app = await launch(data);
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Artists", exact: true }).click();
    await page.getByRole("row", { name: /Nick Drake/ }).dblclick();
    const artist = page.getByTestId("artist-page");
    const all = text.library.countedHeading(text.library.songs, 7);
    await expect(artist.getByTestId("artist-songs-heading")).toHaveText(all);
    // No Popular list is saved: the first five by song name.
    await expect(artist.locator(".yt-list").getByRole("listitem")).toHaveCount(5);
    await expect(artist.getByRole("listitem", { name: /River Man/ })).toBeVisible();
    await expect(artist.getByRole("listitem", { name: /Time Has Told Me/ })).toHaveCount(0);
    await page.screenshot({ path: "test-results/artist-page-songs-cut.png" });

    await artist.getByRole("button", { name: text.library.seeMore, exact: true }).click();
    const songs = page.getByTestId("artist-songs");
    await expect(page.locator(".page-heading h1")).toHaveText("Nick Drake");
    await expect(page.getByTestId("artist-songs-count")).toHaveText(all);
    await expect(songs.getByRole("row", { name: /Time Has Told Me/ })).toBeVisible();
    await page.screenshot({ path: "test-results/artist-songs-view.png" });

    await page.getByRole("button", { name: text.desktopLayout.back, exact: true }).click();
    await expect(artist.getByTestId("artist-songs-heading")).toHaveText(all);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});

test("with YT Music on, an artist's page offers Online and shows what YouTube Music adds", async () => {
  test.setTimeout(180_000);
  const data = mkdtempSync(join(tmpdir(), "wave-artist-yt-"));
  await seed(data, "on");
  const app = await launch(data);
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Artists", exact: true }).click();
    await page.getByRole("row", { name: /Nick Drake/ }).dblclick();
    const artist = page.getByTestId("artist-page");
    const hero = page.getByTestId("hero");
    const library = hero.getByRole("button", { name: text.library.library, exact: true });
    const online = hero.getByRole("button", { name: text.library.online, exact: true });
    await expect(library).toHaveAttribute("aria-pressed", "true");
    await expect(online).toHaveAttribute("aria-pressed", "false");
    // Library: the artist's four Library songs, and nothing YouTube Music adds.
    const heading = artist.getByTestId("artist-songs-heading");
    const librarySongs = text.library.countedHeading(text.library.songs, 4);
    await expect(heading).toHaveText(librarySongs);
    await page.screenshot({ path: "test-results/artist-page-library.png" });
    if (process.env["CI"] !== undefined) return;

    await online.click();
    await expect(online).toHaveAttribute("aria-pressed", "true");
    const note = artist.getByTestId("artist-online-note");
    await expect(async () => {
      const quiet = (await note.count()) > 0 ? await note.innerText() : "";
      expect(
        (await heading.innerText()) !== librarySongs ||
          (quiet !== "" && quiet !== text.desktopLayout.loading),
      ).toBe(true);
    }).toPass({ timeout: 90_000 });
    test.info().annotations.push({
      type: "artist-online",
      description: (await note.count()) > 0 ? await note.innerText() : await heading.innerText(),
    });
    await page.screenshot({ path: "test-results/artist-page-online.png" });
    await library.click();
    await expect(heading).toHaveText(librarySongs);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
