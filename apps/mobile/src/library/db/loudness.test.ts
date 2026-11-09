/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { gainTags, normalizeTrack, typicalGain, type GainTagText } from "@wave/core";

import type { IndexedTrack } from "../LibraryStore.ts";
import { creditSplits } from "./credits.ts";
import { selectLibraryGains, selectSongLoudness } from "./loudness.ts";
import { saveBatch } from "./save.ts";
import * as schema from "./schema.ts";
import { addTrack, migrateTestDatabase, openTestDatabase } from "./testDatabase.ts";
import { selectKnownFiles, trackQuery } from "./tracks.ts";

/** A file as the scanner reads it, with the loudness tags [tags]. */
const scanned = (title: string, tags: GainTagText = {}): IndexedTrack => ({
  ...normalizeTrack({
    path: `/Music/${title}.flac`,
    title,
    artist: "Massive Attack",
    durationMs: 1,
  }),
  sizeBytes: 1_000,
  modifiedAt: 1,
  sampleRate: null,
  bitrateKbps: null,
  artworkHash: null,
  hasLyrics: false,
  explicit: "unknown",
  loudness: gainTags(tags),
});

type Db = Awaited<ReturnType<typeof openTestDatabase>>;

const save = (db: Db, tracks: readonly IndexedTrack[]) =>
  saveBatch(db, creditSplits(), tracks, [], [], 1_000);

const idOf = (db: Db, title: string): number => {
  const row = trackQuery(db)
    .all()
    .find((song) => song.title === title);
  assert.ok(row, title);
  return row.id;
};

describe("selectSongLoudness", () => {
  test("keeps what a song's ReplayGain tags say, gain at -14 LUFS and peak", async () => {
    const db = await openTestDatabase();
    save(db, [
      scanned("Teardrop", {
        replayGainTrackGain: "-6.54 dB",
        replayGainTrackPeak: "0.988553",
        replayGainAlbumGain: "-7.10 dB",
        replayGainAlbumPeak: "1.023",
      }),
      scanned("Untagged"),
    ]);
    const teardrop = idOf(db, "Teardrop");
    const untagged = idOf(db, "Untagged");
    const loudness = selectSongLoudness(db, [teardrop, untagged, 999]);
    assert.deepEqual([...loudness.keys()], [teardrop]);
    assert.ok(Math.abs((loudness.get(teardrop)?.trackGainDb ?? 0) - -2.54) < 1e-9);
    assert.equal(loudness.get(teardrop)?.trackPeak, 0.988553);
    // The album values are kept for album gain.
    const row = db
      .select()
      .from(schema.tracks)
      .all()
      .find((song) => song.id === teardrop);
    assert.ok(Math.abs((row?.tagAlbumGain ?? 0) - -3.1) < 1e-9);
    assert.equal(row?.tagAlbumPeak, 1.023);
  });

  test("a rescan of the file without its tags drops them, and one with new tags takes them", async () => {
    const db = await openTestDatabase();
    save(db, [scanned("Teardrop", { replayGainTrackGain: "-6.54 dB" })]);
    const id = idOf(db, "Teardrop");
    save(db, [scanned("Teardrop")]);
    assert.deepEqual(selectSongLoudness(db, [id]), new Map());
    save(db, [scanned("Teardrop", { r128TrackGain: "-1536" })]);
    assert.deepEqual(
      selectSongLoudness(db, [id]),
      new Map([[id, { trackGainDb: 3, trackPeak: null }]]),
    );
  });

  test("a song indexed before Wave read loudness tags is read again by the next scan", async () => {
    const old = await openTestDatabase({ through: "0056_playlist_entries_outlive_songs" });
    const id = addTrack(old, { title: "Airbag", album: "OK Computer", addedAt: 1_234 });
    await migrateTestDatabase(old);
    const [known] = selectKnownFiles(old, ["/Music"]);
    assert.equal(known?.path, "/Music/OK Computer/Airbag.mp3");
    // Not the file's modification time: the scan sees it as changed and reads it.
    assert.notEqual(known?.modifiedAt, 1_234);
    assert.deepEqual(selectSongLoudness(old, [id]), new Map());
  });
});

describe("selectLibraryGains", () => {
  test("gives the gain each Library song with a value plays at, its peak cap applied", async () => {
    const db = await openTestDatabase();
    save(db, [
      scanned("Quiet", { replayGainTrackGain: "+5.00 dB", replayGainTrackPeak: "0.5" }),
      scanned("No peak", { replayGainTrackGain: "+1.00 dB" }),
      scanned("Loud", { replayGainTrackGain: "-10.00 dB", replayGainTrackPeak: "1.0" }),
      scanned("Untagged"),
    ]);
    const gains = selectLibraryGains(db).sort((a, b) => a - b);
    assert.equal(gains.length, 3);
    assert.equal(gains[0], -6);
    // Without a peak, +5 dB at -14 LUFS only turns down: 0 dB.
    assert.equal(gains[1], 0);
    // +9 dB at -14 LUFS, capped by the 0.5 peak's 6.02 dB.
    assert.ok(Math.abs((gains[2] ?? 0) - 6.0206) < 0.001);
  });

  test("the typical gain stays at -5 dB until 20 songs have a value", async () => {
    const db = await openTestDatabase();
    const tagged = (count: number, from = 0) =>
      Array.from({ length: count }, (_, index) =>
        scanned(`Song ${from + index}`, {
          replayGainTrackGain: "-12 dB",
          replayGainTrackPeak: "1",
        }),
      );
    save(db, tagged(19));
    assert.equal(typicalGain(selectLibraryGains(db)), -5);
    save(db, tagged(1, 19));
    assert.equal(typicalGain(selectLibraryGains(db)), -8);
  });
});
