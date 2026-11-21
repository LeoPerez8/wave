import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { Database } from "@wave/client";
import { addTrack, type TestDatabase } from "@wave/client/testing";
import { createPlaylist } from "@wave/client/db/playlists";
import type { LibraryDatabase } from "@wave/client/db/database";
import {
  TYPED_RELEASE_BUCKETS,
  readTypedReleaseDates,
  storedSyncedBucket,
  syncedBucket,
  typedReleaseKey,
  type YtAlbumSong,
} from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import * as ManagedRuntime from "effect/ManagedRuntime";
import { libraryLayer } from "../database.ts";
import { keepPreference } from "../sync/desktopSync.ts";
import { browseLibrary } from "./browse.ts";
import { togglePlaylistSort } from "./browseSort.ts";
import {
  libraryReleaseSong,
  releaseDateView,
  saveReleaseDate,
  streamedReleaseSong,
} from "./releaseDates.ts";

const withLibrary = async (run: (db: LibraryDatabase) => void) => {
  const folder = mkdtempSync(join(tmpdir(), "wave-release-dates-"));
  const runtime = ManagedRuntime.make(libraryLayer(join(folder, "wave.db")));
  try {
    run(
      (await runtime.runPromise(
        Effect.gen(function* () {
          return yield* Database;
        }),
      )) as unknown as LibraryDatabase,
    );
  } finally {
    await runtime.dispose();
    rmSync(folder, { recursive: true, force: true });
  }
};

const add = (db: LibraryDatabase, track: Parameters<typeof addTrack>[1]) =>
  addTrack(db as unknown as TestDatabase, track);

const TODAY = "2026-11-21";
const fields = (year: string, month = "", day = "") => ({ year, month, day });

const parasite: YtAlbumSong = {
  videoId: "abcdefghijk",
  title: "Parasite",
  artists: ["Nick Drake"],
  album: "Pink Moon",
  albumId: "MPREb_pinkmoon",
  durationMs: 124_000,
  artworkUrl: null,
  explicit: false,
};

/** The synced preference that holds the typed date of [song]'s key. */
const bucketKey = (key: string) => `releaseDates.typed.${syncedBucket(key, TYPED_RELEASE_BUCKETS)}`;

test("a Library song's Release Date shows its date and keeps a typed one as the phone does", async () => {
  await withLibrary((db) => {
    const id = add(db, { title: "Road", artist: "Nick Drake", album: "Pink Moon", year: 1972 });
    const song = libraryReleaseSong(db, id)!;
    assert.deepEqual(releaseDateView(db, song), { title: "Road", date: "1972", typed: false });
    db.run(sql`UPDATE tracks SET release_date=${"1972-02-25"} WHERE id=${id}`);
    assert.equal(releaseDateView(db, libraryReleaseSong(db, id)!).date, "1972-02-25");

    assert.deepEqual(saveReleaseDate(db, song, fields("1971", "6"), TODAY, 1_000), { ok: true });
    assert.deepEqual(releaseDateView(db, libraryReleaseSong(db, id)!), {
      title: "Road",
      date: "1971-06",
      typed: true,
    });
    // In the index, as the phone writes it, and in the synced preference the phone reads.
    assert.equal(
      db.get<{ date: string }>(sql`SELECT release_date AS date FROM tracks WHERE id=${id}`)?.date,
      "1971-06",
    );
    const key = typedReleaseKey({ title: "Road", artist: "Nick Drake", album: "Pink Moon" });
    const stored = db.get<{ value: string }>(
      sql`SELECT value FROM desktop_synced_preferences WHERE key=${bucketKey(key)}`,
    )?.value;
    assert.deepEqual(JSON.parse(stored!), { [key]: "1971-06" });
    assert.ok(
      db.get(sql`SELECT 1 FROM preference_changes WHERE key=${bucketKey(key)} AND changed_at=1000`),
    );

    // Clearing it leaves the song with no date of its own until the scan or the lookup finds one.
    assert.deepEqual(saveReleaseDate(db, song, null, TODAY, 2_000), { ok: true });
    assert.deepEqual(releaseDateView(db, libraryReleaseSong(db, id)!), {
      title: "Road",
      date: "1972",
      typed: false,
    });
  });
});

