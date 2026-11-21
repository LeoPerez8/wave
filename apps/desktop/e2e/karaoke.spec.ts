import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type Locator, type Page } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";

const appFolder = join(import.meta.dirname, "..");

const stamp = (ms: number) =>
  `${String(Math.floor(ms / 60_000)).padStart(2, "0")}:${(ms / 1000).toFixed(2).padStart(5, "0")}`;

/**
 * Each song's sidecar lyrics: Enhanced LRC's word stamps, synced lines without them, forty
 * lines (more than the view holds) and plain text.
 */
const SONGS = {
  Stamped: "[00:00.00]<00:00.00>One <00:05.00>two <00:10.00>three\n[00:20.00]Then go\n",
  Plain: "[00:00.00]aaaa bbbb\n[00:20.00]Then go\n",
  Long: Array.from(
    { length: 40 },
    (_, line) => `[${stamp(line * 700)}]Line ${String(line + 1).padStart(2, "0")}\n`,
  ).join(""),
  Words: "Just words\nAnd more words\n",
};

const writeSong = (path: string) => {
  // 30 seconds of mono 16-bit PCM so the test can seek between lines.
  const rate = 8_000;
  const wave = Buffer.alloc(44 + 30 * rate * 2);
  wave.write("RIFF", 0);
  wave.writeUInt32LE(wave.length - 8, 4);
  wave.write("WAVEfmt ", 8);
  wave.writeUInt32LE(16, 16);
  wave.writeUInt16LE(1, 20);
  wave.writeUInt16LE(1, 22);
  wave.writeUInt32LE(rate, 24);
  wave.writeUInt32LE(rate * 2, 28);
  wave.writeUInt16LE(2, 32);
  wave.writeUInt16LE(16, 34);
  wave.write("data", 36);
  wave.writeUInt32LE(wave.length - 44, 40);
  writeFileSync(path, wave);
};

/** Plays [title] and pauses it at once, so only a seek moves the song. */
const play = async (page: Page, title: string) => {
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("row", { name: new RegExp(title) }).dblclick();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeEnabled();
  await page.evaluate(() => (window as unknown as { wave: WaveBridge }).wave.playback.pause());
};

const seek = (page: Page, positionMs: number) =>
  page.evaluate(
    (to) => (window as unknown as { wave: WaveBridge }).wave.playback.seek(to),
    positionMs,
  );

const scrollTop = (view: Locator) => view.evaluate((element) => element.scrollTop);

/** Records how the lyrics in [view] are scrolled from here on: "smooth" is a slide. */
const watchScrolls = (view: Locator) =>
  view.evaluate((element) => {
    const moves: string[] = [];
    (window as unknown as { lyricMoves: string[] }).lyricMoves = moves;
    const scrollTo = element.scrollTo.bind(element);
    element.scrollTo = ((options: ScrollToOptions) => {
      moves.push(options.behavior ?? "auto");
      scrollTo(options);
    }) as typeof element.scrollTo;
  });
const scrolls = (page: Page) =>
  page.evaluate(() => (window as unknown as { lyricMoves: string[] }).lyricMoves);

