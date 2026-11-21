import { createHash } from "node:crypto";
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { crc32, deflateSync } from "node:zlib";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";

/**
 * Share in the Lyrics view: picking up to five lines next to each other (blank ones skipped),
 * the card's preview in the cover's colours, and Save Image and Copy Image.
 */
const appFolder = join(import.meta.dirname, "..");

/** Synced lyrics with a pause after the first line, plain lyrics, and lyrics with no words. */
const SONGS = {
  Tides: [
    "[00:00.00]One",
    "[00:02.00]",
    "[00:03.00]Two",
    "[00:04.00]Three",
    "[00:05.00]Four",
    "[00:06.00]Five",
    "[00:07.00]Six",
    "[00:08.00]Seven",
  ].join("\n"),
  Plain: "Just words\nAnd more words\n",
  Hum: "[00:00.00]\n[00:03.00]\n",
};

const writeSong = (path: string) => {
  // 20 seconds of mono 16-bit PCM.
  const rate = 8_000;
  const wave = Buffer.alloc(44 + 20 * rate * 2);
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

/** A 64 px PNG cover in four colours, so its palette has several to cycle through. */
const writeCover = (path: string) => {
  const size = 64;
  const quarters = [
    [200, 40, 40],
    [30, 60, 180],
    [240, 200, 40],
    [20, 90, 50],
  ];
  const rows = Buffer.alloc(size * (1 + size * 3));
  for (let y = 0; y < size; y++) {
    const row = y * (1 + size * 3);
    for (let x = 0; x < size; x++) {
      const [r, g, b] = quarters[(y < size / 2 ? 0 : 2) + (x < size / 2 ? 0 : 1)]!;
      rows.set([r!, g!, b!], row + 1 + x * 3);
    }
  }
  const chunk = (type: string, data: Buffer) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, "latin1"), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body));
    return Buffer.concat([length, body, crc]);
  };
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header.set([8, 2, 0, 0, 0], 8);
  writeFileSync(
    path,
    Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      chunk("IHDR", header),
      chunk("IDAT", deflateSync(rows)),
      chunk("IEND", Buffer.alloc(0)),
    ]),
  );
};

/** Plays [title] and pauses it at its start, so only a seek moves the song. */
const play = async (page: Page, title: string) => {
  await page.getByRole("button", { name: "Songs", exact: true }).click();
  await page.getByRole("row", { name: new RegExp(title) }).dblclick();
  await expect(page.getByRole("button", { name: "Pause", exact: true })).toBeEnabled();
  await page.evaluate(async () => {
    const { playback } = (window as unknown as { wave: WaveBridge }).wave;
    await playback.pause();
    await playback.seek(0);
  });
};

