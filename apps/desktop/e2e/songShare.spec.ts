import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { catalogueOf } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";

/**
 * A song's Share submenu (docs/spec.md, Sharing a song): its links copied as the phone gives
 * them, Spotify's disabled signed out, and its card saved and copied as a 1080 px PNG.
 */
const appFolder = join(import.meta.dirname, "..");
const text = catalogueOf("en", "desktop");

/** A one-second silent stereo WAV at [path]. */
const silence = (path: string) => {
  const rate = 44_100;
  const data = Buffer.alloc(rate * 4);
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

const setYtMusic = (page: Page, on: boolean) =>
  page.evaluate(
    (on) => (window as unknown as { wave: WaveBridge }).wave.settings.setYtMusic(on),
    on,
  );

test("a song's Share submenu copies its links and saves or copies its card", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-share-song-"));
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      const id = addTrack(db, { title: "Pink Moon", album: "Pink Moon", artist: "Nick Drake" });
      const path = join(data, "Pink Moon.wav");
      silence(path);
      db.run(sql`UPDATE tracks SET path=${path}, video_id=${"abcdefghijk"} WHERE id=${id}`);
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const app = await electron.launch({
    args: [appFolder, "--lang=en-US"],
    env: { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") },
  });
  try {
    const page = await app.firstWindow();
    const menu = page.getByRole("menu");
    const entry = (name: string) => menu.getByRole("menuitem", { name, exact: true });
    const toast = (message: string) => page.getByRole("status").filter({ hasText: message });
    await setYtMusic(page, true);
    await page.getByRole("button", { name: "Songs", exact: true }).click();
    const row = page.getByRole("row", { name: /Pink Moon/ });
    const openShare = async () => {
      await row.click({ button: "right" });
      await expect(
        page.getByRole("menu", { name: text.desktopLibrary.songMenu("Pink Moon") }),
      ).toBeVisible();
      await entry(text.itemActions.labels.share).click();
      await expect(page.getByRole("menu", { name: text.itemActions.labels.share })).toBeVisible();
    };

    // Copy Link and Copy YT Music Link give the phone's addresses for the song's video.
    await openShare();
    await expect(menu.getByRole("menuitem")).toHaveText([
      text.share.copyLink,
      `${text.share.copySpotifyLink}${text.share.linkNotes.signedOut}`,
      text.share.copyYtMusicLink,
      text.share.saveImage,
      text.share.copyImage,
    ]);
    // Signed out of Spotify, its link is disabled and says so.
    await expect(
      menu.getByRole("menuitem", { name: new RegExp(text.share.copySpotifyLink) }),
    ).toHaveAttribute("aria-disabled", "true");
    await page.screenshot({ path: test.info().outputPath(`song-share-${process.platform}.png`) });
    await entry(text.share.copyLink).click();
    await expect(toast(text.share.linkCopied)).toBeVisible();
    expect(await app.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      "https://song.link/y/abcdefghijk",
    );
    await openShare();
    await entry(text.share.copyYtMusicLink).click();
    await expect
      .poll(() => app.evaluate(({ clipboard }) => clipboard.readText()))
      .toBe("https://music.youtube.com/watch?v=abcdefghijk");

    // Save Image opens the system's save dialog at the phone's name; the card is 1080 px wide.
    const saved = join(data, "card.png");
    await app.evaluate(({ dialog }, path) => {
      const asked: unknown[] = [];
      (globalThis as { songSaveAsked?: unknown[] }).songSaveAsked = asked;
      dialog.showSaveDialog = (async (...args: unknown[]) => {
        asked.push(args.at(-1));
        return { canceled: false, filePath: path };
      }) as typeof dialog.showSaveDialog;
    }, saved);
    await openShare();
    await entry(text.share.saveImage).click();
    await expect(toast(text.share.imageSaved)).toBeVisible();
    const asked = await app.evaluate(
      () =>
        (globalThis as { songSaveAsked?: { defaultPath: string }[] }).songSaveAsked![0]!
          .defaultPath,
    );
    expect(basename(asked)).toMatch(/^Wave - Pink Moon - \d{8}-\d{6}\.png$/);
    const png = readFileSync(saved);
    writeFileSync(test.info().outputPath(`song-card-${process.platform}.png`), png);
    expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
    expect([png.readUInt32BE(16), png.readUInt32BE(20)]).toEqual([1080, 1512]);
    // Its title, artist and mark leave more than the card's one colour.
    const colours = await app.evaluate(({ nativeImage }, path) => {
      const bitmap = nativeImage.createFromPath(path).toBitmap();
      const seen = new Set<number>();
      for (let at = 0; at < bitmap.length; at += 4 * 97) seen.add(bitmap.readUInt32LE(at));
      return seen.size;
    }, saved);
    expect(colours).toBeGreaterThan(3);

    // Copy Image puts the same card on the clipboard.
    await app.evaluate(({ clipboard }) => clipboard.clear());
    await openShare();
    await entry(text.share.copyImage).click();
    await expect(toast(text.share.imageCopied)).toBeVisible();
    const copied = await app.evaluate(async ({ clipboard, nativeImage }) => {
      const [item] = await clipboard.read();
      const blob = await item!.getType("image/png");
      return nativeImage.createFromBuffer(Buffer.from(await blob.arrayBuffer())).getSize();
    });
    expect(copied).toEqual({ width: 1080, height: 1512 });

    // With YT Music off the submenu holds the two image items only.
    await setYtMusic(page, false);
    await openShare();
    await expect(menu.getByRole("menuitem")).toHaveText([
      text.share.saveImage,
      text.share.copyImage,
    ]);
    await page.keyboard.press("Escape");
  } finally {
    await app.close();
    rmSync(data, { recursive: true, force: true });
  }
});
