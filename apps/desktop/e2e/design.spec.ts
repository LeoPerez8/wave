import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  _electron as electron,
  expect,
  test,
  type ElectronApplication,
  type Page,
} from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, star, type TestDatabase } from "@wave/client/testing";
import { createPlaylist } from "@wave/client/db/playlists";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";

/**
 * Tables, titles and panels as docs/spec-desktop.md › Window and layout draws them (#1190).
 * `WAVE_SHOTS` names a folder for light and dark screenshots of each screen, taken before the
 * screen's checks so a run on older code still leaves its pictures.
 */
const appFolder = join(import.meta.dirname, "..");
const shots = process.env["WAVE_SHOTS"] ?? join(appFolder, "test-results", "design");
const cover = join(
  appFolder,
  "../../packages/kotlin-shared/src/testFixtures/resources/fixtures/cover.png",
);
const smallCover = "https://lh3.googleusercontent.com/cover=w120-h120-l90-rj";
let data: string;
let app: ElectronApplication;
let page: Page;

const shoot = async (name: string) => {
  for (const theme of ["light", "dark"] as const) {
    await page.emulateMedia({ colorScheme: theme });
    await page.screenshot({ path: join(shots, `${name}-${theme}.png`) });
  }
};

/** Main answers [call] with [answer] from now on, as if YouTube Music had. */
const answer = (call: string, value: unknown) =>
  app.evaluate(
    ({ ipcMain }, [call, value]) => {
      ipcMain.removeHandler(call as string);
      ipcMain.handle(call as string, () => value);
    },
    [call, value] as const,
  );

test.beforeAll(async () => {
  mkdirSync(shots, { recursive: true });
  data = mkdtempSync(join(tmpdir(), "wave-design-"));
  const hash = createHash("sha1").update(readFileSync(cover)).digest("hex");
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      const ids = ["Place to Be", "Road", "Which Will"].map((title, n) =>
        addTrack(db, {
          title,
          artist: "Nick Drake",
          album: "Pink Moon",
          genre: "Folk",
          trackNumber: n + 1,
          durationMs: 160000,
          artworkHash: hash,
        }),
      );
      // Road has no file on this computer: a missing song, dimmed, still numbered.
      db.run(sql`UPDATE tracks SET path = NULL WHERE id = ${ids[1]!}`);
      star(db, ids[0]!, 1000);
      addTrack(db, { title: "Moonlight", artist: "Joni Mitchell", album: "Blue Moon" });
      db.run(sql`UPDATE artwork SET path=${cover}, thumb_path=${cover} WHERE hash=${hash}`);
      createPlaylist(db, "Evening", [{ source: "library", trackId: ids[0]! }], 1000);
      db.run(sql`INSERT INTO desktop_settings(key,value) VALUES('settings.ytMusic','off')`);
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  page = await app.firstWindow();
  await page.bringToFront();
});

test.afterAll(async () => {
  await app?.close();
  rmSync(data, { recursive: true, force: true });
});

const go = (name: string) =>
  page.locator(".sidebar").getByRole("button", { name, exact: true }).click();
const headers = () =>
  page.getByRole("grid").first().getByRole("columnheader").evaluateAll((cells) =>
    cells.map((cell) => cell.textContent || cell.getAttribute("aria-label")),
  );

test("the album page numbers every song and has no Album column", async () => {
  await go("Albums");
  await page.getByRole("row", { name: /Pink Moon/ }).dblclick();
  await expect(page.getByTestId("hero")).toContainText("Pink Moon");
  await expect(page.getByRole("row", { name: /Road/ })).toBeVisible();
  await shoot("album");
  await expect(page.locator(".table-row .track-number")).toHaveText(["1", "2", "3"]);
  await expect(page.getByRole("row", { name: /Road/ })).toHaveClass(/missing-row/);
  expect(await headers()).toEqual(["Title", "Artist", "Favorite", "Time"]);
});

test("Artists, Genres and Playlists have no empty Artist or star header", async () => {
  for (const [name, expected] of [
    ["Artists", ["Title", "Songs", "Time"]],
    ["Genres", ["Title", "Songs", "Time"]],
    ["Playlists", ["Title", "Songs", "Time"]],
    ["Albums", ["Title", "Songs", "Artist", "Time"]],
  ] as const) {
    await go(name);
    await expect(page.getByRole("grid").getByRole("row").nth(1)).toBeVisible();
    await shoot(name.toLowerCase());
    expect(await headers()).toEqual(expected);
  }
});

test("list pages and heroes share one light title", async () => {
  await go("Songs");
  const songs = await page.locator(".content h1").evaluate((h1) => {
    const style = getComputedStyle(h1);
    return [style.fontSize, style.fontWeight];
  });
  await go("Albums");
  await page.getByRole("row", { name: /Pink Moon/ }).dblclick();
  const hero = await page.locator(".hero h1").evaluate((h1) => {
    const style = getComputedStyle(h1);
    return [style.fontSize, style.fontWeight];
  });
  expect(songs).toEqual(hero);
  expect(Number(songs[1])).toBeLessThan(400);
});

