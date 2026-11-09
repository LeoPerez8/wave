import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EMPTY_QUEUE,
  gainTags,
  knownGain,
  measureCandidates,
  readNormalizeVolume,
  reduceQueue,
  songGain,
  songsToMeasure,
  typicalGain,
  writeNormalizeVolume,
  ytTrackId,
  type QueueState,
  type SongGain,
} from "./index.ts";

/** [actual] within 0.001 dB of [expected], with the same source. */
const assertGain = (actual: SongGain | null, expected: SongGain): void => {
  assert.ok(actual !== null, "a gain");
  assert.equal(actual.source, expected.source);
  assert.ok(
    Math.abs(actual.gainDb - expected.gainDb) < 0.001,
    `${actual.gainDb} dB, expected ${expected.gainDb} dB`,
  );
};

/** [actual] within 0.001 of [expected], or both null. */
const assertNear = (actual: number | null, expected: number | null): void => {
  if (expected === null || actual === null) {
    assert.equal(actual, expected);
    return;
  }
  assert.ok(Math.abs(actual - expected) < 0.001, `${actual}, expected ${expected}`);
};

describe("readNormalizeVolume", () => {
  test("on when nothing is stored", () => {
    assert.equal(readNormalizeVolume(null), true);
  });

  test("off once the owner turned it off, and on again after", () => {
    assert.equal(readNormalizeVolume(writeNormalizeVolume(false)), false);
    assert.equal(readNormalizeVolume(writeNormalizeVolume(true)), true);
  });

  test("anything else stored reads as on", () => {
    assert.equal(readNormalizeVolume("maybe"), true);
  });
});

describe("songGain", () => {
  test("a streamed song louder than YouTube's reference is turned down by YouTube's value", () => {
    assert.deepEqual(songGain(true, { youtubeLoudnessDb: 6.23 }), {
      gainDb: -6.23,
      source: "youtube",
    });
  });

  test("a streamed song quieter than YouTube's reference is never turned up, as YouTube gives no peak", () => {
    assert.deepEqual(songGain(true, { youtubeLoudnessDb: -3.5 }), { gainDb: 0, source: "youtube" });
  });

  test("a streamed song right at YouTube's reference plays as it is", () => {
    assert.deepEqual(songGain(true, { youtubeLoudnessDb: 0 }), { gainDb: 0, source: "youtube" });
  });

  test("a song Wave knows nothing about plays at the typical gain's starting value, -5 dB", () => {
    assert.deepEqual(songGain(true, {}), { gainDb: -5, source: "typical" });
    assert.deepEqual(songGain(true, { youtubeLoudnessDb: null }), {
      gainDb: -5,
      source: "typical",
    });
  });

  test("a value YouTube didn't really give counts as nothing known", () => {
    assert.deepEqual(songGain(true, { youtubeLoudnessDb: Number.NaN }), {
      gainDb: -5,
      source: "typical",
    });
  });

  test("with the switch off every song plays as it is", () => {
    assert.deepEqual(songGain(false, { youtubeLoudnessDb: 6.23 }), { gainDb: 0, source: "off" });
    assert.deepEqual(songGain(false, {}), { gainDb: 0, source: "off" });
  });
});

