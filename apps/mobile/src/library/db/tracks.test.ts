/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { normalizeTrack, type ExplicitFlag } from "@wave/core";

import type { IndexedTrack } from "../LibraryStore.ts";
import { creditSplits } from "./credits.ts";
import { saveBatch } from "./save.ts";
import { selectKnownFiles, selectLibraryLookupSongs, trackQuery } from "./tracks.ts";
import { addTrack, migrateTestDatabase, openTestDatabase } from "./testDatabase.ts";

/** A file as the scanner reads it, with the flag its advisory tag gives. */
const scanned = (title: string, explicit: ExplicitFlag): IndexedTrack => ({
  ...normalizeTrack({
    path: `/Music/${title}.m4a`,
    title,
    artist: "Kendrick Lamar",
    durationMs: 1,
  }),
  sizeBytes: 1_000,
  modifiedAt: 0,
  sampleRate: null,
  bitrateKbps: null,
  artworkHash: null,
  hasLyrics: false,
  explicit,
});

const explicitByTitle = (db: Awaited<ReturnType<typeof openTestDatabase>>) =>
  Object.fromEntries(
    trackQuery(db)
      .all()
      .map(({ title, explicit }) => [title, explicit]),
  );

describe("selectLibraryLookupSongs", () => {
  test("lists every song with what a lookup sends and the tags it may lack", async () => {
    const db = await openTestDatabase();
    addTrack(db, {
      title: "Teardrop",
      artist: "Massive Attack",
      album: "Mezzanine",
      durationMs: 330_000,
      genre: "Trip-Hop",
      hasLyrics: true,
      trackNumber: 3,
      year: 1998,
      explicit: "clean",
    });
    addTrack(db, { title: "Airbag", artist: "Radiohead", album: "OK Computer" });
    assert.deepEqual(selectLibraryLookupSongs(db), [
      {
        path: "/Music/OK Computer/Airbag.mp3",
        title: "Airbag",
        artist: "Radiohead",
        album: "OK Computer",
        durationMs: 180_000,
        genre: null,
        hasLyrics: false,
        trackNumber: null,
        year: null,
        explicit: "unknown",
      },
      {
        path: "/Music/Mezzanine/Teardrop.mp3",
        title: "Teardrop",
        artist: "Massive Attack",
        album: "Mezzanine",
        durationMs: 330_000,
        genre: "Trip-Hop",
        hasLyrics: true,
        trackNumber: 3,
        year: 1998,
        explicit: "clean",
      },
    ]);
  });
});

describe("trackQuery", () => {
  test("song rows carry the genre and lyrics Fix Song looks at", async () => {
    const db = await openTestDatabase();
    addTrack(db, { title: "Teardrop", genre: "Trip-Hop", hasLyrics: true });
    addTrack(db, { title: "Airbag" });
    const rows = trackQuery(db)
      .all()
      .map(({ title, genre, hasLyrics }) => ({ title, genre, hasLyrics }))
      .toSorted((a, b) => a.title.localeCompare(b.title));
    assert.deepEqual(rows, [
      { title: "Airbag", genre: null, hasLyrics: false },
      { title: "Teardrop", genre: "Trip-Hop", hasLyrics: true },
    ]);
  });
});

describe("explicit songs", () => {
  test("song rows carry the flag a scan read from each file's advisory tag", async () => {
    const db = await openTestDatabase();
    saveBatch(
      db,
      creditSplits(),
      [scanned("HUMBLE.", "explicit"), scanned("LOVE.", "clean"), scanned("DNA.", "unknown")],
      [],
      [],
      0,
    );
    assert.deepEqual(explicitByTitle(db), {
      "HUMBLE.": "explicit",
      "LOVE.": "clean",
      "DNA.": "unknown",
    });
  });

  test("a rescan takes the flag the file has now", async () => {
    const db = await openTestDatabase();
    saveBatch(db, creditSplits(), [scanned("HUMBLE.", "unknown")], [], [], 0);
    saveBatch(db, creditSplits(), [scanned("HUMBLE.", "explicit")], [], [], 0);
    assert.deepEqual(explicitByTitle(db), { "HUMBLE.": "explicit" });
  });
});

describe("selectKnownFiles", () => {
  test("gives an incremental scan the indexed files under the roots", async () => {
    const db = await openTestDatabase();
    addTrack(db, { title: "Airbag", album: "OK Computer", addedAt: 1_234 });
    assert.deepEqual(selectKnownFiles(db, ["/Music"]), [
      { path: "/Music/OK Computer/Airbag.mp3", sizeBytes: 1_000, modifiedAt: 1_234 },
    ]);
    assert.deepEqual(selectKnownFiles(db, ["/Other"]), []);
  });

  test("a song indexed before Wave recorded lyrics is read again by the next scan", async () => {
    const old = await openTestDatabase({ through: "0010_play_credits" });
    addTrack(old, { title: "Airbag", album: "OK Computer", genre: "Rock", addedAt: 1_234 });
    await migrateTestDatabase(old);
    const [known] = selectKnownFiles(old, ["/Music"]);
    assert.equal(known?.path, "/Music/OK Computer/Airbag.mp3");
    // Not the file's modification time: the scan sees it as changed and reads it.
    assert.notEqual(known?.modifiedAt, 1_234);
    assert.equal(selectLibraryLookupSongs(old)[0]?.hasLyrics, false);
  });

  test("a song indexed before Wave read advisory tags is read again by the next scan, unknown until then", async () => {
    const old = await openTestDatabase({ through: "0025_unsearched_titles" });
    addTrack(old, { title: "Airbag", album: "OK Computer", addedAt: 1_234 });
    await migrateTestDatabase(old);
    const [known] = selectKnownFiles(old, ["/Music"]);
    assert.equal(known?.path, "/Music/OK Computer/Airbag.mp3");
    assert.notEqual(known?.modifiedAt, 1_234);
    assert.deepEqual(explicitByTitle(old), { Airbag: "unknown" });
  });

  test("a song indexed before Wave read every value of an artist tag is read again by the next scan", async () => {
    const old = await openTestDatabase({ through: "0014_yt_artists" });
    addTrack(old, { title: "boyfriend", artist: "Ariana Grande, Social House", addedAt: 1_234 });
    await migrateTestDatabase(old);
    const [known] = selectKnownFiles(old, ["/Music"]);
    assert.equal(known?.path, "/Music/boyfriend (single)/boyfriend.mp3");
    assert.notEqual(known?.modifiedAt, 1_234);
  });
});
