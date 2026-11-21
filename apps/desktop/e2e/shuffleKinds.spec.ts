import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron, expect, test } from "@playwright/test";
import { Database } from "@wave/client";
import { createPlaylist } from "@wave/client/db/playlists";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { catalogueOf } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";

import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";

/**
 * The kinds of shuffle: a right-click, Shift+F10 or the Menu key on a hero's Shuffle or the
 * player bar's opens Real, Smart and Even Shuffle with the phone's lines and a mark on the
 * chosen one; a pick shuffles by it; Settings › Playback shows and changes the same choice.
 */
const text = catalogueOf("en", "desktop");
const strings = text.playbackText;

/** A two-second stereo WAV of silence, enough for the engine to play. */
const quiet = (path: string) => {
  const rate = 44_100;
  const data = Buffer.alloc(rate * 2 * 4);
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

test("a shuffle control's menu and Settings › Playback choose the kind of shuffle", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-shuffle-kinds-"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      db.run(
        sql`INSERT INTO desktop_synced_preferences (key, value) VALUES ('settings.continueQueue', 'off')`,
      );
      const tracks = ["Nick Drake", "Vashti Bunyan"].flatMap((artist) =>
        [1, 2, 3].map((n) => {
          const trackId = addTrack(db, { title: `${artist} ${n}`, artist, album: artist });
          const path = join(data, `${trackId}.wav`);
          quiet(path);
          db.run(sql`UPDATE tracks SET path=${path} WHERE id=${trackId}`);
          return { source: "library" as const, trackId };
        }),
      );
      createPlaylist(db, "Turns", tracks, 1000);
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [join(import.meta.dirname, ".."), "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    const menu = page.getByRole("menu", { name: text.desktopLayout.shuffle, exact: true });
    const kind = (name: string) => menu.getByRole("menuitemradio", { name });
    const chosen = () =>
      page.evaluate(() =>
        (window as unknown as { wave: WaveBridge }).wave.settings
          .playback()
          .then((settings) => settings.shuffleKind),
      );
    const close = async () => {
      await page.keyboard.press("Escape");
      await expect(menu).toBeHidden();
    };

    await page
      .locator(".sidebar-playlists")
      .getByRole("button", { name: "Turns", exact: true })
      .click();
    const hero = page
      .locator(".hero-actions")
      .getByRole("button", { name: text.desktopLayout.shuffle, exact: true });

    // A right-click on the hero's Shuffle: the three kinds, each with its line, Real chosen.
    await hero.click({ button: "right" });
    await expect(menu.getByRole("menuitemradio")).toHaveCount(3);
    await expect(kind(strings.realShuffle)).toHaveAttribute("aria-checked", "true");
    await expect(kind(strings.realShuffle)).toContainText(strings.anyOrderEveryOneAsLikely);
    await expect(kind(strings.smartShuffle)).toContainText(
      strings.yourMostPlayedSpreadAmongTheRest,
    );
    await expect(kind(strings.evenShuffle)).toContainText(strings.artistsTakeTurnsNeverTwiceInARow);
    await expect(kind(strings.evenShuffle)).toHaveAttribute("aria-checked", "false");
    await page.screenshot({
      path: test.info().outputPath(`shuffle-kinds-menu-${process.platform}.png`),
    });
    await close();
    await expect(hero).toBeFocused();

    // Shift+F10 opens it too; ↓ and Enter choose the next kind.
    await page.keyboard.press("Shift+F10");
    await expect(kind(strings.realShuffle)).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await expect(kind(strings.smartShuffle)).toBeFocused();
    await page.keyboard.press("Enter");
    await expect.poll(chosen).toBe("smart");

    // The Menu key opens it with the mark on the kind now chosen.
    await hero.focus();
    await page.keyboard.press("ContextMenu");
    await expect(kind(strings.smartShuffle)).toHaveAttribute("aria-checked", "true");
    await close();

    // The player bar's shuffle has the same menu; Even Shuffle picked there shuffles by it.
    await hero.click();
    const bar = page
      .locator(".player-bar")
      .getByRole("button", { name: text.desktopLayout.shuffle, exact: true });
    await expect(bar).toBeEnabled();
    await bar.click({ button: "right" });
    await kind(strings.evenShuffle).click();
    await expect.poll(chosen).toBe("even");
    await expect(bar).toHaveAttribute("aria-pressed", "true");
    const artists = await page.evaluate(async () => {
      const bridge = (window as unknown as { wave: WaveBridge }).wave;
      const view = await bridge.playback.view();
      const rows = (await bridge.playback.queue(0, 10)).items;
      return rows.slice(view.index).map((row) => row.artist);
    });
    expect(artists.length).toBeGreaterThan(1);
    for (const [at, artist] of artists.entries()) {
      if (at > 0) expect(artist, artists.join(", ")).not.toBe(artists[at - 1]);
    }
    await page.keyboard.press("Space");

    // Settings › Playback shows the choice and changes it.
    await page.getByRole("button", { name: text.desktopLayout.settings, exact: true }).click();
    await page.getByRole("button", { name: text.desktopLayout.playback, exact: true }).click();
    const group = page.getByRole("radiogroup", { name: text.desktopLayout.shuffle, exact: true });
    await expect(group.getByRole("radio", { name: strings.evenShuffle })).toBeChecked();
    await expect(group).toContainText(strings.artistsTakeTurnsNeverTwiceInARow);
    await group.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: test.info().outputPath(`shuffle-kinds-settings-${process.platform}.png`),
    });
    await group.getByRole("radio", { name: strings.realShuffle }).check();
    await expect.poll(chosen).toBe("real");
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true, maxRetries: 5 });
  }
});
