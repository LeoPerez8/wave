import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { catalogueOf } from "./localisation.ts";
import {
  radioRankingBatch,
  EMPTY_QUEUE,
  MAGIC_QUEUE_CONTEXT,
  genreProfile,
  magicArtistKey,
  magicBatchEmpty,
  magicBatchFailed,
  magicBatchLoading,
  magicBatchRadios,
  magicLibrarySongs,
  magicSeedProfile,
  magicYtSong,
  magicRadioArtists,
  magicQueueEdits,
  magicQueueLabel,
  magicQueueShare,
  magicSignal,
  magicPlaySignal,
  parseMagicSession,
  reduceQueue,
  startMagicQueue,
  startStreamedMagicQueue,
  streamedSongMagicStart,
  wantsMagicBatch,
  type DiscoverMixLevel,
  type GenreProfileOf,
  type MagicSeed,
  type MagicSession,
  type MagicSignalKind,
  type MagicSong,
  type QueueCommand,
  type QueueState,
} from "./index.ts";

/** The luckiest draw: each pick lands on the heaviest song left. */
const first = () => 0;

const song = (trackId: string, artist: string, genre: string | null = "Rock"): MagicSong => ({
  trackId,
  artists: [magicArtistKey(artist)],
  genre,
  style: null,
});

const SONG_SEED: MagicSeed = { kind: "track", id: "s1", title: "Seed Song" };

/** [count] songs by [artist], ids `<prefix>1`, `<prefix>2`… */
const songsBy = (prefix: string, artist: string, count: number, genre = "Rock"): MagicSong[] =>
  Array.from({ length: count }, (_, i) => song(`${prefix}${i + 1}`, artist, genre));

describe("Starting a Magic Queue", () => {
  test("new sessions and signals omit retired weights while old sessions still load", () => {
    const started = startMagicQueue(SONG_SEED, [song("s1", "Seed Artist")], {
      id: "m1",
      random: first,
    })!.session;
    assert.ok(!("artistAffinity" in started));
    assert.ok(!("genreAffinity" in started));
    assert.ok(!("excludedArtists" in started));
    const old = parseMagicSession({
      ...started,
      artistAffinity: { old: 3 },
      genreAffinity: { rock: 2 },
      excludedArtists: ["old"],
    })!;
    for (const kind of [
      "skip",
      "removed",
      "favorite",
      "download",
      "playedThrough",
      "added",
    ] as const) {
      const learned = magicSignal(old, { kind, song: song("new", "New Artist") });
      assert.ok(!("artistAffinity" in learned));
      assert.ok(!("genreAffinity" in learned));
      assert.ok(!("excludedArtists" in learned));
      assert.equal(learned.radioSignals?.[0]?.kind, kind);
      assert.ok(learned.used.includes("new"));
    }
  });
  test("plays the song itself for a song seed", () => {
    const seed = song("s1", "Seed Artist");
    const started = startMagicQueue(SONG_SEED, [seed], { id: "m1", random: first });
    assert.equal(started?.first, "s1");
  });

  test("plays a random song of a playlist, album or artist seed", () => {
    const songs = songsBy("a", "Artist", 4);
    const seed: MagicSeed = { kind: "album", id: "7", title: "An Album" };
    assert.equal(startMagicQueue(seed, songs, { id: "m1", random: () => 0.6 })?.first, "a3");
  });

  test("can't start from a seed with no songs", () => {
    const seed: MagicSeed = { kind: "playlist", id: "3", title: "Empty" };
    assert.equal(startMagicQueue(seed, [], { id: "m1", random: first }), null);
  });
});

/** What a play's end tells a Magic Queue: ended for [endReason] after [listenedMs], by Next or not. */
const ended = (
  endReason: "completed" | "skipped" | "stopped" | "interrupted",
  listenedMs: number,
  byNext = false,
) => magicPlaySignal({ play: { endReason, listenedMs }, byNext });

