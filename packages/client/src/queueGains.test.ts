import assert from "node:assert/strict";
import { test } from "node:test";

import { EMPTY_QUEUE, gainTags, normalizeTrack, reduceQueue, type GainTagText } from "@wave/core";

import { creditSplits } from "./db/credits.ts";
import { saveMeasurement, selectSongsToMeasure } from "./db/loudness.ts";
import { saveBatch } from "./db/save.ts";
import { openTestDatabase } from "./db/testDatabase.ts";
import { trackQuery } from "./db/tracks.ts";
import type { IndexedTrack } from "./types.ts";
import { createQueueGains } from "./queueGains.ts";

type Db = Awaited<ReturnType<typeof openTestDatabase>>;

/** Saves songs of one album, each with the loudness tags given, and answers their ids. */
const album = (db: Db, songs: readonly [string, GainTagText][]): number[] => {
  const tracks = songs.map(([title, tags], n): IndexedTrack => ({
    ...normalizeTrack({
      path: `/Music/${title}.flac`,
      title,
      artist: "Portishead",
      album: "Dummy",
      trackNumber: String(n + 1),
      durationMs: 200_000,
    }),
    sizeBytes: 1_000,
    modifiedAt: 1,
    sampleRate: null,
    bitrateKbps: null,
    artworkHash: null,
    hasLyrics: false,
    explicit: "unknown",
    loudness: gainTags(tags),
  }));
  saveBatch(db, creditSplits(), tracks, [], [], 1_000);
  const rows = trackQuery(db).all();
  return songs.map(([title]) => rows.find((row) => row.title === title)!.id);
};

const albumIdOf = (db: Db, id: number) =>
  trackQuery(db)
    .all()
    .find((row) => row.id === id)!.albumId;

const playing = (ids: readonly number[], context: { kind: "album" | "songs"; id: string | null }) =>
  reduceQueue(EMPTY_QUEUE, { type: "play", trackIds: ids.map(String), context }).state;

test("a song plays at its tag's gain, and one with no value at the typical gain", async () => {
  const db = await openTestDatabase();
  const [tagged, plain] = album(db, [
    ["Mysterons", { replayGainTrackGain: "-7.5 dB", replayGainTrackPeak: "0.5" }],
    ["Sour Times", {}],
  ]);
  const gains = createQueueGains(db);
  const queue = playing([tagged!, plain!], { kind: "songs", id: null });
  assert.equal(
    gains.gainDb(queue, queue.entries[0]!),
    -3.5,
    "ReplayGain's -7.5 dB, raised to -14 LUFS",
  );
  assert.equal(gains.gainDb(queue, queue.entries[1]!), -5, "typical gain under 20 songs");
});

test("the typical gain is worked out again once a value changes", async () => {
  const db = await openTestDatabase();
  const ids = album(
    db,
    Array.from({ length: 21 }, (_, n): [string, GainTagText] => [
      `Song ${n}`,
      n === 0 ? {} : { replayGainTrackGain: "-6 dB", replayGainTrackPeak: "0.5" },
    ]),
  );
  const gains = createQueueGains(db);
  const queue = playing(ids, { kind: "songs", id: null });
  assert.equal(gains.gainDb(queue, queue.entries[0]!), -2, "the median of 20 tagged songs");
  const [song] = selectSongsToMeasure(db, [ids[0]!]);
  assert.ok(saveMeasurement(db, song!, { loudness: -20, peak: 0.25 }));
  assert.equal(gains.gainDb(queue, queue.entries[1]!), -2);
  gains.changed();
  assert.equal(gains.gainDb(queue, queue.entries[0]!), 6, "its own value now");
});

test("a measurement gives the song its own gain, and album gain covers the album in order", async () => {
  const db = await openTestDatabase();
  const [first, second] = album(db, [
    ["Strangers", {}],
    ["It Could Be Sweet", {}],
  ]);
  const gains = createQueueGains(db);
  for (const [id, loudness] of [
    [first!, -10],
    [second!, -18],
  ] as const) {
    const [song] = selectSongsToMeasure(db, [id]);
    assert.ok(saveMeasurement(db, song!, { loudness, peak: 0.25 }));
  }
  gains.changed();
  const songs = playing([first!, second!], { kind: "songs", id: null });
  assert.equal(gains.gainDb(songs, songs.entries[0]!), -4, "-14 LUFS minus -10");
  assert.equal(gains.gainDb(songs, songs.entries[1]!), 4);
  const whole = playing([first!, second!], { kind: "album", id: String(albumIdOf(db, first!)) });
  const albumGain = gains.gainDb(whole, whole.entries[0]!);
  assert.equal(gains.gainDb(whole, whole.entries[1]!), albumGain, "one gain for the whole album");
  assert.ok(albumGain > -4 && albumGain < 4, `album gain ${albumGain}`);
});
