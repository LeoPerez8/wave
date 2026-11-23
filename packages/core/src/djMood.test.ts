import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  completeMagicRadioBatch,
  DEFAULT_DJ_SETTINGS,
  DJ_MOOD_HIGH_ENERGY,
  DJ_MOOD_LOW_ENERGY,
  DJ_MOOD_SAD_VALENCE,
  djFirstRadioSong,
  djMedianAudioFeatures,
  djMoodFiltered,
  djMoodFit,
  magicArtistKey,
  startMagicQueue,
  ytTrackId,
  type DjAudioFeatures,
  type MagicSession,
  type RankedRadioSong,
  type YtAlbumSong,
} from "./index.ts";

const features = (energy: number, valence: number, acousticness = 0.3): DjAudioFeatures => ({
  energy,
  valence,
  acousticness,
  mode: 1,
});

const LOUD_HAPPY = features(0.9, 0.7, 0.1);
const LOUD_SAD = features(0.85, 0.15, 0.1);
const CALM_HAPPY = features(0.2, 0.6, 0.8);
const CALM_SAD = features(0.2, 0.15, 0.8);

describe("DJ mood features", () => {
  test("ISRC rows use the lower median for each numeric feature", () => {
    assert.deepEqual(
      djMedianAudioFeatures([
        { energy: 0.1, valence: 0.2, acousticness: 0.3, mode: 0 },
        { energy: 0.9, valence: 0.8, acousticness: 0.7, mode: 1 },
        { energy: 0.5, valence: 0.6, acousticness: 0.4, mode: 1 },
        { energy: 0.7, valence: 0.4, acousticness: 0.5, mode: 0 },
      ]),
      { energy: 0.5, valence: 0.4, acousticness: 0.4, mode: 0 },
    );
  });
});

describe("a mood matches a song, rules it off, or doesn't know it", () => {
  test("Energetic needs high energy and a song that isn't sad", () => {
    assert.equal(djMoodFit("energetic", LOUD_HAPPY, null), "matched");
    assert.equal(djMoodFit("energetic", LOUD_SAD, null), "off");
    assert.equal(djMoodFit("energetic", CALM_HAPPY, null), "off");
  });

  test("Relaxing needs low energy and a song that isn't sad", () => {
    assert.equal(djMoodFit("relaxing", CALM_HAPPY, null), "matched");
    assert.equal(djMoodFit("relaxing", CALM_SAD, null), "off");
    assert.equal(djMoodFit("relaxing", LOUD_HAPPY, null), "off");
  });

  test("Upbeat needs a happy song with medium or high energy", () => {
    assert.equal(djMoodFit("upbeat", features(0.8, 0.9), null), "matched");
    assert.equal(djMoodFit("upbeat", features(0.6, 0.65), null), "matched");
    assert.equal(djMoodFit("upbeat", features(0.8, 0.1), null), "off");
    assert.equal(djMoodFit("upbeat", features(0.1, 0.6), null), "off");
  });

  test("the thresholds sit on ReccoBeats' 0 to 1 scale", () => {
    for (const threshold of [DJ_MOOD_HIGH_ENERGY, DJ_MOOD_LOW_ENERGY, DJ_MOOD_SAD_VALENCE])
      assert.ok(threshold > 0 && threshold < 1);
    assert.ok(DJ_MOOD_LOW_ENERGY < DJ_MOOD_HIGH_ENERGY);
    const happy = DJ_MOOD_SAD_VALENCE + 0.01;
    assert.equal(djMoodFit("energetic", features(DJ_MOOD_HIGH_ENERGY, happy), null), "matched");
    assert.equal(djMoodFit("energetic", features(DJ_MOOD_HIGH_ENERGY - 0.01, happy), null), "off");
    assert.equal(djMoodFit("energetic", features(0.9, DJ_MOOD_SAD_VALENCE), null), "off");
    assert.equal(djMoodFit("relaxing", features(DJ_MOOD_LOW_ENERGY, happy), null), "matched");
    assert.equal(djMoodFit("relaxing", features(DJ_MOOD_LOW_ENERGY + 0.01, happy), null), "off");
    assert.equal(djMoodFit("relaxing", features(0.1, DJ_MOOD_SAD_VALENCE), null), "off");
  });

  test("with no features, a known style can only rule a song off: it says nothing of sadness", () => {
    assert.equal(djMoodFit("relaxing", null, "Nu Metal"), "off");
    assert.equal(djMoodFit("energetic", null, "Soft Rock"), "off");
    assert.equal(djMoodFit("energetic", null, "Nu Metal"), "unknown");
    assert.equal(djMoodFit("relaxing", null, "Soft Rock"), "unknown");
    assert.equal(djMoodFit("upbeat", null, "Soft Rock"), "unknown");
    assert.equal(djMoodFit("energetic", null, null), "unknown");
  });
});

