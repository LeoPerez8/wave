import { mkdirSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test, type Page } from "@playwright/test";

import type { WaveBridge } from "../src/shared/bridge.ts";
import type { DownloadsView } from "../src/shared/downloads.ts";
import type { SongTags } from "../src/shared/tags.ts";
import { Database } from "@wave/client";
import { createPlaylist } from "@wave/client/db/playlists";
import { addTrack, star, type TestDatabase } from "@wave/client/testing";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";

/**
 * Downloads in the built app with the JVM `pnpm build:jvm` built, against the live YouTube
 * Music: Settings › Downloads' folder, a Search result downloaded from its Download button, the
 * sidebar's percentage and the Downloads page, and the file in the Library with its tags.
 * YouTube may refuse a machine (#1144) or CI's addresses, so the test stops after the search
 * there and says so in its annotation.
 */
const appFolder = join(import.meta.dirname, "..");

type Wave = { wave: WaveBridge & { tags: { read: (path: string) => Promise<SongTags> } } };
const downloads = (page: Page) =>
  page.evaluate(() => (window as unknown as Wave).wave.downloads.view()) as Promise<DownloadsView>;
/** Main checks the connection every 3 s, once its services are up; a slow runner needs more. */
const ONLINE_WAIT = { timeout: 15_000 };

/** The audio files under [folder], at any depth. */
const audioFiles = (folder: string): string[] =>
  readdirSync(folder).flatMap((name) => {
    const path = join(folder, name);
    if (statSync(path).isDirectory()) return audioFiles(path);
    return /\.(m4a|mp3)$/i.test(name) ? [path] : [];
  });

test("a missing Search song waits offline and resumes its download instead of playing", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-missing-"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      const id = addTrack(db, { title: "Missing Road", artist: "Nick Drake", album: "Pink Moon" });
      db.run(sql`UPDATE tracks SET path = NULL WHERE id = ${id}`);
      // Avoid a live search; the journal should retain the failed job with no source available.
      db.run(sql`INSERT INTO desktop_settings (key, value) VALUES ('settings.ytMusic', 'off')`);
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ net }) => {
      net.isOnline = () => false;
    });
    await expect.poll(async () => (await downloads(page)).online, ONLINE_WAIT).toBe(false);
    await page.getByRole("searchbox", { name: "Search" }).fill("Missing Road");
    const row = page.getByTestId("search-song");
    // A missing song is dimmed, not marked as broken, and a double-click downloads it.
    await expect(row).toHaveClass(/missing-row/);
    await page.screenshot({
      path: test.info().outputPath(`missing-search-${process.platform}.png`),
    });
    await row.dblclick();
    await expect(page.getByText("Download started", { exact: true })).toBeVisible();
    await expect(row.getByRole("progressbar")).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath(`missing-started-${process.platform}.png`),
    });
    // The Songs table shows the same row on its way, and its menu offers Download.
    await page.getByRole("button", { name: "Songs", exact: true }).click();
    const songRow = page.getByRole("row", { name: /Missing Road/ });
    await expect(songRow).toHaveClass(/missing-row/);
    await expect(songRow).not.toHaveAttribute("aria-disabled", "true");
    await expect(songRow.getByRole("progressbar")).toBeVisible();
    await songRow.click({ button: "right" });
    await expect(page.getByRole("menuitem", { name: "Download", exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`missing-menu-${process.platform}.png`) });
    await page.keyboard.press("Escape");
    await expect.poll(async () => (await downloads(page)).rows).toBe(1);
    await expect(page.getByTestId("downloads-nav")).toBeVisible();
    const view = await page.evaluate(() => (window as unknown as Wave).wave.playback.view());
    expect(view.current).toBeNull();
    await page.getByTestId("downloads-nav").click();
    await expect(
      page.getByText("Downloads pause while you're offline and go on once you're back."),
    ).toBeVisible();
    expect((await downloads(page)).failed).toBe(0);
    await app.evaluate(({ net }) => {
      net.isOnline = () => true;
    });
    await expect.poll(async () => (await downloads(page)).online, ONLINE_WAIT).toBe(true);
    // With no source enabled, the resumed job fails and remains available to retry.
    await expect.poll(async () => (await downloads(page)).failed).toBe(1);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});

test("a missing song's tile on Home shows its state and its download, as its row does", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-tile-"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      const id = addTrack(db, { title: "Missing Road", artist: "Nick Drake", album: "Pink Moon" });
      db.run(sql`UPDATE tracks SET path = NULL WHERE id = ${id}`);
      star(db, id, 1000);
      db.run(sql`INSERT INTO desktop_settings (key, value) VALUES ('settings.ytMusic', 'off')`);
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ net }) => {
      net.isOnline = () => false;
    });
    await expect.poll(async () => (await downloads(page)).online, ONLINE_WAIT).toBe(false);
    const tile = page
      .getByTestId("home")
      .locator('[data-section="favorites"]')
      .getByRole("button", { name: /Missing Road/ });
    await expect(tile).toHaveClass(/missing-row/);
    await expect(tile.getByTestId("tile-mark")).toBeVisible();
    await expect(tile.getByRole("progressbar")).toHaveCount(0);
    // Its download, asked for from its menu, shows on the tile while it waits.
    await tile.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Download", exact: true }).click();
    await expect(tile.getByRole("progressbar")).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`missing-tile-${process.platform}.png`) });
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});

