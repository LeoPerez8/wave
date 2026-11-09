/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { gainTags, normalizeTrack, typicalGain, type GainTagText } from "@wave/core";
import { eq } from "drizzle-orm";

import type { IndexedTrack } from "../LibraryStore.ts";
import { creditSplits } from "./credits.ts";
import {
  saveMeasurement,
  saveMeasurements,
  selectLibraryGains,
  selectLibraryToMeasure,
  selectSongLoudness,
  selectSongsToMeasure,
  type SongToMeasure,
} from "./loudness.ts";
import { replaceTrackFile } from "./qualityReplacement.ts";
import { saveBatch } from "./save.ts";
import * as schema from "./schema.ts";
import { addMissingSong, addTrack, migrateTestDatabase, openTestDatabase } from "./testDatabase.ts";
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

/** The one song among [ids] Wave would measure now. */
const toMeasure = (db: Db, id: number): SongToMeasure => {
  const [song] = selectSongsToMeasure(db, [id]);
  assert.ok(song, "a song to measure");
  return song;
};

describe("measurements", () => {
  test("a file without tags is measured, and its loudness and peak become its value", async () => {
    const db = await openTestDatabase();
    save(db, [scanned("Measured")]);
    const id = idOf(db, "Measured");
    const song = toMeasure(db, id);
    assert.deepEqual(song, { id, path: "/Music/Measured.flac", sizeBytes: 1_000, modifiedAt: 1 });
    assert.equal(saveMeasurement(db, song, { loudness: -8, peak: 0.9 }), true);
    assert.deepEqual(
      selectSongLoudness(db, [id]),
      new Map([[id, { measuredLoudness: -8, measuredPeak: 0.9 }]]),
    );
    assert.deepEqual(selectLibraryGains(db), [-6]);
    assert.deepEqual(selectSongsToMeasure(db, [id]), []);
  });

  test("gives the songs to measure in the order asked, leaving out tagged, measured and missing ones", async () => {
    const db = await openTestDatabase();
    save(db, [
      scanned("A"),
      scanned("B"),
      scanned("Tagged", { replayGainTrackGain: "-3 dB" }),
      scanned("Done"),
    ]);
    const [a, b, tagged, done] = ["A", "B", "Tagged", "Done"].map((title) => idOf(db, title));
    saveMeasurement(db, toMeasure(db, done!), { loudness: -10, peak: 1 });
    const missing = addMissingSong(db, { title: "Missing" });
    assert.deepEqual(
      selectSongsToMeasure(db, [b!, tagged!, missing, done!, a!, 999]).map((song) => song.id),
      [b, a],
    );
  });

  test("a rescan that sees the file's size or modified time change drops its value, and the file is measured again", async () => {
    const db = await openTestDatabase();
    save(db, [scanned("Resized"), scanned("Touched")]);
    const resized = idOf(db, "Resized");
    const touched = idOf(db, "Touched");
    saveMeasurement(db, toMeasure(db, resized), { loudness: -8, peak: 1 });
    saveMeasurement(db, toMeasure(db, touched), { loudness: -8, peak: 1 });
    save(db, [
      { ...scanned("Resized"), sizeBytes: 2_000 },
      { ...scanned("Touched"), modifiedAt: 2 },
    ]);
    assert.deepEqual(selectSongLoudness(db, [resized, touched]), new Map());
    assert.equal(toMeasure(db, resized).sizeBytes, 2_000);
    assert.equal(toMeasure(db, touched).modifiedAt, 2);
  });

  test("a rescan of the unchanged file keeps its value, also after a migration asked for every file to be read again", async () => {
    const db = await openTestDatabase();
    save(db, [scanned("Kept")]);
    const id = idOf(db, "Kept");
    saveMeasurement(db, toMeasure(db, id), { loudness: -8, peak: 1 });
    save(db, [scanned("Kept")]);
    assert.equal(selectSongLoudness(db, [id]).get(id)?.measuredLoudness, -8);
    // The re-read sentinel a migration sets (as 0057_loudness_tags does).
    db.update(schema.tracks).set({ modifiedAt: 0 }).run();
    assert.equal(selectSongLoudness(db, [id]).get(id)?.measuredLoudness, -8);
    save(db, [scanned("Kept")]);
    assert.equal(selectSongLoudness(db, [id]).get(id)?.measuredLoudness, -8);
  });

  test("a file waiting for the scan to read it again isn't measured until it has", async () => {
    const db = await openTestDatabase();
    save(db, [scanned("Unread")]);
    const id = idOf(db, "Unread");
    db.update(schema.tracks).set({ modifiedAt: 0 }).run();
    assert.deepEqual(selectSongsToMeasure(db, [id]), []);
    save(db, [scanned("Unread")]);
    assert.equal(toMeasure(db, id).modifiedAt, 1);
  });

  test("a file Wave couldn't measure has no value, and isn't tried again until it changes", async () => {
    const db = await openTestDatabase();
    save(db, [scanned("Broken")]);
    const id = idOf(db, "Broken");
    assert.equal(saveMeasurement(db, toMeasure(db, id), null), true);
    assert.deepEqual(selectSongLoudness(db, [id]), new Map());
    assert.deepEqual(selectLibraryGains(db), []);
    assert.deepEqual(selectSongsToMeasure(db, [id]), []);
    save(db, [scanned("Broken")]);
    assert.deepEqual(selectSongsToMeasure(db, [id]), []);
    save(db, [{ ...scanned("Broken"), modifiedAt: 2 }]);
    assert.equal(toMeasure(db, id).modifiedAt, 2);
  });

  test("a measurement of a file that changed while it was measured is dropped", async () => {
    const db = await openTestDatabase();
    save(db, [scanned("Changing")]);
    const id = idOf(db, "Changing");
    const song = toMeasure(db, id);
    save(db, [{ ...scanned("Changing"), sizeBytes: 2_000, modifiedAt: 2 }]);
    assert.equal(saveMeasurement(db, song, { loudness: -8, peak: 1 }), false);
    assert.deepEqual(selectSongLoudness(db, [id]), new Map());
    assert.equal(toMeasure(db, id).sizeBytes, 2_000);
  });

  test("a quality replacement drops the old file's value, and the new file is measured", async () => {
    const db = await openTestDatabase();
    save(db, [scanned("Replaced")]);
    const id = idOf(db, "Replaced");
    saveMeasurement(db, toMeasure(db, id), { loudness: -8, peak: 1 });
    const better = { ...scanned("Replaced"), path: "/Music/Replaced.opus", sizeBytes: 4_000 };
    replaceTrackFile(db, creditSplits(), id, better, [], 2_000);
    assert.deepEqual(selectSongLoudness(db, [id]), new Map());
    assert.deepEqual(toMeasure(db, id), {
      id,
      path: "/Music/Replaced.opus",
      sizeBytes: 4_000,
      modifiedAt: 1,
    });
  });

  test("tags a file gets later win over its measurement, and a tagged file's measurement isn't kept", async () => {
    const db = await openTestDatabase();
    save(db, [scanned("Retagged"), scanned("Tagged meanwhile")]);
    const retagged = idOf(db, "Retagged");
    const meanwhile = idOf(db, "Tagged meanwhile");
    saveMeasurement(db, toMeasure(db, retagged), { loudness: -8, peak: 1 });
    const song = toMeasure(db, meanwhile);
    save(db, [
      { ...scanned("Retagged", { replayGainTrackGain: "-3 dB" }), modifiedAt: 2 },
      scanned("Tagged meanwhile", { replayGainTrackGain: "-5 dB" }),
    ]);
    assert.equal(saveMeasurement(db, song, { loudness: -8, peak: 1 }), false);
    assert.deepEqual(
      selectSongLoudness(db, [retagged, meanwhile]),
      new Map([
        [retagged, { trackGainDb: 1, trackPeak: null }],
        [meanwhile, { trackGainDb: -1, trackPeak: null }],
      ]),
    );
  });

  test("a song indexed before Wave measured songs is measured once the scan has read it", async () => {
    const old = await openTestDatabase({ through: "0057_loudness_tags" });
    const id = addTrack(old, { title: "Airbag", album: "OK Computer", addedAt: 1_234 });
    await migrateTestDatabase(old);
    assert.deepEqual(selectSongLoudness(old, [id]), new Map());
    assert.deepEqual(
      selectSongsToMeasure(old, [id]).map((song) => song.id),
      [id],
    );
  });
});

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