test("Share picks lyric lines and makes an image of them, saved or copied", async () => {
  // The first lyrics wait for the JVM to start, which is slow on a busy machine.
  test.setTimeout(300_000);
  const data = mkdtempSync(join(tmpdir(), "wave-lyrics-share-"));
  const saved = join(data, "card.png");
  const cover = join(data, "cover.png");
  writeCover(cover);
  const hash = createHash("sha1").update(readFileSync(cover)).digest("hex");
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      db.run(sql`INSERT INTO desktop_settings (key, value) VALUES ('settings.ytMusic', 'off')`);
      for (const [title, lyrics] of Object.entries(SONGS)) {
        const path = join(data, `${title}.wav`);
        writeSong(path);
        writeFileSync(join(data, `${title}.lrc`), lyrics);
        const id = addTrack(db, {
          title,
          artist: "Ana",
          durationMs: 20_000,
          ...(title === "Tides" ? { artworkHash: hash } : {}),
        });
        db.run(sql`UPDATE tracks SET path=${path} WHERE id=${id}`);
      }
      db.run(sql`UPDATE artwork SET path=${cover}, thumb_path=${cover} WHERE hash=${hash}`);
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    await play(page, "Tides");
    await page.getByRole("button", { name: "Lyrics", exact: true }).click();
    const panel = page.getByRole("tabpanel");
    const line = (words: string) => panel.getByRole("option", { name: words, exact: true });
    await expect(line("One")).toBeVisible({ timeout: 90_000 });
    await expect(line("One")).toHaveAttribute("aria-current", "true");

    // Share comes after Karaoke and Translate.
    const share = panel.getByRole("button", { name: "Share Lyrics", exact: true });
    await expect(panel.locator(".lyrics-header button").last()).toHaveAttribute(
      "aria-label",
      "Share Lyrics",
    );
    await share.click();
    const bar = panel.getByRole("toolbar", { name: "Share Lyrics" });
    await expect(bar).toContainText("Select up to 5 lines");
    const next = bar.getByRole("button", { name: "Next", exact: true });
    await expect(next).toBeDisabled();

    // A click picks instead of seeking; a line away from the block does nothing.
    await line("One").click();
    await expect(line("One")).toHaveAttribute("aria-checked", "true");
    await expect(bar).toContainText("1 of 5");
    await line("Three").click();
    await expect(line("Three")).toHaveAttribute("aria-checked", "false");
    await expect(bar).toContainText("1 of 5");
    // The pause can't be picked, and the next worded line joins the block over it.
    await panel.locator('[data-line="1"]').click();
    await expect(bar).toContainText("1 of 5");
    for (const words of ["Two", "Three", "Four", "Five"]) await line(words).click();
    await expect(bar).toContainText("5 of 5");
    // A sixth line does nothing.
    await line("Six").click();
    await expect(line("Six")).toHaveAttribute("aria-checked", "false");
    await expect(bar).toContainText("5 of 5");
    // Nothing seeked: the sung line is still the first.
    await expect(line("One")).toHaveAttribute("aria-current", "true");
    // An end line leaves the block.
    await line("One").click();
    await expect(bar).toContainText("4 of 5");
    await page.screenshot({ path: test.info().outputPath("lyrics-share-picking.png") });

    // Next: the card with the cover, title, artist, the lines and the Wave mark.
    await next.click();
    const preview = page.getByRole("dialog", { name: "Share Lyrics" });
    const card = preview.getByTestId("lyric-card");
    await expect(card).toContainText("Tides");
    await expect(card).toContainText("Ana");
    await expect(card.locator(".lyric-card-line")).toHaveText(["Two", "Three", "Four", "Five"]);
    await expect(card).toContainText("Wave");
    await expect(card.locator(".lyric-card-cover img")).toHaveCount(1);
    await expect(card.locator(".lyric-card-mark svg")).toHaveCount(1);
    await expect
      .poll(() => card.evaluate((element) => (element as HTMLElement).offsetWidth))
      .toBe(1080);
    await expect(preview).toContainText("Click the card to change its colour");

    // A click on the card moves to the cover's next colour.
    const background = () => card.evaluate((element) => getComputedStyle(element).backgroundColor);
    const first = await background();
    await preview.getByRole("button", { name: "Lyrics card", exact: true }).click();
    await expect.poll(background).not.toBe(first);
    await page.screenshot({ path: test.info().outputPath("lyrics-share-card.png") });

    // Save Image: the save dialog at the phone's file name, and a 1080 px wide PNG.
    await app.evaluate(({ dialog }, path) => {
      const asked: unknown[] = [];
      (globalThis as { lyricSaveAsked?: unknown[] }).lyricSaveAsked = asked;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        asked.push(args.at(-1));
        return { canceled: false, filePath: path };
      }) as typeof dialog.showSaveDialog;
    }, saved);
    await preview.getByRole("button", { name: "Save Image", exact: true }).click();
    await expect(page.getByText("Image saved", { exact: true })).toBeVisible();
    const asked = await app.evaluate(
      () =>
        (globalThis as { lyricSaveAsked?: { defaultPath: string }[] }).lyricSaveAsked![0]!
          .defaultPath,
    );
    expect(basename(asked)).toMatch(/^Wave - Tides - \d{8}-\d{6}\.png$/);
    const png = readFileSync(saved);
    copyFileSync(saved, test.info().outputPath("lyrics-share-image.png"));
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect(png.readUInt32BE(16)).toBe(1080);
    const height = png.readUInt32BE(20);
    expect(height).toBeGreaterThanOrEqual(1080);
    expect(height).toBeLessThanOrEqual(1920);
    const colours = await app.evaluate(({ nativeImage }, path) => {
      const bitmap = nativeImage.createFromPath(path).toBitmap();
      const seen = new Set<number>();
      for (let at = 0; at < bitmap.length; at += 4 * 97) seen.add(bitmap.readUInt32LE(at));
      return seen.size;
    }, saved);
    expect(colours).toBeGreaterThan(20);

    // Copy Image: the same picture, on the clipboard.
    await app.evaluate(({ clipboard }) => clipboard.clear());
    await preview.getByRole("button", { name: "Copy Image", exact: true }).click();
    await expect(page.getByText("Image copied", { exact: true })).toBeVisible();
    const copied = await app.evaluate(async ({ clipboard, nativeImage }) => {
      const [item] = await clipboard.read();
      const blob = await item!.getType("image/png");
      return nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer())).getSize();
    });
    expect(copied).toEqual({ width: 1080, height });

    // Esc closes the card, back to picking; Esc again leaves picking, and a click seeks again.
    await page.keyboard.press("Escape");
    await expect(preview).toHaveCount(0);
    await expect(bar).toContainText("4 of 5");
    await page.keyboard.press("Escape");
    await expect(bar).toHaveCount(0);
    await expect(line("Two")).not.toHaveAttribute("aria-checked", "true");
    await line("Three").click();
    await expect(line("Three")).toHaveAttribute("aria-current", "true");

    // Cancel leaves picking.
    await share.click();
    await line("Three").click();
    await bar.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(bar).toHaveCount(0);

    // Now Playing has Share too, and a new song leaves picking.
    await page.locator(".player-title:not(.player-credit-twin)").click();
    const nowPlaying = page.getByTestId("now-playing");
    await nowPlaying.getByRole("button", { name: "Share Lyrics", exact: true }).click();
    await expect(nowPlaying.getByRole("toolbar", { name: "Share Lyrics" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(nowPlaying.getByRole("toolbar", { name: "Share Lyrics" })).toHaveCount(0);
    await expect(nowPlaying).toBeVisible();
    await nowPlaying.getByRole("button", { name: "Share Lyrics", exact: true }).click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("Escape");
    await expect(nowPlaying).toHaveCount(0);

    await share.click();
    await expect(bar).toBeVisible();
    await play(page, "Plain");
    await expect(line("Just words")).toBeVisible({ timeout: 30_000 });
    await expect(bar).toHaveCount(0);
    // Plain lyrics can be shared too.
    await expect(share).toBeVisible();

    // Lyrics without a word have no Share.
    await play(page, "Hum");
    await expect(panel.getByRole("button", { name: "Translate Lyrics", exact: true })).toBeVisible({
      timeout: 30_000,
    });
    await expect(share).toHaveCount(0);
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