test("Play on a playlist of missing songs says so and offers to download them", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-list-"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      const ids = [
        addTrack(db, { title: "Missing Road", artist: "Nick Drake", album: "Pink Moon" }),
        addTrack(db, { title: "Missing Moon", artist: "Nick Drake", album: "Pink Moon" }),
      ];
      db.run(sql`UPDATE tracks SET path = NULL`);
      createPlaylist(
        db,
        "Evening",
        ids.map((trackId) => ({ source: "library" as const, trackId })),
        1000,
      );
      // Nothing streams and nothing is asked of YouTube.
      db.run(sql`INSERT INTO desktop_settings (key, value) VALUES ('settings.ytMusic', 'off')`);
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ net }) => {
      net.isOnline = () => false;
    });
    await page.getByRole("button", { name: "Evening", exact: true }).click();
    const hero = page.getByTestId("hero");
    await expect(hero.getByTestId("list-download")).toHaveText("Download Missing Songs");
    await expect(hero.getByText("2 songs aren't on this computer")).toBeVisible();
    await hero.getByRole("button", { name: "Play", exact: true }).click();
    const notice = page.getByRole("status").filter({ hasText: "None of these songs" });
    await expect(notice).toBeVisible();
    await page.screenshot({ path: test.info().outputPath(`list-nothing-${process.platform}.png`) });
    await notice.getByRole("button", { name: "Download Missing Songs" }).click();
    await expect(page.getByText("Downloading 2 songs", { exact: true })).toBeVisible();
    await expect.poll(async () => (await downloads(page)).rows).toBe(2);
    await page.screenshot({
      path: test.info().outputPath(`list-downloading-${process.platform}.png`),
    });
    const view = await page.evaluate(() => (window as unknown as Wave).wave.playback.view());
    expect(view.current).toBeNull();
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});

test("missing favorites queue at startup and when starred from Songs", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-favorites-downloads-"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      const existing = addTrack(db, { title: "Existing Star" });
      const newStar = addTrack(db, { title: "New Star" });
      db.run(sql`UPDATE tracks SET path = NULL WHERE id IN (${existing}, ${newStar})`);
      star(db, existing, 1000);
      db.run(sql`INSERT INTO desktop_settings (key, value) VALUES ('settings.ytMusic', 'off')`);
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    await app.evaluate(({ net }) => {
      net.isOnline = () => false;
    });
    await expect.poll(async () => (await downloads(page)).online, ONLINE_WAIT).toBe(false);
    const titles = () =>
      page.evaluate(async () =>
        (await (window as unknown as Wave).wave.downloads.rows(0, 10)).items.flatMap((row) =>
          "title" in row ? [row.title] : [],
        ),
      );
    await page.getByRole("button", { name: "Songs", exact: true }).click();
    const row = page.getByRole("row", { name: /New Star/ });
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Favorite", exact: true }).click();
    await page.getByRole("button", { name: "Favorites", exact: true }).click();
    await expect(page.getByRole("row", { name: /New Star/ })).toBeVisible();
    await expect.poll(titles).toEqual(["Existing Star", "New Star"]);
    await page.getByTestId("downloads-nav").click();
    await expect(page.getByText("New Star", { exact: true })).toBeVisible();
    await page.screenshot({ path: test.info().outputPath("starred-downloads.png") });

    await page.getByRole("button", { name: "Favorites", exact: true }).click();
    await row.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Remove from Favorites", exact: true }).click();
    await expect.poll(titles).toEqual(["Existing Star"]);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});

test("a YouTube Music song downloads into the Library with its tags", async () => {
  test.setTimeout(240_000);
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-downloads-"));
  const music = join(data, "Music");
  mkdirSync(music);
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: music },
  });
  try {
    const page = await app.firstWindow();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Downloads", exact: true }).last().click();
    // The Library keeps its folders as resolved paths with forward slashes.
    await expect(page.getByTestId("downloads-folder")).toHaveText(
      /wave-e2e-downloads-\w+[/\\]Music$/,
    );
    await expect(
      page.getByRole("checkbox", { name: "Download in best quality" }),
    ).not.toBeChecked();

    await page.getByRole("searchbox", { name: "Search" }).fill("nick drake pink moon");
    const results = page.getByTestId("yt-results");
    const quiet = page.getByTestId("yt-status");
    await expect(results.or(quiet)).toBeVisible({ timeout: 45_000 });
    if (await quiet.isVisible()) {
      test.info().annotations.push({ type: "downloads", description: await quiet.innerText() });
      return;
    }
    if (process.env["CI"] !== undefined) return;
    await results
      .getByRole("button", { name: /^Download, / })
      .first()
      .click();
    await expect.poll(async () => (await downloads(page)).run?.total, { timeout: 15_000 }).toBe(1);

    await page.getByTestId("downloads-nav").click();
    await expect(page.getByTestId("downloads-page")).toBeVisible();
    await page.screenshot({ path: "test-results/downloads-page.png" });
    // The run ends once its song is in the Library or has failed; a failure says why.
    await expect
      .poll(async () => (await downloads(page)).progress, { timeout: 180_000, intervals: [1_000] })
      .toBeNull();
    const rows = await page.evaluate(() => (window as unknown as Wave).wave.downloads.rows(0, 10));
    expect(rows.items.map((row) => row.kind)).toEqual([]);
    await expect(page.getByText("Songs you download show here")).toBeVisible();

    const [file] = audioFiles(music);
    expect(file).toBeDefined();
    const tags = await page.evaluate(
      (path) => (window as unknown as Wave).wave.tags.read(path),
      file!,
    );
    test.info().annotations.push({ type: "downloads", description: file! });
    expect(tags.title).toBeTruthy();
    expect(tags.artist).toBeTruthy();
    expect(tags.album).toBeTruthy();
    await expect
      .poll(() => page.evaluate(() => (window as unknown as Wave).wave.library.counts()), {
        timeout: 30_000,
      })
      .toMatchObject({ songs: 1 });
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
