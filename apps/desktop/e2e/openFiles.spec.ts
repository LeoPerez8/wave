import { spawn } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron, expect, test, type Page } from "@playwright/test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { catalogueOf, scanPath } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import { libraryLayer } from "../src/main/database.ts";
import type { WaveBridge } from "../src/shared/bridge.ts";

const appFolder = join(import.meta.dirname, "..");
const electronPath = createRequire(import.meta.url)("electron") as string;
const text = catalogueOf("en", "desktop");

/** A silent stereo WAV of [seconds] at [path]. */
const silence = (path: string, seconds: number) => {
  const rate = 44_100;
  const data = Buffer.alloc(rate * 4 * seconds);
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

const playing = (page: Page) =>
  page.evaluate(async () => {
    const bridge = (window as unknown as { wave: WaveBridge }).wave;
    const view = await bridge.playback.view();
    const songs = await bridge.library.browse({ kind: "songs" }, 0, 50);
    return {
      title: view.current?.title ?? null,
      outside: view.current?.outside === true,
      state: view.status.state,
      length: view.length,
      library: songs.items.map((song) => song.title),
    };
  });

test("files opened with Wave play: at launch, and handed to the running window with Undo", async () => {
  const data = mkdtempSync(join(tmpdir(), "wave-e2e-open-"));
  const elsewhere = mkdtempSync(join(tmpdir(), "wave-e2e-open-files-"));
  mkdirSync(join(data, "Música"));
  const inLibrary = join(data, "Música", "library-song.wav");
  const loose = join(elsewhere, "Loose Tape.wav");
  const other = join(elsewhere, "Second Tape.wav");
  const notes = join(elsewhere, "notes.txt");
  // The Library's song is three seconds long, so its play counts when it plays through.
  silence(inLibrary, 3);
  silence(loose, 60);
  silence(other, 60);
  writeFileSync(notes, "not a song");
  await Effect.runPromise(
    Effect.gen(function* () {
      const db = (yield* Database) as unknown as TestDatabase;
      const id = addTrack(db, { title: "Library Song", artist: "Wave Test", album: "Opened" });
      // On Windows a case-only rename can leave the scan's previous spelling in the Library.
      const path = scanPath(realpathSync.native(inLibrary), process.platform);
      const stored = process.platform === "win32" ? path.replace("/Música/", "/MÚSICA/") : path;
      db.run(sql`UPDATE tracks SET path=${stored} WHERE id=${id}`);
    }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
  );
  const env = { ...process.env, WAVE_DATA_DIR: data, WAVE_MUSIC_DIR: join(data, "Absent") };
  /** A second launch, as "Open with" makes while Wave runs; it hands its files over and exits. */
  const openWith = async (...files: string[]) => {
    const second = spawn(electronPath, [appFolder, "--lang=en-US", ...files], {
      env,
      stdio: "ignore",
      windowsHide: true,
    });
    await new Promise<void>((resolve) => second.once("exit", () => resolve()));
  };
  const app = await electron.launch({ args: [appFolder, "--lang=en-US", loose], env });
  let closed = false;
  try {
    const page = await app.firstWindow();
    const toast = page.getByRole("status").filter({ hasText: text.playbackText.newQueuePlaying });

    // Opening a file starts Wave and plays it, without adding it to the Library.
    await expect
      .poll(async () => await playing(page), { timeout: 30_000 })
      .toEqual({
        title: "Loose Tape",
        outside: true,
        state: "playing",
        length: 1,
        library: ["Library Song"],
      });
    await expect(page.locator(".player-title").first()).toHaveText("Loose Tape");
    await expect(toast).toBeHidden();
    // Starring is the Library's.
    await expect(
      page.getByRole("button", { name: text.desktopLayout.favorite, exact: true }),
    ).toBeDisabled();

    // Files opened while Wave runs play in its window as a new queue, in order; the text file
    // among them is ignored.
    await openWith(other, notes, inLibrary);
    await expect
      .poll(async () => {
        const now = await playing(page);
        return [now.title, now.length];
      })
      .toEqual(["Second Tape", 2]);
    await expect(toast).toBeVisible();
    await page.screenshot({
      path: join(appFolder, "test-results", `open-files-${process.platform}.png`),
    });
    await toast.getByRole("button", { name: text.playbackText.undo }).click();
    await expect.poll(async () => (await playing(page)).title).toBe("Loose Tape");

    // A file the Library has plays as its song; a path that is no audio file changes nothing.
    await openWith(notes);
    await openWith(inLibrary);
    await expect
      .poll(async () => {
        const now = await playing(page);
        return [now.title, now.outside, now.library];
      })
      .toEqual(["Library Song", false, ["Library Song"]]);
    await expect.poll(async () => (await playing(page)).state).toBe("playing");
    // The queue plays out and stops.
    await expect.poll(async () => (await playing(page)).state, { timeout: 15_000 }).toBe("paused");
    await app.close();
    closed = true;
    const plays = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* Database;
        return db.all<{ title: string | null; counted: number }>(
          sql`SELECT t.title AS title, p.counted AS counted FROM play_events p LEFT JOIN tracks t ON t.id = p.track_id`,
        );
      }).pipe(Effect.provide(libraryLayer(join(data, "wave.db")))),
    );
    // Only the Library's song has a play, and it counted; the loose files left none.
    expect(plays).toEqual([{ title: "Library Song", counted: 1 }]);
  } finally {
    if (!closed) await app.close();
    rmSync(data, { recursive: true, force: true });
    rmSync(elsewhere, { recursive: true, force: true });
  }
});
