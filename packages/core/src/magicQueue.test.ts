import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EMPTY_QUEUE,
  MAGIC_QUEUE_CONTEXT,
  magicBatch,
  magicQueueEdits,
  magicQueueLabel,
  magicSignal,
  magicPlaySignal,
  parseMagicSession,
  reduceQueue,
  startMagicQueue,
  wantsMagicBatch,
  type MagicSeed,
  type MagicSession,
  type MagicSong,
  type QueueCommand,
  type QueueState,
} from "./index.ts";

/** The luckiest draw: each pick lands on the heaviest song left. */
const first = () => 0;

const song = (trackId: string, artist: string, genre: string | null = "Rock"): MagicSong => ({
  trackId,
  artists: [artist],
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

describe("How a play ends, as a Magic Queue signal", () => {
  test("skipped within the first 30 s is a skip", () => {
    assert.equal(magicPlaySignal({ endReason: "skipped", listenedMs: 29_999 }), "skip");
  });

  test("skipped after 30 s is neutral", () => {
    assert.equal(magicPlaySignal({ endReason: "skipped", listenedMs: 30_000 }), null);
  });

  test("played to the end is positive", () => {
    assert.equal(magicPlaySignal({ endReason: "completed", listenedMs: 200_000 }), "playedThrough");
  });

  test("stopped or interrupted says nothing", () => {
    assert.equal(magicPlaySignal({ endReason: "stopped", listenedMs: 1_000 }), null);
    assert.equal(magicPlaySignal({ endReason: "interrupted", listenedMs: 1_000 }), null);
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

  test("Up Next names the seed", () => {
    assert.equal(magicQueueLabel(session), "Magic Queue · from Seed Song");
  });

  test("a session reads back as it was saved", () => {
    const learned = magicSignal(session, { kind: "skip", song: song("z", "Zed", "Ska") });
    assert.deepEqual(parseMagicSession(JSON.parse(JSON.stringify(learned))), learned);
    assert.equal(parseMagicSession({ id: "m1" }), null);
    assert.equal(parseMagicSession(null), null);
  });
});