describe("the charging job's songs", () => {
  test("lists every Library file to measure, oldest first, leaving out tagged, measured, missing and unread ones", async () => {
    const db = await openTestDatabase();
    save(db, [
      scanned("A"),
      scanned("Tagged", { replayGainTrackGain: "-3 dB" }),
      scanned("Done"),
      scanned("B"),
    ]);
    const [a, done, b] = ["A", "Done", "B"].map((title) => idOf(db, title));
    saveMeasurement(db, toMeasure(db, done!), { loudness: -10, peak: 1 });
    addMissingSong(db, { title: "Missing" });
    save(db, [scanned("Unread")]);
    db.update(schema.tracks)
      .set({ modifiedAt: 0 })
      .where(eq(schema.tracks.id, idOf(db, "Unread")))
      .run();
    assert.deepEqual(selectLibraryToMeasure(db), [
      { id: a, path: "/Music/A.flac", sizeBytes: 1_000, modifiedAt: 1 },
      { id: b, path: "/Music/B.flac", sizeBytes: 1_000, modifiedAt: 1 },
    ]);
  });

  test("keeps what the job measured in one go, and drops what it measured of a file that changed since", async () => {
    const db = await openTestDatabase();
    save(db, [scanned("A"), scanned("Changed"), scanned("Broken")]);
    const [a, changed, broken] = selectLibraryToMeasure(db);
    save(db, [{ ...scanned("Changed"), sizeBytes: 2_000 }]);
    assert.deepEqual(
      saveMeasurements(db, [
        { song: a!, measurement: { loudness: -8, peak: 0.9 } },
        { song: changed!, measurement: { loudness: -9, peak: 1 } },
        { song: broken!, measurement: null },
      ]),
      [a!.id, broken!.id],
    );
    assert.deepEqual(
      selectSongLoudness(db, [a!.id, changed!.id, broken!.id]),
      new Map([[a!.id, { measuredLoudness: -8, measuredPeak: 0.9 }]]),
    );
    assert.deepEqual(selectLibraryToMeasure(db), [{ ...changed!, sizeBytes: 2_000 }]);
  });
});