describe("How a play ends, as a Magic Queue signal", () => {
  test("Next within the first 30 s is a skip", () => {
    assert.equal(ended("skipped", 29_999, true), "skip");
  });

  test("Next after 30 s is neutral", () => {
    assert.equal(ended("skipped", 30_000, true), null);
  });

  test("Previous, picking another Up Next entry or a replay within 30 s is neutral", () => {
    assert.equal(ended("skipped", 5_000), null);
  });

  test("played to the end is positive", () => {
    assert.equal(ended("completed", 200_000), "playedThrough");
  });

  test("stopped or interrupted says nothing", () => {
    assert.equal(ended("stopped", 1_000, true), null);
    assert.equal(ended("interrupted", 1_000), null);
  });
});

describe("A Magic Queue's songs from both sources", () => {
  const artists = [
    { id: 1, name: "Seed Artist" },
    { id: 2, name: "Paramore" },
    { id: 3, name: "Popper" },
    { id: 4, name: "Metaller" },
  ];
  const fromLibrary = magicLibrarySongs(artists);
  const metal = genreProfile([{ genre: "Metal" }]);
  const profileOf: GenreProfileOf = (artist) => (artist === "Deezer Band" ? metal : undefined);

  test("a Library song weighs by its artists' names and its genre family", () => {
    const one = fromLibrary({ id: 11, artistIds: [2, 1], genre: "Alt Rock" });
    assert.deepEqual(one, {
      trackId: "11",
      artists: [magicArtistKey("Paramore"), magicArtistKey("Seed Artist")],
      genre: genreProfile([{ genre: "Alt Rock" }])!
        .keys()
        .next().value,
      style: null,
    });
  });

  test("a YouTube Music song's genre comes from its artist's Deezer profile", () => {
    const deezer = magicYtSong({ trackId: "yt:d", artists: ["Nobody", "Deezer Band"] }, profileOf);
    assert.equal(deezer.genre, metal!.keys().next().value);
    assert.equal(magicYtSong({ trackId: "yt:n", artists: ["Nobody"] }, profileOf).genre, null);
  });
});