describe("a mood filters a ranking", () => {
  test("off songs leave, even the best ranked, and matched ones keep their taste order", () => {
    const { matched, unknown } = djMoodFiltered(
      [
        { id: "favourite-sad", score: 30, song: { videoId: "favourite-sad" } },
        { id: "a", score: 20, song: { videoId: "a" } },
        { id: "unknown", score: 15, song: { videoId: "unknown" } },
        { id: "calm", score: 12, song: { videoId: "calm" } },
        { id: "b", score: 10, song: { videoId: "b" } },
      ],
      "energetic",
      new Map([
        ["favourite-sad", LOUD_SAD],
        ["a", LOUD_HAPPY],
        ["calm", CALM_HAPPY],
        ["b", features(0.7, 0.5)],
      ]),
      new Map(),
    );
    assert.deepEqual(
      matched.map(({ id }) => id),
      ["a", "b"],
    );
    assert.deepEqual(
      unknown.map(({ id }) => id),
      ["unknown"],
    );
    assert.deepEqual(matched[0], { id: "a", score: 20, song: { videoId: "a" } });
  });

  test("with no mood, the ranking is unchanged", () => {
    const songs = [
      { id: "sad", score: 30, song: { videoId: "sad" } },
      { id: "x", score: 10, song: null },
    ];
    const { matched, unknown } = djMoodFiltered(
      songs,
      null,
      new Map([["sad", LOUD_SAD]]),
      new Map(),
    );
    assert.deepEqual(matched, songs);
    assert.deepEqual(unknown, []);
  });

  test("a style read for the song, or its own genre, rules it off", () => {
    const { matched, unknown } = djMoodFiltered(
      [
        { id: "tagged", score: 10, song: { videoId: "tagged" } },
        { id: "own", score: 9, song: { videoId: "own" }, genre: "Nu Metal" },
        { id: "plain", score: 8, song: { videoId: "plain" } },
      ],
      "relaxing",
      new Map(),
      new Map([["tagged", "Heavy Metal"]]),
    );
    assert.deepEqual(matched, []);
    assert.deepEqual(
      unknown.map(({ id }) => id),
      ["plain"],
    );
  });

  test("a Library song with no stream match goes by its ISRC tag's features only", () => {
    const { matched, unknown } = djMoodFiltered(
      [
        { trackId: "1", source: "library" as const, score: 10, song: null },
        { trackId: "2", source: "library" as const, score: 9, song: null, genre: "Soft Rock" },
        { trackId: "3", source: "library" as const, score: 8, song: { videoId: "matched" } },
        { trackId: "4", source: "library" as const, score: 7, song: null },
      ],
      "energetic",
      new Map(),
      new Map(),
      new Map([
        ["1", CALM_HAPPY],
        ["3", LOUD_HAPPY],
      ]),
    );
    assert.deepEqual(
      matched.map(({ trackId }) => trackId),
      ["3"],
    );
    assert.deepEqual(
      unknown.map(({ trackId }) => trackId),
      ["2", "4"],
    );
  });

  test("a stream song's own features come before its Library match's", () => {
    const { matched } = djMoodFiltered(
      [{ trackId: "1", source: "library" as const, score: 10, song: { videoId: "v" } }],
      "energetic",
      new Map([["v", LOUD_HAPPY]]),
      new Map(),
      new Map([["1", CALM_SAD]]),
    );
    assert.equal(matched.length, 1);
  });
});

