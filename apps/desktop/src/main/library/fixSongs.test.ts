import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { sql } from "drizzle-orm";
import { openTestDatabase } from "@wave/client/testing";
import type { FoundTags, SongLookup } from "@wave/core";
import type { SongTags } from "../../shared/tags.ts";
import { fixSongs, type WriteSong } from "./fixSongs.ts";
import { createScanner } from "./scanner.ts";

const FOUND: FoundTags = {
  lyrics: { text: "[00:01.00]Pink moon is on its way", synced: true },
  genre: "Folk",
  trackNumber: 1,
  discNumber: 1,
  year: 1972,
  explicit: "clean",
};

test("Fix Songs looks up what a song lacks, writes it into the file and the Library rereads it", async () => {
  const folder = await mkdtemp(join(tmpdir(), "wave-fix-"));
  const music = join(folder, "Music");
  await mkdir(music);
  await writeFile(join(music, "Pink Moon.mp3"), "music");
  await writeFile(join(music, "Complete.mp3"), "music");
  const file = new Map<string, Partial<SongTags>>();
  const tagsOf = (path: string): Partial<SongTags> =>
    file.get(path) ??
    (path.endsWith("Complete.mp3")
      ? {
          title: "Place to Be",
          artist: "Nick Drake",
          album: "Pink Moon",
          genre: "Folk",
          trackNumber: "4",
          year: "1972",
          advisory: "0",
          hasLyrics: true,
          durationMs: 163000,
        }
      : { title: "Pink Moon", artist: "Nick Drake", album: "Pink Moon", durationMs: 124000 });
  const db = await openTestDatabase();
  const scanner = createScanner({
    db,
    platform: process.platform,
    musicFolder: music,
    readTags: async (path) => tagsOf(path),
  });
  const asked: SongLookup[] = [];
  const written: Parameters<WriteSong>[0][] = [];
  try {
    await scanner.refresh();
    const ids = scanner.songs(0, 20).items.map((song) => song.id);
    const result = await fixSongs(
      {
        db,
        lookUp: async (song) => {
          asked.push(song);
          return FOUND;
        },
        writeSong: async (params) => {
          written.push(params);
          file.set(params.path, {
            ...tagsOf(params.path),
            genre: params.genre,
            trackNumber: String(params.trackNumber),
            year: String(params.year),
            advisory: String(params.advisory),
            hasLyrics: true,
          });
          return {
            lyrics: "tags",
            genre: "tags",
            trackNumber: "tags",
            year: "tags",
            explicit: "tags",
          };
        },
        reimport: (path) => scanner.importFile(path),
        minMs: 0,
      },
      ids,
    );
    assert.deepEqual(asked, [
      { title: "Pink Moon", artist: "Nick Drake", album: "Pink Moon", durationMs: 124000 },
    ]);
    assert.equal(written.length, 1);
    assert.equal(written[0]!.lyrics, "[00:01.00]Pink moon is on its way");
    assert.equal(written[0]!.advisory, 0);
    assert.equal(result.skipped, 1);
    assert.deepEqual(
      result.results.map((r) => [r.title, r.outcome.kind]),
      [["Pink Moon", "updated"]],
    );
    assert.deepEqual(
      db.all(
        sql`SELECT g.name AS genre, t.has_lyrics AS hasLyrics, t.year, t.explicit FROM tracks t
          JOIN genres g ON g.id = t.genre_id WHERE t.title = 'Pink Moon'`,
      ),
      [{ genre: "Folk", hasLyrics: 1, year: 1972, explicit: "clean" }],
    );
  } finally {
    scanner.dispose();
    await rm(folder, { recursive: true, force: true });
  }
});

test("Fix Songs stops when LRCLIB and Deezer can't be reached", async () => {
  const folder = await mkdtemp(join(tmpdir(), "wave-fix-off-"));
  const music = join(folder, "Music");
  await mkdir(music);
  for (const name of ["A", "B", "C", "D", "E"])
    await writeFile(join(music, `${name}.mp3`), "music");
  const db = await openTestDatabase();
  const scanner = createScanner({
    db,
    platform: process.platform,
    musicFolder: music,
    readTags: async (path) => ({
      title: path.slice(-5, -4),
      artist: "Nick Drake",
      durationMs: 1000,
    }),
  });
  try {
    await scanner.refresh();
    const ids = scanner.songs(0, 20).items.map((song) => song.id);
    const result = await fixSongs(
      {
        db,
        lookUp: async () => null,
        writeSong: async () => assert.fail("nothing found, nothing written"),
        reimport: async () => {},
        minMs: 0,
      },
      ids,
    );
    assert.equal(result.results.length, 3);
    assert.deepEqual(result.stop, { stopped: "unreachable", left: 2 });
  } finally {
    scanner.dispose();
    await rm(folder, { recursive: true, force: true });
  }
});
