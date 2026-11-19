import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { catalogueOf } from "@wave/core";
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

const seed = (data: string, ytMusic: "on" | "off") => {
  const cover = join(
    appFolder,
    "../../packages/kotlin-shared/src/testFixtures/resources/fixtures/cover.png",
  );
  const hash = createHash("sha1").update(readFileSync(cover)).digest("hex");
  return Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      for (const [title, album, artist, albumArtist, year] of [
        ["Pink Moon", "Pink Moon", "Nick Drake", "Nick Drake", 1972],
        ["Road", "Pink Moon", "Nick Drake", "Nick Drake", 1972],
        ["Hazey Jane II", "Bryter Layter", "Nick Drake", "Nick Drake", 1971],
        ["Time Has Told Me", "Folk Collection", "Nick Drake", "Various Artists", 1990],
      ] as const)
        addTrack(db, {
          title,
          album,
          artist,
          albumArtist,
          year,
          durationMs: 180000,
          artworkHash: hash,
        });
      db.run(sql`UPDATE artwork SET path=${cover}, thumb_path=${cover} WHERE hash=${hash}`);
      db.run(sql`UPDATE artists SET artwork_hash=${hash}`);
      db.run(sql`INSERT INTO desktop_settings(key,value) VALUES('settings.ytMusic',${ytMusic})`);
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
    await expect(artist.getByRole("row", { name: /Hazey Jane II/ })).toBeVisible();
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
    await expect(artist.locator(".yt-list")).toHaveCount(0);
    await page.screenshot({ path: "test-results/artist-page-library.png" });
    if (process.env["CI"] !== undefined) return;

    await online.click();
    await expect(online).toHaveAttribute("aria-pressed", "true");
    const songs = artist.locator(".yt-list");
    const note = artist.getByTestId("artist-online-note");
    await expect(async () => {
      const quiet = (await note.count()) > 0 ? await note.innerText() : "";
      expect(
        (await songs.count()) > 0 || (quiet !== "" && quiet !== text.desktopLayout.loading),
      ).toBe(true);
    }).toPass({ timeout: 90_000 });
    test.info().annotations.push({
      type: "artist-online",
      description:
        (await songs.count()) > 0
          ? `${await songs.getByRole("listitem").count()} songs`
          : await note.innerText(),
    });
    await page.screenshot({ path: "test-results/artist-page-online.png" });
    // The Library's own shelves and songs stay: in the table, or in the Popular list.
    await expect(artist.getByText("Hazey Jane II").locator("visible=true").first()).toBeVisible();
    await library.click();
    await expect(artist.locator(".yt-list")).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