describe("a DJ session's later batch follows its mood", () => {
  const ranked = (id: string, score: number): RankedRadioSong => ({
    trackId: ytTrackId(id),
    artists: [magicArtistKey(`Artist ${id}`)],
    genre: null,
    style: null,
    source: "stream",
    score,
    radio: { id: "song:seed", position: 0 },
    song: {
      videoId: id,
      title: `Song ${id}`,
      artists: [`Artist ${id}`],
      album: null,
      albumId: null,
      durationMs: 180000,
      artworkUrl: null,
      explicit: false,
    },
  });
  const started = startMagicQueue(
    { kind: "track", id: "seed", title: "seed" },
    [{ trackId: "seed", artists: [magicArtistKey("Artist seed")], genre: null, style: null }],
    { id: "session", random: () => 0, ytShare: 1 },
  )!.session;
  const session: MagicSession = {
    ...started,
    batches: 2,
    dj: { ...DEFAULT_DJ_SETTINGS, mood: "energetic" },
  };
  /** The batch the app completes from a mood's pools: matched ones first, unknown ones as its fill. */
  const batch = (
    songs: readonly RankedRadioSong[],
    known: ReadonlyMap<string, DjAudioFeatures>,
  ) => {
    const { matched, unknown } = djMoodFiltered(songs, session.dj!.mood, known, new Map());
    return completeMagicRadioBatch(session, matched, [], () => ({ seed: unknown, liked: [] }))
      .trackIds;
  };

  test("unknown songs fill only what the matched ones can't", () => {
    const songs = [
      ranked("sad", 40),
      ranked("u1", 30),
      ranked("m1", 20),
      ranked("u2", 15),
      ranked("m2", 10),
      ranked("off", 5),
    ];
    const known = new Map([
      ["sad", LOUD_SAD],
      ["m1", LOUD_HAPPY],
      ["m2", LOUD_HAPPY],
      ["off", CALM_HAPPY],
    ]);
    assert.deepEqual(batch(songs, known), ["yt:m1", "yt:m2", "yt:u1", "yt:u2"]);
  });

  test("enough matched songs leave the unknown ones out", () => {
    const songs = [
      ranked("u", 50),
      ...Array.from({ length: 12 }, (_, i) => ranked(`m${i}`, 40 - i)),
    ];
    const known = new Map(Array.from({ length: 12 }, (_, i) => [`m${i}`, LOUD_HAPPY] as const));
    const ids = batch(songs, known);
    assert.equal(ids.length, 10);
    assert.ok(!ids.includes("yt:u"));
    assert.deepEqual(ids.slice(0, 3), ["yt:m0", "yt:m1", "yt:m2"]);
  });
});

describe("a mood session's first song", () => {
  const session: MagicSession = {
    ...startMagicQueue(
      { kind: "track", id: "seed", title: "seed" },
      [{ trackId: "seed", artists: [magicArtistKey("Artist")], genre: null, style: null }],
      { id: "session", random: () => 0, ytShare: 1 },
    )!.session,
    seed: { kind: "dj", id: "dj", title: "DJ" },
    radioArtists: ["Artist"],
    dj: { ...DEFAULT_DJ_SETTINGS, mood: "energetic" },
  };
  const song = (videoId: string): YtAlbumSong => ({
    videoId,
    title: `Song ${videoId}`,
    artists: ["Artist"],
    album: null,
    albumId: null,
    durationMs: 180000,
    artworkUrl: null,
    explicit: false,
  });
  const known = new Map([
    ["sad", LOUD_SAD],
    ["match", LOUD_HAPPY],
  ]);
  const moodFit = (each: YtAlbumSong) =>
    djMoodFit("energetic", known.get(each.videoId) ?? null, null);
  const profileOf = () => null;

  test("is a known match when the page has one", () => {
    const first = djFirstRadioSong(session, "artist:a", [song("sad"), song("u"), song("match")], {
      profileOf,
      moodFit,
    });
    assert.equal(first?.videoId, "match");
  });

  test("is an unknown song when the page has no match, and never an off one", () => {
    assert.equal(
      djFirstRadioSong(session, "artist:a", [song("sad"), song("u")], { profileOf, moodFit })
        ?.videoId,
      "u",
    );
    assert.equal(
      djFirstRadioSong(session, "artist:a", [song("sad")], { profileOf, moodFit }),
      null,
    );
  });
});