test("Home's headings are small catalog lines", async () => {
  await go("Home");
  const heading = page.getByTestId("home").locator("h2").first();
  await expect(heading).toBeVisible();
  await shoot("home");
  await expect(heading).toHaveCSS("font-size", "12px");
  await expect(heading).toHaveCSS("text-transform", "uppercase");
});

test("Search lines up with its title, its tiles are one size and the field clears on leaving", async () => {
  const field = page.getByRole("searchbox", { name: "Search" });
  await field.fill("Moon");
  await expect(page.getByTestId("search-shelf-album")).toBeVisible();
  await shoot("search");
  const title = await page.locator(".content h1").boundingBox();
  const heading = await page.locator(".search-section h2").first().boundingBox();
  expect(Math.abs(heading!.x - title!.x)).toBeLessThan(2);
  const tiles = page.getByTestId("search-shelf-album").locator(".search-tile .artwork");
  await expect(tiles).toHaveCount(2);
  await expect(tiles.locator("img")).toBeVisible();
  const [withArt, without] = await tiles.evaluateAll((all) =>
    all.map((tile) => [tile.clientWidth, tile.clientHeight]),
  );
  expect(withArt).toEqual(without);
  await go("Songs");
  await expect(field).toHaveValue("");
  await page.keyboard.press("Alt+ArrowLeft");
  await expect(field).toHaveValue("Moon");
});

test("the bar's star is the secondary colour, like the rows' stars", async () => {
  await go("Songs");
  const rowStar = await page
    .locator(".table-row .star-column")
    .first()
    .evaluate((cell) => getComputedStyle(cell).color);
  const barStar = page.locator(".player-bar").getByRole("button", { name: "Favorite" });
  await expect(barStar).toHaveCSS("color", rowStar);
});

test("a streamed song gets a full-size cover, and the Related panel fits its width", async () => {
  const song = {
    id: 0,
    videoId: "abcdefghijk",
    title: "Terminei Indo (feat. Somebody With A Long Name)",
    artist: "A Banda Mais Bonita da Cidade & Somebody Else",
    album: "Pink Moon",
    artworkHash: null,
    artworkUrl: smallCover,
    durationMs: 200000,
    count: 0,
    year: null,
    genre: null,
    trackNumber: null,
    favorite: false,
    path: null,
    unavailable: false,
  };
  const image = `data:image/png;base64,${readFileSync(cover).toString("base64")}`;
  await app.evaluate(
    ({ ipcMain }, image) => {
      const seen: string[] = [];
      (globalThis as { askedCovers?: string[] }).askedCovers = seen;
      ipcMain.removeHandler("yt.artwork");
      ipcMain.handle("yt.artwork", (_event, url: string) => {
        seen.push(url);
        return image;
      });
    },
    image,
  );
  await answer("settings.ytMusic", true);
  await answer("playback.view", {
    status: { state: "paused", positionMs: 0, durationMs: 200000 },
    current: song,
    index: 0,
    length: 1,
    shuffle: false,
    repeat: "off",
    undoOffer: null,
    volume: 1,
    muted: false,
    revision: 1,
    error: null,
    sleepTimer: null,
  });
  await answer("yt.related", {
    status: "ok",
    songs: {
      items: Array.from({ length: 8 }, (_, n) => ({
        ...song,
        videoId: `abcdefghij${n}`,
        title: `${song.title} ${n}`,
      })),
      offset: 0,
      total: 8,
    },
    artists: [{ browseId: "UCabc", name: "Scalene", artworkUrl: null }],
  });
  await page.reload();
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(960, 600));
  const bar = page.locator(".player-bar");
  await expect(bar).toContainText("Pink Moon");
  await bar.getByRole("button", { name: "Queue" }).click();
  await page.getByRole("tab", { name: "Related" }).click();
  const panel = page.locator(".related-panel");
  await expect(panel.getByRole("listitem").first()).toBeVisible();
  await shoot("related");
  await expect(panel.locator("h2", { hasText: /^Related$/ })).toHaveCount(0);
  expect(await panel.evaluate((el) => el.scrollWidth <= el.clientWidth)).toBe(true);
  const item = panel.locator(".yt-list-item").first();
  const add = await item.locator(".related-add").boundingBox();
  const text = await item.locator(".yt-row > span").evaluateAll((spans) =>
    spans.map((span) => span.getBoundingClientRect().right),
  );
  for (const right of text) expect(right).toBeLessThanOrEqual(add!.x + 1);
  await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0]!.setSize(1440, 900));
  await bar.locator(".player-now").click();
  await expect(page.locator(".now-playing .artwork img")).toBeVisible();
  await shoot("now-playing");
  const covers = await app.evaluate(() => (globalThis as { askedCovers?: string[] }).askedCovers);
  expect(covers).toContain("https://lh3.googleusercontent.com/cover=w1200-h1200-l90-rj");
});