describe("A Magic Queue in the queue", () => {
  const session: MagicSession = startMagicQueue(SONG_SEED, [song("s1", "Seed Artist")], {
    id: "m1",
    random: first,
  })!.session;
  const context = { kind: MAGIC_QUEUE_CONTEXT, id: "m1" };
  const run = (state: QueueState, ...commands: QueueCommand[]): QueueState =>
    commands.reduce((current, command) => reduceQueue(current, command).state, state);
  const show = (state: QueueState): string =>
    state.entries
      .map((entry, i) => (i === state.index ? `[${entry.trackId}]` : entry.trackId))
      .join(" ");
  const playing = run(EMPTY_QUEUE, {
    type: "play",
    trackIds: ["s1", "a", "b"],
    startIndex: 0,
    context,
  });
  const keyOf = (state: QueueState, trackId: string): string =>
    state.entries.find((entry) => entry.trackId === trackId)!.key;

  test("a batch joins the end of the queue, after songs lined up", () => {
    const state = run(
      playing,
      { type: "addToQueue", trackIds: ["q"] },
      { type: "append", trackIds: ["c", "d"] },
    );
    assert.equal(show(state), "[s1] q a b c d");
  });

  test("wants a batch once no recommendation is left in Up Next", () => {
    assert.equal(wantsMagicBatch(session, playing), false);
    const last = run(playing, { type: "next" }, { type: "next" });
    assert.equal(wantsMagicBatch(session, last), true);
    // Songs lined up by hand don't hold the batch back.
    assert.equal(wantsMagicBatch(session, run(last, { type: "playNext", trackIds: ["q"] })), true);
  });

  test("is over once something else plays", () => {
    const other = run(playing, {
      type: "play",
      trackIds: ["x", "y"],
      startIndex: 0,
      context: { kind: "album", id: "4" },
    });
    assert.equal(wantsMagicBatch(session, run(other, { type: "next" })), false);
    assert.deepEqual(magicQueueEdits(session, playing, other), { added: [], removed: [] });
  });

  test("tells songs lined up by hand apart from its own batches", () => {
    const lined = run(playing, { type: "playNext", trackIds: ["q"] });
    assert.deepEqual(magicQueueEdits(session, playing, lined), { added: ["q"], removed: [] });
    const batched = run(playing, { type: "append", trackIds: ["c"] });
    assert.deepEqual(magicQueueEdits(session, playing, batched), { added: [], removed: [] });
  });

  test("tells a removed recommendation apart from a song lined up by hand and removed", () => {
    const lined = run(playing, { type: "playNext", trackIds: ["q"] });
    const noA = run(lined, { type: "remove", key: keyOf(lined, "a") });
    assert.deepEqual(magicQueueEdits(session, lined, noA), { added: [], removed: ["a"] });
    const noQ = run(lined, { type: "remove", key: keyOf(lined, "q") });
    assert.deepEqual(magicQueueEdits(session, lined, noQ), { added: [], removed: [] });
    // Playing on past a song is no removal.
    assert.deepEqual(magicQueueEdits(session, lined, run(lined, { type: "next" })), {
      added: [],
      removed: [],
    });
  });

  test("shows its batch loading while it's picked, until the batch lands", () => {
    const seedOnly = run(EMPTY_QUEUE, { type: "play", trackIds: ["s1"], startIndex: 0, context });
    assert.equal(magicBatchLoading(session, "m1", seedOnly), true);
    assert.equal(magicBatchLoading(session, null, seedOnly), false);
    // The batch in Up Next takes the loading's place, before the picking is cleared.
    const landed = run(seedOnly, { type: "append", trackIds: ["a", "b"] });
    assert.equal(magicBatchLoading(session, "m1", landed), false);
  });

  test("shows a later batch loading under the songs lined up by hand", () => {
    const last = run(
      playing,
      { type: "next" },
      { type: "next" },
      { type: "addToQueue", trackIds: ["q"] },
    );
    assert.equal(magicBatchLoading(session, "m1", last), true);
  });

  test("shows no batch loading once something else plays, or for another session", () => {
    const last = run(playing, { type: "next" }, { type: "next" });
    const other = run(last, {
      type: "play",
      trackIds: ["x"],
      startIndex: 0,
      context: { kind: "album", id: "4" },
    });
    assert.equal(magicBatchLoading(session, "m1", other), false);
    assert.equal(magicBatchLoading(session, "m0", last), false);
    assert.equal(magicBatchLoading(null, "m1", last), false);
  });

  test("shows its batch failed until the batch lands or something else plays", () => {
    const seedOnly = run(EMPTY_QUEUE, { type: "play", trackIds: ["s1"], startIndex: 0, context });
    assert.equal(magicBatchFailed(session, "m1", seedOnly), true);
    assert.equal(magicBatchFailed(session, null, seedOnly), false);
    assert.equal(magicBatchFailed(session, "m0", seedOnly), false);
    const landed = run(seedOnly, { type: "append", trackIds: ["a", "b"] });
    assert.equal(magicBatchFailed(session, "m1", landed), false);
    const other = run(seedOnly, {
      type: "play",
      trackIds: ["x"],
      startIndex: 0,
      context: { kind: "album", id: "4" },
    });
    assert.equal(magicBatchFailed(session, "m1", other), false);
  });

  test("says its batch found no songs until a batch lands or something else plays (#638)", () => {
    const seedOnly = run(EMPTY_QUEUE, { type: "play", trackIds: ["s1"], startIndex: 0, context });
    assert.equal(magicBatchEmpty(session, "m1", seedOnly), true);
    assert.equal(magicBatchEmpty(session, null, seedOnly), false);
    assert.equal(magicBatchEmpty(session, "m0", seedOnly), false);
    assert.equal(
      magicBatchEmpty(session, "m1", run(seedOnly, { type: "append", trackIds: ["a"] })),
      false,
    );
    const other = run(seedOnly, {
      type: "play",
      trackIds: ["x"],
      startIndex: 0,
      context: { kind: "album", id: "4" },
    });
    assert.equal(magicBatchEmpty(session, "m1", other), false);
  });

  test("Up Next names the seed", () => {
    assert.equal(magicQueueLabel(session), "Magic Queue · from Seed Song");
    assert.equal(
      magicQueueLabel(session, catalogueOf("pt-BR")),
      "Fila Mágica · a partir de Seed Song",
    );
  });

  test("a session reads back as it was saved", () => {
    const learned = magicSignal(session, { kind: "skip", song: song("z", "Zed", "Ska") });
    assert.deepEqual(parseMagicSession(JSON.parse(JSON.stringify(learned))), learned);
    assert.equal(parseMagicSession({ id: "m1" }), null);
    assert.equal(parseMagicSession(null), null);
  });

  test("keeps what its YouTube Music radio grows from, through a restart", () => {
    const profile = genreProfile([{ genre: "Metal" }, { genre: "Pop" }]);
    const seed: MagicSeed = { kind: "album", id: "7", title: "An Album" };
    const started = startMagicQueue(seed, [song("a1", "A"), song("a2", "A")], {
      id: "m2",
      random: first,
      radio: { artists: ["A", "A"], profile },
    })!.session;
    assert.deepEqual(started.radioArtists, ["A"]);
    assert.deepEqual(magicSeedProfile(started), profile);
    const read = parseMagicSession(JSON.parse(JSON.stringify(started)))!;
    assert.deepEqual(read, started);
    assert.deepEqual(magicSeedProfile(read), profile);
  });

  test("a session saved before it kept its radio reads back with none", () => {
    const { radioArtists: _artists, seedProfile: _profile, ...older } = session;
    const read = parseMagicSession({ ...older, radioArtists: "A" })!;
    assert.deepEqual(read.radioArtists, []);
    assert.equal(magicSeedProfile(read), null);
  });
});

