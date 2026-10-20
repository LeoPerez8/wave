import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EMPTY_QUEUE,
  MAGIC_QUEUE_CONTEXT,
  genreProfile,
  magicArtistKey,
  magicBatch,
  magicBatchLoading,
  magicPickEnded,
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
  tasteProfile,
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
});

const SONG_SEED: MagicSeed = { kind: "track", id: "s1", title: "Seed Song" };

/** [count] songs by [artist], ids `<prefix>1`, `<prefix>2`… */
const songsBy = (prefix: string, artist: string, count: number, genre = "Rock"): MagicSong[] =>
  Array.from({ length: count }, (_, i) => song(`${prefix}${i + 1}`, artist, genre));

describe("Starting a Magic Queue", () => {
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

describe("A Magic Queue's batches", () => {
  const library = [song("s1", "Seed Artist"), ...songsBy("x", "Other", 30)];

  test("follow the first song with 9 more, then 10 at a time", () => {
    const started = startMagicQueue(SONG_SEED, [library[0]!], { id: "m1", random: first })!;
    const one = magicBatch(started.session, library, first);
    assert.equal(one.trackIds.length, 9);
    const two = magicBatch(one.session, library, first);
    assert.equal(two.trackIds.length, 10);
    assert.equal(magicBatch(two.session, library, first).trackIds.length, 10);
  });

  test("never repeat a song within the session", () => {
    const started = startMagicQueue(SONG_SEED, [library[0]!], { id: "m1", random: Math.random })!;
    let session = started.session;
    const queued = [started.first];
    for (let batch = 0; batch < 4; batch += 1) {
      const next = magicBatch(session, library, Math.random);
      queued.push(...next.trackIds);
      session = next.session;
    }
    assert.equal(queued.length, 31);
    assert.equal(new Set(queued).size, 31);
    // The Library ran dry: nothing left to add.
    assert.deepEqual(magicBatch(session, library, Math.random).trackIds, []);
  });

  test("lean towards the seed's artist and genre", () => {
    const seedSongs = [song("s1", "Seed Artist", "Metal"), song("s2", "Seed Artist", "Metal")];
    const pool = [...seedSongs, song("p1", "Pop Star", "Pop"), song("m1", "Metal Band", "Metal")];
    const started = startMagicQueue(SONG_SEED, [seedSongs[0]!], { id: "m1", random: first })!;
    assert.deepEqual(magicBatch(started.session, pool, first).trackIds, ["s2", "m1", "p1"]);
  });
});

describe("A Magic Queue's signals", () => {
  const seedSong = song("s1", "Seed Artist", "Seed");
  const start = () => startMagicQueue(SONG_SEED, [seedSong], { id: "m1", random: first })!.session;

  test("a skip within 30 s excludes that artist for the rest of the session", () => {
    const pool = [seedSong, song("b1", "Bore"), song("b2", "Bore"), song("o1", "Other")];
    const session = magicSignal(start(), { kind: "skip", song: song("b1", "Bore") });
    assert.deepEqual(magicBatch(session, pool, first).trackIds, ["o1"]);
  });

  test("a skip lowers that genre's weight but never excludes it", () => {
    const pool = [seedSong, song("r1", "Rocker", "Rock"), song("j1", "Jazzer", "Jazz")];
    // Rock and Jazz weigh the same until a Rock song by someone else is skipped.
    const skipped = magicSignal(start(), { kind: "skip", song: song("r0", "Skipped", "Rock") });
    assert.deepEqual(magicBatch(skipped, pool, first).trackIds, ["j1", "r1"]);
    let worn = skipped;
    for (let i = 0; i < 20; i += 1)
      worn = magicSignal(worn, { kind: "skip", song: song(`r${i + 2}`, `S${i}`, "Rock") });
    assert.deepEqual(magicBatch(worn, pool, first).trackIds, ["j1", "r1"]);
  });

  test("rank a favorite above a download above a song played to the end", () => {
    const pool = [
      seedSong,
      song("p2", "Played", "Pop"),
      song("d2", "Downloaded", "Pop"),
      song("f2", "Favorited", "Pop"),
    ];
    let session = start();
    session = magicSignal(session, { kind: "playedThrough", song: song("p1", "Played", "Pop") });
    session = magicSignal(session, { kind: "download", song: song("d1", "Downloaded", "Pop") });
    session = magicSignal(session, { kind: "favorite", song: song("f1", "Favorited", "Pop") });
    assert.deepEqual(magicBatch(session, pool, first).trackIds, ["f2", "d2", "p2"]);
  });

  test("a song added with Play Next or Add to Queue counts as positive", () => {
    const pool = [seedSong, song("a2", "Added", "Pop"), song("n1", "Neutral", "Pop")];
    const session = magicSignal(start(), { kind: "added", song: song("a1", "Added", "Pop") });
    assert.deepEqual(magicBatch(session, pool, first).trackIds, ["a2", "n1"]);
  });

  test("an added song is never recommended again", () => {
    const pool = [seedSong, song("a1", "Added", "Pop")];
    const session = magicSignal(start(), { kind: "added", song: song("a1", "Added", "Pop") });
    assert.deepEqual(magicBatch(session, pool, first).trackIds, []);
  });

  test("removing a recommendation counts as a skip", () => {
    const pool = [seedSong, song("r2", "Removed"), song("o1", "Other")];
    const session = magicSignal(start(), { kind: "removed", song: song("r1", "Removed") });
    assert.deepEqual(magicBatch(session, pool, first).trackIds, ["o1"]);
  });
});

describe("A Magic Queue and the taste profile", () => {
  const NOW = 1_000_000_000_000;
  const seedSong = song("s1", "Seed Artist", "Seed");
  const start = () => startMagicQueue(SONG_SEED, [seedSong], { id: "m1", random: first })!.session;
  const pool = [
    seedSong,
    song("plain", "Plain", "Pop"),
    song("liked", "Liked", "Pop"),
    song("skipped", "Skipper", "Pop"),
  ];
  const songOf = (trackId: string) => pool.find((candidate) => candidate.trackId === trackId);
  const play = (trackId: string, endReason: "completed" | "skipped", listenedMs: number) => ({
    trackId,
    startedAt: NOW,
    listenedMs,
    endReason,
  });

  test("a new session ranks candidates by the profile from its first batch", () => {
    const taste = tasteProfile(
      {
        plays: [play("skipped", "skipped", 4_000)],
        favorites: [{ trackId: "liked", changedAt: NOW }],
        downloads: [],
      },
      songOf,
      NOW,
    );
    assert.deepEqual(magicBatch(start(), pool, first).trackIds, ["plain", "liked", "skipped"]);
    assert.deepEqual(magicBatch(start(), pool, first, [], taste).trackIds, [
      "liked",
      "plain",
      "skipped",
    ]);
  });

  test("weighs songs never played by how much their artist and genre were liked", () => {
    const history = [song("old", "Liked", "Pop"), song("jazz", "Someone", "Jazz")];
    const taste = tasteProfile(
      {
        plays: [play("old", "completed", 200_000), play("jazz", "completed", 200_000)],
        favorites: [],
        downloads: [],
      },
      (trackId) => history.find((candidate) => candidate.trackId === trackId),
      NOW,
    );
    const fresh = [
      seedSong,
      song("n1", "Neutral", "Rock"),
      song("j1", "Other", "Jazz"),
      song("l1", "Liked", "Rock"),
    ];
    assert.deepEqual(magicBatch(start(), fresh, first, [], taste).trackIds, ["l1", "j1", "n1"]);
  });

  test("keeps the session's own rules: a liked artist skipped in the session is out", () => {
    const taste = tasteProfile(
      { plays: [], favorites: [{ trackId: "liked", changedAt: NOW }], downloads: [] },
      songOf,
      NOW,
    );
    const session = magicSignal(start(), { kind: "skip", song: song("l0", "Liked", "Pop") });
    assert.deepEqual(magicBatch(session, pool, first, [], taste).trackIds, ["plain", "skipped"]);
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
  const seedSong = fromLibrary({ id: 10, artistIds: [1], genre: "Rock" });
  const metal = genreProfile([{ genre: "Metal" }]);
  const profileOf: GenreProfileOf = (artist) => (artist === "Deezer Band" ? metal : undefined);
  const start = () => startMagicQueue(SONG_SEED, [seedSong], { id: "m1", random: first })!.session;

  test("a Library song weighs by its artists' names and its genre family", () => {
    const one = fromLibrary({ id: 11, artistIds: [2, 1], genre: "Alt Rock" });
    assert.deepEqual(one, {
      trackId: "11",
      artists: [magicArtistKey("Paramore"), magicArtistKey("Seed Artist")],
      genre: genreProfile([{ genre: "Alt Rock" }])!
        .keys()
        .next().value,
    });
  });

  test("a skipped YouTube Music song's artist is excluded from the Library's songs too", () => {
    const library = [
      seedSong,
      fromLibrary({ id: 20, artistIds: [2], genre: "Rock" }),
      fromLibrary({ id: 30, artistIds: [3], genre: "Rock" }),
    ];
    const skipped = magicYtSong({ trackId: "yt:p", artists: ["paramore"] }, profileOf);
    const session = magicSignal(start(), { kind: "skip", song: skipped });
    assert.deepEqual(magicBatch(session, library, first).trackIds, ["30"]);
  });

  test("a skipped Library song's artist is excluded from YouTube Music's songs too", () => {
    const skipped = fromLibrary({ id: 20, artistIds: [2], genre: "Rock" });
    const yt = [
      magicYtSong({ trackId: "yt:p", artists: ["Paramore"] }, profileOf),
      magicYtSong({ trackId: "yt:o", artists: ["Other"] }, profileOf),
    ];
    const session = magicSignal(start(), { kind: "skip", song: skipped });
    assert.deepEqual(magicBatch(session, [seedSong], first, yt).trackIds, ["yt:o"]);
  });

  test("the seed's artists weigh on their YouTube Music songs too", () => {
    const yt = [
      magicYtSong({ trackId: "yt:o", artists: ["Other"] }, profileOf),
      magicYtSong({ trackId: "yt:s", artists: ["Seed Artist"] }, profileOf),
    ];
    assert.deepEqual(magicBatch(start(), [seedSong], first, yt).trackIds, ["yt:s", "yt:o"]);
  });

  test("a YouTube Music song's genre comes from its artist's Deezer profile", () => {
    const deezer = magicYtSong({ trackId: "yt:d", artists: ["Nobody", "Deezer Band"] }, profileOf);
    assert.equal(deezer.genre, metal!.keys().next().value);
    assert.equal(magicYtSong({ trackId: "yt:n", artists: ["Nobody"] }, profileOf).genre, null);
  });

  test("so its skip lowers that genre's weight for the Library's songs too", () => {
    const library = [
      seedSong,
      fromLibrary({ id: 40, artistIds: [4], genre: "Metal" }),
      fromLibrary({ id: 30, artistIds: [3], genre: "Pop" }),
    ];
    assert.deepEqual(magicBatch(start(), library, first).trackIds, ["40", "30"]);
    const skipped = magicYtSong({ trackId: "yt:d", artists: ["Deezer Band"] }, profileOf);
    const session = magicSignal(start(), { kind: "skip", song: skipped });
    assert.deepEqual(magicBatch(session, library, first).trackIds, ["30", "40"]);
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

  test("a pick that ends clears only its own session's loading", () => {
    const seedOnly = run(EMPTY_QUEUE, { type: "play", trackIds: ["s1"], startIndex: 0, context });
    assert.equal(magicPickEnded("m1", "m1", session, seedOnly).picking, null);
    // An older session's pick ends after this one started: this one is still loading.
    const older = magicPickEnded("m0", "m1", session, seedOnly);
    assert.equal(older.picking, "m1");
    assert.equal(magicBatchLoading(session, older.picking, seedOnly), true);
  });

  test("a pick that ends for an older session picks again for the one under way", () => {
    const seedOnly = run(EMPTY_QUEUE, { type: "play", trackIds: ["s1"], startIndex: 0, context });
    assert.equal(magicPickEnded("m0", "m1", session, seedOnly).again, true);
    // Not once its batch is in, not with no session under way.
    const landed = run(seedOnly, { type: "append", trackIds: ["a"] });
    assert.equal(magicPickEnded("m0", "m1", session, landed).again, false);
    assert.equal(magicPickEnded("m0", null, null, seedOnly).again, false);
  });

  test("a pick that ends for the session under way doesn't pick again, even with no batch", () => {
    const seedOnly = run(EMPTY_QUEUE, { type: "play", trackIds: ["s1"], startIndex: 0, context });
    // It failed or found nothing: the next queue change asks again.
    assert.equal(magicPickEnded("m1", "m1", session, seedOnly).again, false);
  });

  test("Up Next names the seed", () => {
    assert.equal(magicQueueLabel(session), "Magic Queue · from Seed Song");
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
  const yt = songsBy("yt:v", "Radio Artist", 40);
  const start = () => startMagicQueue(SONG_SEED, [seedSong], { id: "m1", random: first })!.session;
  /** How many of a 10-song batch (the second) come from YouTube Music. */
  const ytInBatch = (session: MagicSession): number => {
    const second = magicBatch(magicBatch(session, library, first, yt).session, library, first, yt);
    return second.trackIds.filter((id) => id.startsWith("yt:")).length;
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

  test("at All new plays only YouTube Music songs while it has them, and the Library without", () => {
    const allNew = startMagicQueue(SONG_SEED, [seedSong], {
      id: "m1",
      random: first,
      ytShare: magicQueueShare(5),
    })!.session;
    assert.equal(ytInBatch(allNew), 10);
    const offline = magicBatch(allNew, library, first);
    assert.equal(offline.trackIds.length, 9);
    assert.ok(offline.trackIds.every((id) => !id.startsWith("yt:")));
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

  test("leaves the batch to the Library without YouTube Music candidates", () => {
    const session = magicBatch(start(), library, first).session;
    const batch = magicBatch(session, library, first);
    assert.equal(batch.trackIds.length, 10);
    assert.ok(batch.trackIds.every((id) => !id.startsWith("yt:")));
  });

  test("lets either source make up for the other running short", () => {
    const fewYt = songsBy("yt:f", "Radio Artist", 2);
    const batch = magicBatch(start(), library, first, fewYt);
    assert.equal(batch.trackIds.length, 9);
    assert.equal(batch.trackIds.filter((id) => id.startsWith("yt:")).length, 2);
    const fewLibrary = [seedSong, song("l1", "Other")];
    const ytHeavy = magicBatch(start(), fewLibrary, first, yt);
    assert.equal(ytHeavy.trackIds.length, 9);
    assert.equal(ytHeavy.trackIds.filter((id) => id.startsWith("yt:")).length, 8);
  });

  test("spreads YouTube Music's songs through the Library's", () => {
    const session = magicBatch(start(), library, first, yt).session;
    const sources = magicBatch(session, library, first, yt).trackIds.map((id) =>
      id.startsWith("yt:") ? "yt" : "library",
    );
    assert.deepEqual(sources, [
      "library",
      "yt",
      "library",
      "yt",
      "library",
      "yt",
      "library",
      "yt",
      "library",
      "yt",
    ]);
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
