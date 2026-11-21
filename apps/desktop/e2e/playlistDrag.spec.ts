import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test, type Locator, type Page } from "@playwright/test";
import { Database } from "@wave/client";
import { createPlaylist } from "@wave/client/db/playlists";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import * as Effect from "effect/Effect";

import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";

/**
 * A playlist's songs dragged to a new place on its page (#1218): one row, a selection, the
 * list scrolling near its edge, Alt+Up and Alt+Down, and the order after a restart.
 */
const appFolder = join(import.meta.dirname, "..");
const TITLES = Array.from({ length: 40 }, (_, n) => `Song ${String(n + 1).padStart(2, "0")}`);

const launch = (data: string) =>
  electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });

/** The titles of the playlist "Long", in its order. */
const playlistTitles = (page: Page) =>
  page.evaluate(async () => {
    const bridge = (window as unknown as { wave: WaveBridge }).wave;
    const lists = await bridge.library.browse({ kind: "playlists" }, 0, 50);
    const id = lists.items.find((row) => row.title === "Long")!.id;
    const songs = await bridge.library.browse({ kind: "playlist", id }, 0, 50);
    return songs.items.map((row) => row.title);
  });

/** [titles] with the songs [moved] taken out and put back, in that order, before [before]. */
const placed = (titles: readonly string[], moved: readonly string[], before: string | null) => {
  const rest = titles.filter((title) => !moved.includes(title));
  const at = before === null ? rest.length : rest.indexOf(before);
  return [...rest.slice(0, at), ...moved, ...rest.slice(at)];
};

/** Drags [from] to the top edge of [to], checks the line showing where it lands, and drops. */
const dragAbove = async (page: Page, from: Locator, to: Locator) => {
  await from.hover({ position: { x: 100, y: 16 } });
  const source = (await from.boundingBox())!;
  await page.mouse.down();
  // Start the drag before hovering a target that may scroll the source row away.
  await page.mouse.move(source.x + 110, source.y + 16);
  // A synthetic drag gets one event per move: the drag starts, enters [to], then goes over it.
  for (const x of [100, 104, 108]) await to.hover({ position: { x, y: 4 } });
  await expect(page.locator(".table-drop-line")).toBeVisible();
  await page.mouse.up();
  await expect(page.locator(".table-drop-line")).toHaveCount(0);
};

test("a playlist's songs drag to a new place, and the order stays after a restart", async () => {
  test.setTimeout(180_000);
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-playlist-drag-"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      const ids = TITLES.map((title, n) =>
        addTrack(db, { title, album: "Disc", artist: "Wave", trackNumber: n + 1 }),
      );
      createPlaylist(
        db,
        "Long",
        ids.map((trackId) => ({ source: "library", trackId })),
        1000,
      );
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  let expected = [...TITLES];
  let app = await launch(data);
  try {
    let page = await app.firstWindow();
    await page.setViewportSize({ width: 1400, height: 900 });
    const row = (title: string) => page.getByRole("row", { name: new RegExp(`${title}\\b`) });
    await page
      .locator(".sidebar-playlists")
      .getByRole("button", { name: "Long", exact: true })
      .click();
    await expect(row("Song 01")).toBeVisible();

    // One row, dropped above another, lands before it.
    await dragAbove(page, row("Song 03"), row("Song 06"));
    expected = placed(expected, ["Song 03"], "Song 06");
    await expect.poll(() => playlistTitles(page)).toEqual(expected);
    await expect(row("Song 03")).toHaveAttribute("aria-rowindex", "6");

    // A selection moves together, in the playlist's order.
    await row("Song 09").click();
    await row("Song 07").click({ modifiers: ["Control"] });
    await expect(row("Song 09")).toHaveAttribute("aria-selected", "true");
    await expect(row("Song 07")).toHaveAttribute("aria-selected", "true");
    await dragAbove(page, row("Song 09"), row("Song 02"));
    expected = placed(expected, ["Song 07", "Song 09"], "Song 02");
    await expect.poll(() => playlistTitles(page)).toEqual(expected);
    await page.keyboard.press("Escape");

    // Alt+Down and Alt+Up move the focused row.
    await row("Song 01").click();
    await page.keyboard.press("Alt+ArrowDown");
    expected = placed(expected, ["Song 01"], expected[2]!);
    await expect.poll(() => playlistTitles(page)).toEqual(expected);
    await page.keyboard.press("Alt+ArrowDown");
    expected = placed(expected, ["Song 01"], expected[3]!);
    await expect.poll(() => playlistTitles(page)).toEqual(expected);
    await page.keyboard.press("Alt+ArrowUp");
    expected = placed(expected, ["Song 01"], expected[1]!);
    await expect.poll(() => playlistTitles(page)).toEqual(expected);

    // Held near the bottom edge, the list scrolls on its own.
    const viewport = page.locator(".table-viewport");
    const box = (await viewport.boundingBox())!;
    await row("Song 04").hover();
    await page.mouse.down();
    for (const x of [200, 204, 208]) await viewport.hover({ position: { x, y: box.height - 6 } });
    await expect
      .poll(() => viewport.evaluate((element) => element.scrollTop), { timeout: 10_000 })
      .toBeGreaterThan(200);
    // At the bottom the rows stop changing under the pointer; a synthetic drag needs a move there.
    await expect
      .poll(() =>
        viewport.evaluate(
          (element) => element.scrollHeight - element.clientHeight - element.scrollTop,
        ),
      )
      .toBeLessThan(1);
    await viewport.hover({ position: { x: 212, y: box.height - 6 } });
    await page.mouse.up();
    await expect
      .poll(async () => (await playlistTitles(page)).indexOf("Song 04"), { timeout: 10_000 })
      .toBeGreaterThan(expected.indexOf("Song 04") + 5);
    expected = await playlistTitles(page);

    // A restart keeps the order.
    await app.close();
    app = await launch(data);
    page = await app.firstWindow();
    await expect.poll(() => playlistTitles(page)).toEqual(expected);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