describe("A Magic Queue's YouTube Music share", () => {
  const seedSong = song("s1", "Seed Artist");
  const library = [seedSong, ...songsBy("x", "Other", 40)];
  const start = () => startMagicQueue(SONG_SEED, [seedSong], { id: "m1", random: first })!.session;
  const yt = songsBy("yt:v", "Radio Artist", 40);
  /** How many of a 10-song batch (the second) come from YouTube Music. */
  const ytInBatch = (session: MagicSession): number => {
    const ranked = [...library, ...yt].map((candidate) => ({
      ...candidate,
      score: 1,
      radio: null,
      song: null,
      source: candidate.trackId.startsWith("yt:") ? ("stream" as const) : ("library" as const),
    }));
    return radioRankingBatch(ranked, { size: 10, newMusicShare: session.ytShare }).filter(
      (candidate) => candidate.source === "stream",
    ).length;
  };

  test("starts at half the batch", () => {
    assert.equal(ytInBatch(start()), 5);
  });

  /** [session] having learned [kind] about [times] YouTube Music songs by different artists. */
  const learnYt = (session: MagicSession, kind: MagicSignalKind, times: number): MagicSession =>
    Array.from({ length: times }, (_, i) => song(`yt:s${i}`, `Learned ${i}`)).reduce(
      (learned, ytSong) => magicSignal(learned, { kind, song: ytSong }),
      session,
    );

  test("grows as YouTube Music songs get favorited or downloaded", () => {
    const favorited = ytInBatch(learnYt(start(), "favorite", 1));
    const downloaded = ytInBatch(learnYt(start(), "download", 1));
    assert.ok(favorited > 5);
    assert.ok(downloaded > 5);
    assert.ok(favorited >= downloaded);
  });

  test("shrinks as YouTube Music songs get skipped or removed", () => {
    assert.ok(ytInBatch(learnYt(start(), "skip", 1)) < 5);
    assert.ok(ytInBatch(learnYt(start(), "removed", 1)) < 5);
  });

  test("starts at the share its new-music level gives, from 20% to 100%", () => {
    const at = (level: DiscoverMixLevel) =>
      startMagicQueue(SONG_SEED, [seedSong], {
        id: "m1",
        random: first,
        ytShare: magicQueueShare(level),
      })!.session;
    assert.deepEqual(
      ([1, 2, 3, 4, 5] as const).map((level) => ytInBatch(at(level))),
      [2, 4, 6, 8, 10],
    );
  });

  test("a share outside 20-100% starts at the nearest bound", () => {
    const at = (ytShare: number) =>
      startMagicQueue(SONG_SEED, [seedSong], { id: "m1", random: first, ytShare })!.session;
    assert.equal(ytInBatch(at(1.5)), 10);
    assert.equal(ytInBatch(at(0)), 2);
  });

  test("signals keep moving a level's share within 20-100%", () => {
    const high = startMagicQueue(SONG_SEED, [seedSong], {
      id: "m1",
      random: first,
      ytShare: magicQueueShare(5),
    })!.session;
    assert.equal(ytInBatch(learnYt(high, "favorite", 3)), 10);
    assert.ok(ytInBatch(learnYt(high, "skip", 1)) < 10);
  });

  test("always stays between 20% and 100%", () => {
    assert.equal(ytInBatch(learnYt(start(), "favorite", 30)), 10);
    assert.equal(ytInBatch(learnYt(start(), "skip", 30)), 2);
  });

  test("doesn't move with Library songs' signals, or YouTube Music songs played or added", () => {
    let session = start();
    session = magicSignal(session, { kind: "favorite", song: song("x1", "Other") });
    session = magicSignal(session, { kind: "skip", song: song("x2", "Someone") });
    session = learnYt(session, "playedThrough", 3);
    session = learnYt(session, "added", 3);
    assert.equal(session.ytShare, start().ytShare);
  });

  test("reads back as it was saved, and afresh from a session saved before it", () => {
    const learned = learnYt(start(), "favorite", 2);
    assert.deepEqual(parseMagicSession(JSON.parse(JSON.stringify(learned))), learned);
    const { ytShare: _, ...older } = learned;
    assert.equal(parseMagicSession(older)?.ytShare, 0.5);
  });
});