test("Karaoke lights the sung line word by word, follows the song, and is kept across a restart", async () => {
  // The first lyrics wait for the JVM to start, which is slow on a busy machine.
  test.setTimeout(300_000);
  const data = mkdtempSync(join(tmpdir(), "wave-karaoke-"));
  const launch = () =>
    electron.launch({
      args: [appFolder, "--lang=en-US"],
      env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
    });
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = (yield* Database) as unknown as TestDatabase;
        for (const [title, lyrics] of Object.entries(SONGS)) {
          const path = join(data, `${title}.wav`);
          writeSong(path);
          writeFileSync(join(data, `${title}.lrc`), lyrics);
          const id = addTrack(db, { title, artist: "Ana", durationMs: 30_000 });
          db.run(sql`UPDATE tracks SET path=${path} WHERE id=${id}`);
        }
      }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
    );
    const app = await launch();
    try {
      const page = await app.firstWindow();
      await play(page, "Stamped");
      await seek(page, 0);
      await page.getByRole("button", { name: "Lyrics", exact: true }).click();
      const panel = page.getByRole("tabpanel");
      const first = panel.getByRole("option", { name: "One two three" });
      const last = panel.getByRole("option", { name: "Then go" });
      await expect(first).toBeVisible({ timeout: 90_000 });

      // Off by default: the sung line lights whole.
      const karaoke = panel.getByRole("button", { name: "Karaoke", exact: true });
      await expect(karaoke).toHaveAttribute("aria-pressed", "false");
      await expect(first).toHaveAttribute("aria-current", "true");
      await expect(panel.locator(".karaoke-word")).toHaveCount(0);

      // On: only the sung line splits into words, lit up to the one being sung.
      await karaoke.click();
      await expect(karaoke).toHaveAttribute("aria-pressed", "true");
      await expect(first.locator(".karaoke-word")).toHaveText(["One", "two", "three"]);
      await expect(first.locator(".karaoke-word.lit")).toHaveText(["One"]);
      await expect(last.locator(".karaoke-word")).toHaveCount(0);
      await expect(first.locator(".karaoke-word.lit")).toHaveCSS("opacity", "1");
      await expect(first.locator(".karaoke-word:not(.lit)").first()).not.toHaveCSS("opacity", "1");
      await expect(first).toHaveCSS("opacity", "1");
      await page.screenshot({ path: test.info().outputPath("karaoke-panel.png") });

      // Enhanced LRC's stamps time the words, and a seek either way lights the right one.
      await seek(page, 6_000);
      await expect(first.locator(".karaoke-word.lit")).toHaveText(["One", "two"]);
      await seek(page, 11_000);
      await expect(first.locator(".karaoke-word.lit")).toHaveText(["One", "two", "three"]);
      await seek(page, 1_000);
      await expect(first.locator(".karaoke-word.lit")).toHaveText(["One"]);

      // A click on a line lights its first word at once.
      await last.click();
      await expect(last).toHaveAttribute("aria-current", "true");
      await expect(last.locator(".karaoke-word.lit")).toHaveText(["Then"]);
      await expect(first.locator(".karaoke-word")).toHaveCount(0);

      // Lines without stamps share their span among their words.
      await play(page, "Plain");
      await seek(page, 0);
      const plain = panel.getByRole("option", { name: "aaaa bbbb" });
      await expect(plain.locator(".karaoke-word.lit")).toHaveText(["aaaa"]);
      await seek(page, 2_500);
      await expect(plain.locator(".karaoke-word.lit")).toHaveText(["aaaa", "bbbb"]);

      // Plain lyrics have no times to follow: no Karaoke button.
      await play(page, "Words");
      await expect(panel.getByRole("option", { name: "Just words" })).toBeVisible();
      await expect(karaoke).toHaveCount(0);
      await expect(panel.locator(".karaoke-word")).toHaveCount(0);

      // With Karaoke on the lyrics follow the song.
      await play(page, "Long");
      await seek(page, 0);
      const line = (number: number) =>
        panel.getByRole("option", { name: `Line ${String(number).padStart(2, "0")}`, exact: true });
      const view = panel.locator(".lyrics-scroll");
      await expect(line(1)).toHaveAttribute("aria-current", "true");
      await expect(karaoke).toHaveAttribute("aria-pressed", "true");
      await watchScrolls(view);
      await seek(page, 29 * 700);
      await expect(line(30)).toHaveAttribute("aria-current", "true");
      await expect(line(30)).toBeInViewport();
      expect(await scrollTop(view)).toBeGreaterThan(0);
      expect(await scrolls(page)).toContain("smooth");

      // A scroll by hand stops that until 3 seconds after the last one.
      await view.hover();
      await page.mouse.wheel(0, -20_000);
      await expect.poll(() => scrollTop(view)).toBe(0);
      await seek(page, 35 * 700);
      await expect(line(36)).toHaveAttribute("aria-current", "true");
      const scrolledAt = Date.now();
      await page.mouse.wheel(0, -1);
      expect(await scrollTop(view)).toBe(0);
      await expect(line(36)).toBeInViewport({ timeout: 15_000 });
      expect(Date.now() - scrolledAt).toBeGreaterThanOrEqual(2_500);

      // With reduced motion the lyrics still follow, and nothing slides.
      await page.emulateMedia({ reducedMotion: "reduce" });
      await watchScrolls(view);
      await seek(page, 9 * 700);
      await expect(line(10)).toHaveAttribute("aria-current", "true");
      await expect(line(10)).toBeInViewport();
      expect(await scrolls(page)).not.toContain("smooth");
      await expect(line(10).locator(".karaoke-word").first()).toHaveCSS(
        "transition-duration",
        "0s",
      );
      await page.emulateMedia({ reducedMotion: "no-preference" });

      // Off: the lyrics stay where they are from line to line and on a clicked line.
      await karaoke.click();
      await expect(karaoke).toHaveAttribute("aria-pressed", "false");
      await expect(panel.locator(".karaoke-word")).toHaveCount(0);
      const rest = await scrollTop(view);
      await seek(page, 38 * 700);
      await expect(line(39)).toHaveAttribute("aria-current", "true");
      await line(12).click();
      await expect(line(12)).toHaveAttribute("aria-current", "true");
      await seek(page, 38 * 700);
      await expect(line(39)).toHaveAttribute("aria-current", "true");
      expect(await scrollTop(view)).toBe(rest);
      await expect(line(39)).not.toBeInViewport();

      // Opening the view places the sung line once, with Karaoke off too.
      await page.getByRole("button", { name: "Lyrics", exact: true }).click();
      await expect(panel).toBeHidden();
      await page.getByRole("button", { name: "Lyrics", exact: true }).click();
      await expect(line(39)).toBeInViewport();

      // Now Playing has the same switch, and lights words too.
      await page.getByTitle("Opens Now Playing").click();
      const nowPlaying = page.getByRole("dialog", { name: "Now Playing", exact: true });
      const karaokeThere = nowPlaying.getByRole("button", { name: "Karaoke", exact: true });
      await expect(karaokeThere).toHaveAttribute("aria-pressed", "false");
      await expect(nowPlaying.locator("[aria-current=true]")).toBeInViewport();
      await karaokeThere.click();
      await expect(karaokeThere).toHaveAttribute("aria-pressed", "true");
      await expect(nowPlaying.locator("[aria-current=true] .karaoke-word.lit")).toHaveText([
        "Line",
      ]);
      await page.screenshot({ path: test.info().outputPath("karaoke-now-playing.png") });
      await page.keyboard.press("Escape");
      await expect(nowPlaying).toBeHidden();
      await expect(karaoke).toHaveAttribute("aria-pressed", "true");
    } finally {
      await app.close();
    }

    // A fresh app keeps Karaoke on.
    const reopened = await launch();
    try {
      const page = await reopened.firstWindow();
      await play(page, "Stamped");
      await seek(page, 0);
      await page.getByRole("button", { name: "Lyrics", exact: true }).click();
      const panel = page.getByRole("tabpanel");
      const first = panel.getByRole("option", { name: "One two three" });
      await expect(first).toBeVisible({ timeout: 90_000 });
      await expect(panel.getByRole("button", { name: "Karaoke", exact: true })).toHaveAttribute(
        "aria-pressed",
        "true",
      );
      await expect(first.locator(".karaoke-word.lit")).toHaveText(["One"]);
    } finally {
      await reopened.close();
    }
  } finally {
    rmSync(data, { recursive: true, force: true });
  }
});