test("Release Date takes a year, a month and year or a full date, and refuses anything else", async () => {
  await withLibrary((db) => {
    const id = add(db, { title: "Road", artist: "Nick Drake", album: "Pink Moon" });
    const song = libraryReleaseSong(db, id)!;
    for (const typed of [
      fields("72"),
      fields("1972", "13"),
      fields("1972", "2", "30"),
      fields("1972", "", "3"),
      fields("year"),
      fields("2027"),
    ])
      assert.deepEqual(saveReleaseDate(db, song, typed, TODAY, 1), {
        ok: false,
        problem: "impossible",
      });
    assert.deepEqual(saveReleaseDate(db, song, fields(""), TODAY, 1), {
      ok: false,
      problem: "empty",
    });
    assert.equal(releaseDateView(db, song).date, null);
    for (const [typed, date] of [
      [fields("1972"), "1972"],
      [fields("1972", "02"), "1972-02"],
      [fields("1972", "2", "25"), "1972-02-25"],
    ] as const) {
      assert.deepEqual(saveReleaseDate(db, song, typed, TODAY, 1), { ok: true });
      assert.equal(releaseDateView(db, song).date, date);
    }
  });
});

test("a streamed song keeps its typed date in the synced preference alone", async () => {
  await withLibrary((db) => {
    const song = streamedReleaseSong(db, parasite);
    assert.deepEqual(releaseDateView(db, song), { title: "Parasite", date: null, typed: false });
    assert.deepEqual(saveReleaseDate(db, song, fields("1972"), TODAY, 1), { ok: true });
    assert.deepEqual(releaseDateView(db, streamedReleaseSong(db, parasite)), {
      title: "Parasite",
      date: "1972",
      typed: true,
    });
  });
});

test("a playlist sorted by release date reads typed dates, a phone's too", async () => {
  await withLibrary((db) => {
    const later = add(db, { title: "Later", artist: "Zed", album: "One", year: 2001 });
    const typed = add(db, { title: "Typed", artist: "Zed", album: "Two", year: 2010 });
    const fromPhone = add(db, { title: "Phone", artist: "Zed", album: "Three", year: 2020 });
    const { playlistId: id } = createPlaylist(
      db,
      "Mixed",
      [
        { source: "library", trackId: later },
        { source: "stream", song: parasite },
        { source: "library", trackId: typed },
        { source: "library", trackId: fromPhone },
      ],
      0,
    );
    saveReleaseDate(db, libraryReleaseSong(db, typed)!, fields("1980"), TODAY, 1);
    saveReleaseDate(db, streamedReleaseSong(db, parasite), fields("1990"), TODAY, 1);
    // A date the phone typed arrives as its synced preference, the index untouched.
    const key = typedReleaseKey({ title: "Phone", artist: "Zed", album: "Three" });
    const stored = db.get<{ value: string }>(
      sql`SELECT value FROM desktop_synced_preferences WHERE key=${bucketKey(key)}`,
    )?.value;
    keepPreference(
      db,
      bucketKey(key),
      storedSyncedBucket({ ...readTypedReleaseDates(stored ?? null), [key]: "1970-01-01" }),
    );
    togglePlaylistSort(db, id, "releaseDate");
    const rows = browseLibrary(db, { kind: "playlist", id }, 0, 50).items;
    assert.deepEqual(
      rows.map((row) => [row.title, row.released]),
      [
        ["Phone", "1970-01-01"],
        ["Typed", "1980"],
        ["Parasite", "1990"],
        ["Later", "2001"],
      ],
    );
  });
});