describe("gainTags", () => {
  test("a ReplayGain tag's gain, at -18 LUFS, is 4 dB more at -14", () => {
    const tags = gainTags({ replayGainTrackGain: "-6.54 dB", replayGainTrackPeak: "0.988553" });
    assertNear(tags.trackGainDb, -2.54);
    assertNear(tags.trackPeak, 0.988553);
  });

  test("reads a gain without the unit, with a comma decimal, a plus sign or a lowercase unit", () => {
    assertNear(gainTags({ replayGainTrackGain: "-6.54" }).trackGainDb, -2.54);
    assertNear(gainTags({ replayGainTrackGain: "-6,54 dB" }).trackGainDb, -2.54);
    assertNear(gainTags({ replayGainTrackGain: "+1.20 dB" }).trackGainDb, 5.2);
    assertNear(gainTags({ replayGainTrackGain: " -3.5db " }).trackGainDb, 0.5);
    assertNear(gainTags({ replayGainTrackPeak: "0,5" }).trackPeak, 0.5);
  });

  test("a value that isn't a number is no value", () => {
    const tags = gainTags({
      replayGainTrackGain: "loud",
      replayGainTrackPeak: "high",
      replayGainAlbumGain: "",
      r128TrackGain: "-3.5",
    });
    assert.deepEqual(tags, {
      trackGainDb: null,
      trackPeak: null,
      albumGainDb: null,
      albumPeak: null,
    });
  });

  test("a peak of zero or less says nothing of the song's peak", () => {
    assert.equal(gainTags({ replayGainTrackPeak: "0.000000" }).trackPeak, null);
    assert.equal(gainTags({ replayGainTrackPeak: "-1" }).trackPeak, null);
  });

  test("an Opus file's R128 gain, Q7.8 dB at -23 LUFS, is value/256 + 9 dB at -14", () => {
    const tags = gainTags({ r128TrackGain: "-1536", r128AlbumGain: "+256" });
    assertNear(tags.trackGainDb, 3);
    assertNear(tags.albumGainDb, 10);
    // R128 gives no peak.
    assert.equal(tags.trackPeak, null);
    assert.equal(tags.albumPeak, null);
  });

  test("an R128 value outside Q7.8's range is no value", () => {
    assert.equal(gainTags({ r128TrackGain: "40000" }).trackGainDb, null);
  });

  test("R128 wins over a ReplayGain tag in the same file", () => {
    const tags = gainTags({
      r128TrackGain: "0",
      replayGainTrackGain: "-6.54 dB",
      replayGainTrackPeak: "0.9",
    });
    assertNear(tags.trackGainDb, 9);
    assert.equal(tags.trackPeak, null);
  });

  test("album values are read as the track's", () => {
    const tags = gainTags({ replayGainAlbumGain: "-7.10 dB", replayGainAlbumPeak: "1.023" });
    assertNear(tags.albumGainDb, -3.1);
    assertNear(tags.albumPeak, 1.023);
    assert.equal(tags.trackGainDb, null);
  });

  test("a file without tags has no values", () => {
    assert.deepEqual(gainTags({}), {
      trackGainDb: null,
      trackPeak: null,
      albumGainDb: null,
      albumPeak: null,
    });
  });
});

describe("knownGain", () => {
  test("a measured song plays at -14 LUFS minus its loudness, boosted only as far as its peak allows", () => {
    assertGain(knownGain({ measuredLoudness: -8, measuredPeak: 1 }), {
      gainDb: -6,
      source: "measured",
    });
    // -23 LUFS wants +9 dB; a 0.5 peak allows 6.02 dB.
    assertGain(knownGain({ measuredLoudness: -23, measuredPeak: 0.5 }), {
      gainDb: 6.0206,
      source: "measured",
    });
  });

  test("a measurement without a peak only turns a song down", () => {
    assertGain(knownGain({ measuredLoudness: -20, measuredPeak: null }), {
      gainDb: 0,
      source: "measured",
    });
  });

  test("tags win over a measurement, and a measurement over YouTube's value", () => {
    assertGain(knownGain({ trackGainDb: -2, measuredLoudness: -6, measuredPeak: 1 }), {
      gainDb: -2,
      source: "tag",
    });
    assertGain(knownGain({ measuredLoudness: -10, measuredPeak: 1, youtubeLoudnessDb: 3 }), {
      gainDb: -4,
      source: "measured",
    });
  });

  test("a file Wave couldn't measure has no value of its own", () => {
    assert.equal(knownGain({ measuredLoudness: null, measuredPeak: null }), null);
    assert.equal(knownGain({ measuredLoudness: Number.NaN, measuredPeak: 1 }), null);
  });

  test("a tagged song plays at its tag's gain when its peak allows it", () => {
    assertGain(knownGain({ trackGainDb: 3, trackPeak: 0.5 }), { gainDb: 3, source: "tag" });
    assertGain(knownGain({ trackGainDb: -8.2, trackPeak: 1 }), { gainDb: -8.2, source: "tag" });
  });

  test("a tagged song is never boosted past its peak", () => {
    // -20·log10(0.5) = 6.02 dB of headroom.
    assertGain(knownGain({ trackGainDb: 9, trackPeak: 0.5 }), { gainDb: 6.0206, source: "tag" });
  });

  test("a peak above full scale turns the song down by what it's over", () => {
    assertGain(knownGain({ trackGainDb: 0, trackPeak: 1.2 }), { gainDb: -1.5836, source: "tag" });
  });

  test("a tag without a peak only turns the song down", () => {
    assertGain(knownGain({ trackGainDb: 4, trackPeak: null }), { gainDb: 0, source: "tag" });
    assertGain(knownGain({ trackGainDb: -4 }), { gainDb: -4, source: "tag" });
  });

  test("a streamed song's YouTube value is known too", () => {
    assertGain(knownGain({ youtubeLoudnessDb: 6.23 }), { gainDb: -6.23, source: "youtube" });
  });

  test("a song with no value has no known gain", () => {
    assert.equal(knownGain({}), null);
    assert.equal(knownGain({ trackGainDb: null, trackPeak: 0.5 }), null);
    assert.equal(knownGain({ trackGainDb: Number.NaN }), null);
  });
});

