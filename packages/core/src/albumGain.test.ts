import assert from "node:assert/strict";
import { test } from "node:test";
import {
  albumGain,
  entryGain,
  measureCandidates,
  songsToMeasure,
  reduceQueue,
  EMPTY_QUEUE,
  type AlbumLoudness,
  type GainSource,
  type SongGain,
} from "./index.ts";

const assertGain = (gain: SongGain | null, gainDb: number, source: GainSource): void => {
  assert.ok(gain !== null, "a gain");
  assert.equal(gain.source, source);
  assert.ok(Math.abs(gain.gainDb - gainDb) < 0.00001, `${gain.gainDb} dB, expected ${gainDb} dB`);
};

test("an album uses a shared album tag, capped by its highest peak", () => {
  assert.deepEqual(
    albumGain([
      { id: 1, durationMs: 10_000, trackGainDb: 8, trackPeak: 0.1, albumGainDb: 9, albumPeak: 0.5 },
      { id: 2, durationMs: 90_000, trackGainDb: 2, trackPeak: 0.4, albumGainDb: 9, albumPeak: 0.5 },
    ]),
    { gainDb: 6.020599913279624, source: "albumTag" },
  );
});

test("album energy is weighted by length using uncapped tags, measurements, or both", () => {
  // -24 LUFS for one second and -14 for three seconds: -15.10698 LUFS.
  for (const first of [
    { trackGainDb: 10, trackPeak: 1 },
    { measuredLoudness: -24, measuredPeak: 1 },
  ]) {
    const gain = albumGain([
      { id: 1, durationMs: 1_000, ...first },
      { id: 2, durationMs: 3_000, measuredLoudness: -14, measuredPeak: 0.5 },
    ]);
    // Highest peak 1 prevents a boost, even though the quieter song has headroom.
    assert.equal(gain?.source, "trackGainDb" in first ? "albumTagAndMeasured" : "albumMeasured");
    assert.ok(Math.abs(gain!.gainDb) < 0.00001);
    const down = albumGain([
      { id: 1, durationMs: 1_000, ...first, trackGainDb: 0, trackPeak: 0.2 },
      { id: 2, durationMs: 3_000, measuredLoudness: -4, measuredPeak: 0.5 },
    ]);
    assert.ok(Math.abs(down!.gainDb - -8.893017) < 0.00001);
  }
});

test("different album tags fall back to track energy and an unknown peak prevents boosting", () => {
  assert.deepEqual(
    albumGain([
      { id: 1, durationMs: 1_000, albumGainDb: -8, trackGainDb: 5, trackPeak: 0.2 },
      { id: 2, durationMs: 1_000, albumGainDb: -9, measuredLoudness: -19 },
    ]),
    { gainDb: 0, source: "albumTagAndMeasured" },
  );
});

test("one song without a value, or an empty album, cannot use album gain", () => {
  assert.equal(albumGain([]), null);
  assert.equal(
    albumGain([
      { id: 1, durationMs: 1_000, measuredLoudness: -10, measuredPeak: 1 },
      { id: 2, durationMs: 1_000 },
    ]),
    null,
  );
});

const album: AlbumLoudness = {
  id: "42",
  songs: [
    { id: 1, durationMs: 10_000, trackGainDb: 5, trackPeak: 0.1, albumGainDb: -4, albumPeak: 1 },
    { id: 2, durationMs: 90_000, trackGainDb: -5, trackPeak: 1, albumGainDb: -4, albumPeak: 1 },
  ],
};
const queue = (kind = "album", id = "42") =>
  reduceQueue(EMPTY_QUEUE, {
    type: "play",
    trackIds: ["1", "2"],
    startIndex: 0,
    context: { kind, id },
  }).state;

test("only the local album's context songs with shuffle off use album gain", () => {
  const state = queue();
  const entry = state.entries[0]!;
  const song = album.songs[0]!;
  assert.deepEqual(entryGain(state, entry, song, album), { gainDb: -4, source: "albumTag" });
  for (const other of [
    queue("playlist"),
    queue("magic"),
    queue("ytAlbum"),
    queue("album", "43"),
    { ...state, shuffle: true },
  ]) {
    assert.deepEqual(entryGain(other, entry, song, album), { gainDb: 5, source: "tag" });
  }
  assert.equal(entryGain(state, { ...entry, contextIndex: null }, song, album)?.source, "tag");
  assert.equal(entryGain(state, { ...entry, trackId: "3" }, song, album)?.source, "tag");
});

test("an incomplete album uses track gains until completion; its next start can use album gain", () => {
  const state = queue();
  const incomplete = { ...album, songs: [album.songs[0]!, { id: 2, durationMs: 90_000 }] };
  assert.equal(entryGain(state, state.entries[0]!, album.songs[0]!, incomplete)?.source, "tag");
  assert.equal(entryGain(state, state.entries[1]!, {}, incomplete), null);
  // The returned value is a start decision. The gain stage holds the old value while it plays.
  assert.equal(entryGain(state, state.entries[1]!, album.songs[1]!, album)?.source, "albumTag");
});

