import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { catalogueOf } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";

/**
 * Recognize over the built app: Chromium's fake microphone feeds the real capture and the JVM's
 * signature, and a fake Shazam answers. The card listens with Cancel, names a Library song with
 * its actions, adds it to a Shazam playlist it creates, says No match and No connection with
 * Try Again, and pauses playback while the microphone listens.
 */
const appFolder = join(import.meta.dirname, "..");
const text = catalogueOf("en", "desktop");
const answers = join(
  import.meta.dirname,
  "../../../packages/kotlin-shared/src/testFixtures/resources/fixtures/shazam/answers",
);
/** Shazam's match for I Will Survive, without its cover (no request leaves for the web). */
const MATCH = (() => {
  const answer = JSON.parse(readFileSync(join(answers, "match.json"), "utf8"));
  delete answer.track.images;
  return JSON.stringify(answer);
})();
const NO_MATCH = readFileSync(join(answers, "no-match.json"), "utf8");

/** [seconds] of silent mono WAV at [path]. */
const silence = (path: string, seconds: number) => {
  const rate = 8_000;
  const wave = Buffer.alloc(44 + rate * 2 * seconds);
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

const state = (page: Page) =>
  page.evaluate(async () => {
    const wave = (window as unknown as { wave: WaveBridge }).wave;
    const view = await wave.playback.view();
    return view.status.state;
  });

test("Recognize names a song from the microphone, with its actions and failures", async () => {
  test.setTimeout(240_000);
  const data = mkdtempSync(join(tmpdir(), "wave-recognize-"));
  const shazam = { answer: MATCH, asks: 0 };
  const server = createServer((request, response) => {
    request.resume();
    request.on("end", () => {
      shazam.asks++;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(shazam.answer);
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const shazamUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  try {
    await Effect.runPromise(
      Effect.gen(function* () {
        const db = (yield* Database) as unknown as TestDatabase;
        const path = join(data, "I Will Survive.wav");
        silence(path, 120);
        const id = addTrack(db, {
          title: "I Will Survive",
          artist: "Gloria Gaynor",
          album: "Love Tracks",
          durationMs: 120_000,
        });
        db.run(sql`UPDATE tracks SET path=${path} WHERE id=${id}`);
      }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
    );
    const app = await electron.launch({
      // Chromium's fake microphone: a tone the JVM hears as sound.
      args: ["--use-fake-device-for-media-stream", appFolder, "--lang=en-US"],
      env: {
        ...process.env,
        WAVE_DATA_DIR: data,
        WAVE_MUSIC_DIR: join(data, "Absent"),
        WAVE_SHAZAM_URL: shazamUrl,
      },
    });
    try {
      const page = await app.firstWindow();
      // Nothing leaves for YouTube: a match the Library lacks would be searched there.
      await page.evaluate(() =>
        (window as unknown as { wave: WaveBridge }).wave.settings.setYtMusic(false),
      );

      // Outside Recognize the page gets no microphone.
      expect(
        await page.evaluate(() =>
          navigator.mediaDevices.getUserMedia({ audio: true }).then(
            () => "granted",
            (error: DOMException) => error.name,
          ),
        ),
      ).toBe("NotAllowedError");

      // Wave plays; listening through the microphone pauses it.
      await page.evaluate(() =>
        (window as unknown as { wave: WaveBridge }).wave.playback.start({ kind: "songs" }, 0),
      );
      await expect.poll(() => state(page)).toBe("playing");
      const field = page.getByRole("searchbox", { name: text.desktopLayout.search });
      await field.fill("x");
      await expect(page.getByRole("button", { name: "Recognize Song" })).toHaveCount(0);
      await field.fill("");
      await page.getByRole("button", { name: "Recognize Song" }).click();
      const card = page.getByTestId("recognize-card");
      await expect(card).toContainText("Listening…");
      await expect(card).toContainText("Bring the music near the microphone.");
      await expect(card.getByRole("button", { name: "Cancel" })).toBeVisible();
      await expect(card.getByRole("radio", { name: "Around me" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await expect.poll(() => state(page)).toBe("paused");

      // After four seconds heard, Shazam names the Library's song, and Wave plays again.
      await expect(card).toContainText("I Will Survive", { timeout: 20_000 });
      await expect(card).toContainText("Gloria Gaynor");
      await expect(card.locator(".recognize-entries button")).toHaveText([
        "Play",
        "Play Next",
        "Add to Shazam",
        "Add to Playlist",
        "Go to Album",
      ]);
      await expect.poll(() => state(page)).toBe("playing");
      expect(shazam.asks).toBe(1);
      await page.screenshot({ path: test.info().outputPath("recognize-result.png") });

      // Add to Shazam creates the Shazam playlist with the song at its top.
      await card.getByRole("button", { name: "Add to Shazam" }).click();
      await expect(page.getByRole("status")).toContainText("Added to Shazam");
      const shazamPlaylist = () =>
        page.evaluate(async () => {
          const wave = (window as unknown as { wave: WaveBridge }).wave;
          const lists = await wave.library.browse({ kind: "playlists" }, 0, 50);
          const row = lists.items.find((item) => item.title === "Shazam");
          if (row === undefined) return null;
          const songs = await wave.library.browse({ kind: "playlist", id: row.id }, 0, 50);
          return songs.items.map((song) => song.title);
        });
      await expect.poll(shazamPlaylist).toEqual(["I Will Survive"]);

      // No match, after every ask, says so with Try Again.
      shazam.answer = NO_MATCH;
      await card.getByRole("button", { name: "Listen Again" }).click();
      await expect(card).toContainText("Listening…");
      await expect(card).toContainText("No match", { timeout: 60_000 });
      await expect(card.getByRole("button", { name: "Try Again" })).toBeVisible();

      // Cancel ends the session and closes the card.
      await card.getByRole("button", { name: "Try Again" }).click();
      await expect(card).toContainText("Listening…");
      await card.getByRole("button", { name: "Cancel" }).click();
      await expect(card).toHaveCount(0);
      await expect.poll(() => state(page)).toBe("playing");

      // What the computer plays is its own source, named as the computer's.
      await page.getByRole("button", { name: "Recognize Song" }).click();
      await card.getByRole("radio", { name: "This computer" }).click();
      await expect(card.getByRole("radio", { name: "This computer" })).toHaveAttribute(
        "aria-checked",
        "true",
      );
      await expect(card).toContainText("Listening to audio from this computer.");
      await card.press("Escape");
      await expect(card).toHaveCount(0);

      // Without a connection the card says so, with Try Again.
      await app.evaluate(({ net }) => {
        Object.defineProperty(net, "isOnline", { value: () => false, configurable: true });
      });
      const asked = shazam.asks;
      await page.getByRole("button", { name: "Recognize Song" }).click();
      await expect(card).toContainText("No connection");
      await expect(card.getByRole("button", { name: "Try Again" })).toBeVisible();
      expect(shazam.asks).toBe(asked);
      await card.getByRole("button", { name: "Close" }).click();
      await expect(card).toHaveCount(0);
    } finally {
      await app.close();
    }
  } finally {
    server.close();
    rmSync(data, { recursive: true, force: true });
  }
});