describe("A Magic Queue's radio artists", () => {
  test("come from the radio of the seed's artist, or its songs' most credited artists", () => {
    const artistSeed: MagicSeed = { kind: "artist", id: "4", title: "The Seed" };
    assert.deepEqual(magicRadioArtists(artistSeed, ["Someone"]), ["The Seed"]);
    const playlist: MagicSeed = { kind: "playlist", id: "2", title: "Mine" };
    assert.deepEqual(magicRadioArtists(playlist, ["B", "A", "C", "A", "B", "A"]), ["A", "B"]);
    assert.deepEqual(magicRadioArtists(SONG_SEED, ["Solo"]), ["Solo"]);
  });
});

describe("a Magic Queue from a streamed song", () => {
  const streamed = {
    videoId: "vid1",
    title: "Midnight City",
    artists: ["M83", "Anthony Gonzalez"],
    album: "Hurry Up, We're Dreaming",
    durationMs: 244_000,
    artworkUrl: null,
    explicit: false,
  };

  test("plays the song first and grows from its own radio, read by its video", () => {
    const { session, first: firstSong } = startStreamedMagicQueue(streamed, {
      id: "s1",
      ytShare: 0.6,
    });
    assert.equal(firstSong, "yt:vid1");
    assert.deepEqual(session.used, ["yt:vid1"]);
    assert.equal(magicQueueLabel(session), "Magic Queue · from Midnight City");
    assert.equal(session.ytShare, 0.6);
    assert.deepEqual(session.radioArtists, ["M83", "Anthony Gonzalez"]);
    assert.deepEqual(session.seedVideoIds, ["vid1"]);
    // Each batch reads the song's radio, as a Library song's session does.
    assert.deepEqual(magicBatchRadios(session, first).seeds, [
      {
        id: "song:yt:vid1",
        title: "Midnight City",
        artists: ["M83", "Anthony Gonzalez"],
        durationMs: 244_000,
        videoId: "vid1",
      },
    ]);
  });

  test("goes on after a restart", () => {
    const { session } = startStreamedMagicQueue(streamed, { id: "s1" });
    assert.deepEqual(parseMagicSession(JSON.parse(JSON.stringify(session))), session);
  });

  test("starts from the Library's file when the Library has the song, as its own menu would", () => {
    const track = { id: 12, title: "Midnight City", path: "/music/m83.flac" };
    assert.deepEqual(streamedSongMagicStart(track), {
      from: "library",
      seed: { kind: "track", id: "12", title: "Midnight City" },
      track,
    });
  });

  test("starts from the stream when the Library hasn't the song, or has it without a file", () => {
    assert.deepEqual(streamedSongMagicStart(null), { from: "stream" });
    assert.deepEqual(streamedSongMagicStart({ id: 12, title: "Midnight City", path: null }), {
      from: "stream",
    });
  });
});
