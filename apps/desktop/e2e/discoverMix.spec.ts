import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { catalogueOf } from "@wave/core";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";
import type { BrowseRow } from "../src/shared/browse.ts";
import type { DiscoverMixesView } from "../src/shared/ytPages.ts";

/**
 * A Discover mix's page (#1192): a Home tile opens it and its glyph plays it, Discover's heading
 * opens it too, the page shows the cover, name and artists, Play, Shuffle and Download with the
 * head's progress, its Library song among the new ones with the Library's menu, a streamed one
 * with YT Music's, and a mix Home rebuilt away says it's gone. Main's `discover.mixes`,
 * `discover.playMix` and the list download are answered by handlers the test puts in main's
 * place; the placing itself (Core's `placeDiscoverMixSongs`) has unit tests in main.
 */
const appFolder = join(import.meta.dirname, "..");
const text = catalogueOf("en", "desktop");

const streamed = (n: number): BrowseRow => ({
  id: 0,
  videoId: `mixsong000${n}`,
  title: `New song ${n}`,
  artist: "Fixture Artist",
  album: "",
  artworkHash: null,
  durationMs: 180_000,
  count: 0,
  year: null,
  genre: null,
  trackNumber: null,
  favorite: false,
  path: null,
  unavailable: false,
});

test("a Discover mix opens its page from Home and Discover, plays, shuffles, downloads and says when it's gone", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-discover-mix-"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      addTrack(db, { title: "Pink Moon", artist: "Fixture Artist", durationMs: 120_000 });
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    await expect(page.getByTestId("home")).toBeVisible();
    // The Library's song as main's rows carry it: Discover's Magic Queue row reads it.
    const library = (
      await page.evaluate(() => (window as unknown as { wave: WaveBridge }).wave.discover.picks())
    ).items[0]!;
    expect(library.title).toBe("Pink Moon");
    // Placed as Core places it: the Library song among the new ones.
    const fixture: DiscoverMixesView = {
      status: "ok",
      mixes: [
        {
          id: "artist:fixture",
          name: "Fixture Artist",
          row: "artist-mixes",
          artists: "Fixture Artist, Other Artist",
          artworkUrl: null,
          songs: {
            items: [streamed(1), library, streamed(2), streamed(3)],
            offset: 0,
            total: 4,
          },
        },
      ],
    };
    await app.evaluate(({ ipcMain }, mixes) => {
      const seen = {
        mixes,
        played: [] as unknown[],
        actions: [] as unknown[],
        menus: [] as string[],
      };
      (globalThis as { discoverMix?: typeof seen }).discoverMix = seen;
      ipcMain.removeHandler("discover.mixes");
      ipcMain.handle("discover.mixes", () => seen.mixes);
      ipcMain.removeHandler("discover.playMix");
      ipcMain.handle("discover.playMix", (_event, id: string, index: number, shuffle?: boolean) => {
        const found = seen.mixes.mixes.some((mix) => mix.id === id);
        if (found) seen.played.push([id, index, shuffle ?? false]);
        return found;
      });
      // Main's answers as the mix's download goes: Download, then Cancel with the head's count.
      const views = [
        { button: { action: "download", label: "Download" }, line: null },
        { button: { action: "cancel", label: "Cancel" }, line: "Downloading · 1 of 3" },
      ];
      ipcMain.removeHandler("downloads.ytList");
      ipcMain.handle("downloads.ytList", (_event, list: { id: string }) =>
        seen.mixes.mixes.some((mix) => mix.id === list.id)
          ? views[Math.min(seen.actions.length, 1)]
          : null,
      );
      // A streamed song's menu, as main gives it for a song a page brought.
      ipcMain.removeHandler("streamed.menu");
      ipcMain.handle("streamed.menu", (_event, videoId: string) => {
        seen.menus.push(videoId);
        return {
          title: videoId,
          entries: [{ action: "playNext" }, { action: "addToQueue" }],
          favorite: false,
          download: { kind: "download" },
        };
      });
      ipcMain.removeHandler("downloads.ytListAction");
      ipcMain.handle("downloads.ytListAction", (_event, action, list) => {
        seen.actions.push([action, list]);
      });
    }, fixture);
    const seen = () =>
      app.evaluate(
        () =>
          (
            globalThis as {
              discoverMix?: { played: unknown[]; actions: unknown[]; menus: string[] };
            }
          ).discoverMix!,
      );
    await page.evaluate(() =>
      (window as unknown as { wave: WaveBridge }).wave.settings.setYtMusic(true),
    );
    await page.reload();

    const home = page.getByTestId("home");
    const discover = home.getByRole("region", { name: text.home.sections.discover, exact: true });
    const title = text.discover.mixTitle("Fixture Artist");
    // The tile's play glyph shows on hover, plays the mix and stays on Home.
    await discover.getByRole("button", { name: `${title}, ` }).hover();
    await page.screenshot({ path: test.info().outputPath("discover-mix-tile.png") });
    await discover
      .getByRole("button", { name: text.playbackText.playValue(title), exact: true })
      .click();
    await expect.poll(async () => (await seen()).played).toEqual([["artist:fixture", 0, false]]);
    await expect(home).toBeVisible();

    // The tile opens the mix's page.
    await discover.getByRole("button", { name: `${title}, ` }).click();
    const mix = page.getByTestId("discover-mix");
    await expect(mix.locator("h1")).toHaveText(title);
    await expect(mix.locator(".hero-artist")).toHaveText("Fixture Artist, Other Artist");
    await expect(mix.locator(".hero .artwork")).toBeVisible();
    const rows = mix.getByRole("list", { name: title }).getByRole("listitem");
    await expect(rows).toHaveText([/New song 1/, /Pink Moon/, /New song 2/, /New song 3/]);

    // Play, Shuffle, a row's double click: each plays the mix as main places it.
    await mix.getByRole("button", { name: text.desktopLayout.play, exact: true }).click();
    await mix.getByRole("button", { name: text.desktopLayout.shuffle, exact: true }).click();
    await rows.nth(1).dblclick();
    await expect
      .poll(async () => (await seen()).played)
      .toEqual([
        ["artist:fixture", 0, false],
        ["artist:fixture", 0, false],
        ["artist:fixture", 0, true],
        ["artist:fixture", 1, false],
      ]);

    // The Library song has the Library's menu, a streamed one YT Music's.
    await rows.nth(1).click({ button: "right" });
    const libraryMenu = page.getByRole("menu", { name: text.desktopLibrary.songMenu("Pink Moon") });
    await expect(libraryMenu).toBeVisible();
    const removeFromLibrary = text.itemActions.labels.removeFromLibrary;
    await expect(libraryMenu.getByRole("menuitem", { name: removeFromLibrary })).toBeVisible();
    await page.keyboard.press("Escape");
    await rows.nth(0).click({ button: "right" });
    const streamedMenu = page.getByRole("menu", {
      name: text.desktopLibrary.songMenu("New song 1"),
    });
    await expect(streamedMenu).toBeVisible();
    await expect(streamedMenu.getByRole("menuitem", { name: removeFromLibrary })).toHaveCount(0);
    expect((await seen()).menus).toEqual(["mixsong0001"]);
    await page.keyboard.press("Escape");

    // Download queues the songs the Library lacks; the head counts them on their way.
    const download = mix.getByTestId("yt-list-download");
    await expect(download).toHaveText("Download");
    await download.click();
    await expect(download).toHaveText("Cancel");
    await expect(mix.getByTestId("yt-list-download-line")).toHaveText("Downloading · 1 of 3");
    expect((await seen()).actions).toEqual([
      ["download", { kind: "discoverMix", id: "artist:fixture" }],
    ]);
    for (const theme of ["light", "dark"] as const) {
      await page.emulateMedia({ colorScheme: theme });
      await page.screenshot({ path: test.info().outputPath(`discover-mix-${theme}.png`) });
    }
    await page.emulateMedia({ colorScheme: "light" });

    // Discover's heading for the mix opens the same page.
    await page.getByRole("button", { name: text.desktopLayout.back, exact: true }).click();
    await expect(home).toBeVisible();
    await page.getByRole("button", { name: text.desktopLayout.discover, exact: true }).click();
    const discoverPage = page.getByTestId("discover");
    await discoverPage.getByRole("button", { name: title, exact: true }).click();
    await expect(mix.locator("h1")).toHaveText(title);

    // Home rebuilt its mixes: the page says the mix is gone, and nothing plays.
    await app.evaluate(() => {
      (globalThis as { discoverMix?: { mixes: unknown } }).discoverMix!.mixes = {
        status: "ok",
        mixes: [],
      };
    });
    await page.getByRole("button", { name: text.desktopLayout.back, exact: true }).click();
    await page.getByRole("button", { name: text.desktopLayout.forward, exact: true }).click();
    await expect(mix.getByRole("heading", { name: text.discover.goneTitle })).toBeVisible();
    await expect(mix).toContainText(text.discover.goneMessage);
    await expect(mix.getByRole("button")).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath("discover-mix-gone.png") });
    expect((await seen()).played).toHaveLength(4);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