describe("songGain with tags and the typical gain", () => {
  test("a tagged song plays at its capped tag gain", () => {
    assertGain(songGain(true, { trackGainDb: 9, trackPeak: 0.5 }), {
      gainDb: 6.0206,
      source: "tag",
    });
  });

  test("a song with no value plays at the typical gain it's given", () => {
    assert.deepEqual(songGain(true, {}, -7.25), { gainDb: -7.25, source: "typical" });
  });

  test("with the switch off a tagged song plays as it is", () => {
    assert.deepEqual(songGain(false, { trackGainDb: -6, trackPeak: 1 }, -7), {
      gainDb: 0,
      source: "off",
    });
  });
});

describe("typicalGain", () => {
  const gains = (count: number, gainDb: (index: number) => number): number[] =>
    Array.from({ length: count }, (_, index) => gainDb(index));

  test("-5 dB while fewer than 20 songs have a value", () => {
    assert.equal(typicalGain([]), -5);
    assert.equal(typicalGain(gains(19, () => -9)), -5);
  });

  test("the median of the songs' gains once 20 have one", () => {
    // -1, -2, … -20: the middle two are -10 and -11.
    assert.equal(typicalGain(gains(20, (index) => -(index + 1))), -10.5);
    assert.equal(typicalGain(gains(21, (index) => -(index + 1))), -11);
  });

  test("moves as values arrive: the 20th value takes it off -5 dB", () => {
    const known = gains(19, () => -8);
    assert.equal(typicalGain(known), -5);
    assert.equal(typicalGain([...known, -2]), -8);
    assert.equal(typicalGain([...known, -2, ...gains(20, () => -2)]), -2);
  });

  test("whatever order the values come in", () => {
    const ordered = gains(25, (index) => -index);
    assert.equal(typicalGain([...ordered].reverse()), typicalGain(ordered));
    assert.equal(typicalGain(ordered), -12);
  });

  test("never above 0 dB: a song with no value has no known peak", () => {
    assert.equal(typicalGain(gains(20, () => 3)), 0);
  });

  test("leaves out values that aren't numbers", () => {
    assert.equal(typicalGain([...gains(19, () => -8), Number.NaN]), -5);
  });
});

describe("songsToMeasure", () => {
  /** A queue of [trackIds] from the Songs list, playing the one at [startIndex]. */
  const queue = (trackIds: readonly string[], startIndex: number): QueueState =>
    reduceQueue(EMPTY_QUEUE, {
      type: "play",
      trackIds,
      startIndex,
      context: { kind: "songs", id: null },
    }).state;
  const all = () => true;

  test("the current song and the next five in Up Next, in play order", () => {
    const state = queue(["1", "2", "3", "4", "5", "6", "7", "8", "9"], 1);
    assert.deepEqual(songsToMeasure(state, all), [2, 3, 4, 5, 6, 7]);
  });

  test("the five are songs to measure: streamed songs and songs with a value take no place", () => {
    const state = queue(["1", ytTrackId("dQw4w9WgXcQ"), "3", "4", "5", "6", "7", "8", "9"], 0);
    const measured = new Set([3, 5]);
    assert.deepEqual(
      songsToMeasure(state, (id) => !measured.has(id)),
      [1, 4, 6, 7, 8, 9],
    );
  });

  test("a current song with a value isn't measured, and the next five still are", () => {
    const state = queue(["1", "2", "3", "4", "5", "6", "7"], 0);
    assert.deepEqual(
      songsToMeasure(state, (id) => id !== 1),
      [2, 3, 4, 5, 6],
    );
  });

  test("a song queued twice in the window is measured once", () => {
    const state = queue(["1", "2", "1", "3"], 0);
    assert.deepEqual(songsToMeasure(state, all), [1, 2, 3]);
  });

  test("an empty queue measures nothing", () => {
    assert.deepEqual(songsToMeasure(EMPTY_QUEUE, all), []);
    assert.deepEqual(measureCandidates(EMPTY_QUEUE), []);
  });

  test("the candidates are every Library song it may pick, beyond the next five too", () => {
    const state = queue(["1", ytTrackId("dQw4w9WgXcQ"), "3", "4", "5", "6", "7", "8", "3"], 0);
    assert.deepEqual(measureCandidates(state), [1, 3, 4, 5, 6, 7, 8]);
  });
});