test("an album's songs come right after the current song, ahead of the next five, once each", () => {
  const state = {
    ...queue(),
    entries: [...queue().entries, { key: "hand", trackId: "9", contextIndex: null }],
  };
  const full = {
    ...album,
    songs: [...album.songs, ...[3, 4, 5, 6, 7, 8].map((id) => ({ id, durationMs: 1_000 }))],
  };
  const all = () => true;
  assert.deepEqual(songsToMeasure(state, all, full), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  assert.deepEqual(measureCandidates(state, full), [1, 2, 3, 4, 5, 6, 7, 8, 9]);
  // Album songs with a value aren't measured, and the current song still goes first.
  const playing2 = { ...state, index: 1 };
  assert.deepEqual(
    songsToMeasure(playing2, (id) => id !== 3 && id !== 4, full),
    [2, 1, 5, 6, 7, 8, 9],
  );
});

test("the album's songs get no head start when album gain can't apply", () => {
  const state = {
    ...queue(),
    entries: [...queue().entries, { key: "hand", trackId: "9", contextIndex: null }],
  };
  const full = {
    ...album,
    songs: [...album.songs, ...[3, 4].map((id) => ({ id, durationMs: 1_000 }))],
  };
  const all = () => true;
  for (const other of [
    { ...state, context: { kind: "playlist" as const, id: "42" } },
    { ...state, shuffle: true },
  ]) {
    assert.deepEqual(songsToMeasure(other, all, full), [1, 2, 9]);
    assert.deepEqual(measureCandidates(other, full), [1, 2, 9]);
  }
});

test("missing and unmeasurable songs don't hold an album back, nor count in its loudness or peak", () => {
  const songs = [
    { id: 1, durationMs: 1_000, measuredLoudness: -20, measuredPeak: 0.25 },
    { id: 2, durationMs: 1_000, missing: true },
    { id: 3, durationMs: 1_000, unmeasurable: true },
  ];
  // -20 LUFS wants +6 dB; the one counted peak (0.25) allows 12 dB.
  const gain = albumGain(songs)!;
  assert.equal(gain.source, "albumMeasured");
  assert.ok(Math.abs(gain.gainDb - 6) < 0.00001);
  // A shared album tag is shared by the songs that count.
  assert.deepEqual(
    albumGain([
      { id: 1, durationMs: 1_000, trackGainDb: 1, trackPeak: 0.5, albumGainDb: 2, albumPeak: 0.5 },
      { id: 2, durationMs: 1_000, missing: true },
      { id: 3, durationMs: 1_000, unmeasurable: true },
    ]),
    { gainDb: 2, source: "albumTag" },
  );
  assert.equal(
    albumGain([
      { id: 2, durationMs: 1_000, missing: true },
      { id: 3, durationMs: 1_000, unmeasurable: true },
    ]),
    null,
  );
});

test("an unmeasurable song in an album queue plays at the album gain, never boosted", () => {
  const quiet: AlbumLoudness = {
    id: "42",
    songs: [
      { id: 1, durationMs: 1_000, measuredLoudness: -20, measuredPeak: 0.25 },
      { id: 2, durationMs: 1_000, unmeasurable: true },
    ],
  };
  const state = queue();
  assertGain(entryGain(state, state.entries[0]!, quiet.songs[0]!, quiet), 6, "albumMeasured");
  assertGain(entryGain(state, state.entries[1]!, {}, quiet), 0, "albumMeasured");
  const loud: AlbumLoudness = {
    ...quiet,
    songs: [{ ...quiet.songs[0]!, measuredLoudness: -8 }, quiet.songs[1]!],
  };
  assertGain(entryGain(state, state.entries[1]!, {}, loud), -6, "albumMeasured");
});

test("tagged, measured and mixed albums use the same duration-weighted energy", () => {
  const tagged = [
    { id: 1, durationMs: 1_000, trackGainDb: 0, trackPeak: 0.2 },
    { id: 2, durationMs: 3_000, trackGainDb: -10, trackPeak: 0.5 },
  ];
  const measured = [
    { id: 1, durationMs: 1_000, measuredLoudness: -14, measuredPeak: 0.2 },
    { id: 2, durationMs: 3_000, measuredLoudness: -4, measuredPeak: 0.5 },
  ];
  for (const [songs, source] of [
    [tagged, "albumTag"],
    [measured, "albumMeasured"],
    [[tagged[0]!, measured[1]!], "albumTagAndMeasured"],
  ] as const) {
    const gain = albumGain(songs)!;
    assert.equal(gain.source, source);
    assert.ok(Math.abs(gain.gainDb - -8.893017) < 0.00001);
  }
});

test("combined album gain can boost only up to the loudest song's peak", () => {
  const gain = albumGain([
    { id: 1, durationMs: 1_000, measuredLoudness: -30, measuredPeak: 0.01 },
    { id: 2, durationMs: 1_000, measuredLoudness: -24, measuredPeak: 0.5 },
  ])!;
  assert.ok(Math.abs(gain.gainDb - 6.0206) < 0.00001);
});

test("a shared album tag cannot boost beyond a known higher song peak", () => {
  const gain = albumGain([
    { id: 1, durationMs: 1_000, trackGainDb: 10, trackPeak: 0.8, albumGainDb: 8, albumPeak: 0.1 },
    { id: 2, durationMs: 1_000, trackGainDb: 10, trackPeak: 0.2, albumGainDb: 8, albumPeak: 0.1 },
  ])!;
  assert.ok(Math.abs(gain.gainDb - 1.9382) < 0.00001);
});
