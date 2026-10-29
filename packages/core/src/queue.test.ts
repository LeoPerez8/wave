import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EMPTY_QUEUE,
  currentEntry,
  nextRepeatMode,
  parseQueueState,
  queueHistory,
  reduceQueue,
  reshuffledUpNext,
  upNext,
  upNextMove,
  withPendingMoves,
} from "./index.ts";
import type { QueueCommand, QueueState } from "./index.ts";

const songs = { kind: "songs", id: null } as const;

/** Track ids in play order, the current one wrapped in brackets. */
const show = (state: QueueState): string =>
  state.entries
    .map((entry, i) => (i === state.index ? `[${entry.trackId}]` : entry.trackId))
    .join(" ");

/** Plays `trackIds` from the Songs context, starting at `startIndex`. */
const start = (trackIds: string, startIndex = 0, base: QueueState = EMPTY_QUEUE): QueueState =>
  reduceQueue(base, { type: "play", trackIds: trackIds.split(" "), startIndex, context: songs })
    .state;

describe("play", () => {
  test("starts at the tapped track and queues the rest of its context after it", () => {
    const { state, playback } = reduceQueue(EMPTY_QUEUE, {
      type: "play",
      trackIds: ["a", "b", "c", "d"],
      startIndex: 2,
      context: songs,
    });
    assert.equal(show(state), "a b [c] d");
    assert.equal(currentEntry(state)?.trackId, "c");
    assert.deepEqual(
      upNext(state).map((entry) => entry.trackId),
      ["d"],
    );
    assert.equal(playback, "play");
  });
});

describe("next", () => {
  test("moves to the following entry and keeps playback as it was", () => {
    const { state, playback } = reduceQueue(start("a b c"), { type: "next" });
    assert.equal(show(state), "a [b] c");
    assert.equal(playback, "keep");
  });

  test("stops on the last entry when the queue runs out with repeat off", () => {
    const last = start("a b c", 2);
    const { state, playback } = reduceQueue(last, { type: "next" });
    assert.equal(show(state), "a b [c]");
    assert.equal(playback, "stop");
  });
});

/** Applies commands in order, returning the final state. */
const apply = (state: QueueState, ...commands: QueueCommand[]): QueueState =>
  commands.reduce((current, command) => reduceQueue(current, command).state, state);

describe("repeat", () => {
  test("repeat all wraps from the last entry to the first", () => {
    const last = apply(start("a b c", 2), { type: "setRepeat", mode: "all" });
    const { state, playback } = reduceQueue(last, { type: "next" });
    assert.equal(show(state), "[a] b c");
    assert.equal(state.repeat, "all");
    assert.equal(playback, "keep");
  });

  test("wrapping around drops lined-up tracks that already played", () => {
    const state = apply(
      start("a b c", 1),
      { type: "playNext", trackIds: ["x"] },
      { type: "setRepeat", mode: "all" },
      { type: "next" },
      { type: "next" },
      { type: "trackEnded" },
    );
    assert.equal(show(state), "[a] b c");
  });

  test("repeat one keeps the current entry when it ends", () => {
    const one = apply(start("a b c", 1), { type: "setRepeat", mode: "one" });
    const { state, playback } = reduceQueue(one, { type: "trackEnded" });
    assert.equal(show(state), "a [b] c");
    assert.equal(playback, "keep");
  });

  test("repeat one still lets next and previous move, like repeat off", () => {
    const one = apply(start("a b c", 1), { type: "setRepeat", mode: "one" });
    assert.equal(show(apply(one, { type: "next" })), "a b [c]");
    assert.equal(show(apply(one, { type: "previous", positionMs: 0 })), "[a] b c");
    assert.equal(reduceQueue(apply(one, { type: "next" }), { type: "next" }).playback, "stop");
  });
});

describe("previous", () => {
  test("restarts the current entry when more than 3 seconds have played", () => {
    const playing = start("a b c", 1);
    const { state, playback } = reduceQueue(playing, { type: "previous", positionMs: 3001 });
    assert.equal(state, playing);
    assert.equal(playback, "restart");
  });

  test("goes to the previous entry within the first 3 seconds", () => {
    const { state, playback } = reduceQueue(start("a b c", 1), {
      type: "previous",
      positionMs: 3000,
    });
    assert.equal(show(state), "[a] b c");
    assert.equal(playback, "keep");
  });

  test("restarts the first entry, unless repeat all wraps to the last", () => {
    assert.equal(
      reduceQueue(start("a b c"), { type: "previous", positionMs: 0 }).playback,
      "restart",
    );
    const all = apply(start("a b c"), { type: "setRepeat", mode: "all" });
    assert.equal(show(apply(all, { type: "previous", positionMs: 0 })), "a b [c]");
  });
});

describe("Play Next and Add to Queue", () => {
  test("Play Next lines tracks up right after the current entry", () => {
    const state = apply(
      start("a b c", 1),
      { type: "playNext", trackIds: ["x", "y"] },
      { type: "playNext", trackIds: ["p"] },
    );
    assert.equal(show(state), "a [b] p x y c");
  });

  test("Add to Queue goes after the tracks already lined up, before the rest of the context", () => {
    const state = apply(
      start("a b c", 1),
      { type: "addToQueue", trackIds: ["x"] },
      { type: "addToQueue", trackIds: ["y", "z"] },
    );
    assert.equal(show(state), "a [b] x y z c");
  });

  test("queued entries are not part of the context", () => {
    const state = apply(start("a b"), { type: "playNext", trackIds: ["x"] });
    assert.deepEqual(
      state.entries.map((entry) => entry.contextIndex),
      [0, null, 1],
    );
  });

  test("every entry gets its own key, even for the same track", () => {
    const state = apply(start("a b"), { type: "addToQueue", trackIds: ["a", "a"] });
    assert.equal(new Set(state.entries.map((entry) => entry.key)).size, 4);
  });

  test("on an empty queue they start playing the tracks", () => {
    for (const type of ["playNext", "addToQueue"] as const) {
      const { state, playback } = reduceQueue(EMPTY_QUEUE, { type, trackIds: ["x", "y"] });
      assert.equal(show(state), "[x] y", type);
      assert.equal(playback, "play", type);
    }
  });
});

/** The key of the first entry for `trackId`. */
const keyOf = (state: QueueState, trackId: string): string =>
  state.entries.find((entry) => entry.trackId === trackId)!.key;

describe("jumpTo", () => {
  test("plays the entry with that key (a tap in Up Next)", () => {
    const playing = start("a b c d");
    const { state, playback } = reduceQueue(playing, { type: "jumpTo", key: keyOf(playing, "c") });
    assert.equal(show(state), "a b [c] d");
    assert.equal(playback, "play");
  });

  test("ignores a key that isn't in the queue", () => {
    const playing = start("a b c");
    assert.equal(reduceQueue(playing, { type: "jumpTo", key: "nope" }).state, playing);
  });
});

describe("Up Next editing", () => {
  test("move puts an upcoming entry at a new position in Up Next", () => {
    const playing = start("a b c d e", 1);
    assert.equal(
      show(apply(playing, { type: "move", ...upNextMove(playing, keyOf(playing, "e"), 0) })),
      "a [b] e c d",
    );
    assert.equal(
      show(apply(playing, { type: "move", ...upNextMove(playing, keyOf(playing, "c"), 9) })),
      "a [b] d e c",
    );
    assert.equal(
      show(apply(playing, { type: "move", ...upNextMove(playing, keyOf(playing, "c"), 1) })),
      "a [b] d c e",
    );
  });

  test("move leaves the current entry and history alone", () => {
    const playing = start("a b c", 1);
    for (const trackId of ["a", "b"]) {
      const moved = reduceQueue(playing, {
        type: "move",
        key: keyOf(playing, trackId),
        after: keyOf(playing, "c"),
        before: null,
      });
      assert.equal(moved.state, playing, trackId);
    }
  });

  test("remove drops an upcoming entry", () => {
    const playing = start("a b c d", 1);
    assert.equal(show(apply(playing, { type: "remove", key: keyOf(playing, "c") })), "a [b] d");
  });

  test("remove drops a played entry and keeps the current one playing", () => {
    const playing = start("a b c", 1);
    const { state } = reduceQueue(playing, { type: "remove", key: keyOf(playing, "a") });
    assert.equal(show(state), "[b] c");
    assert.equal(currentEntry(state)?.key, keyOf(playing, "b"));
  });

  test("remove leaves the current entry alone", () => {
    const playing = start("a b c", 1);
    assert.equal(reduceQueue(playing, { type: "remove", key: keyOf(playing, "b") }).state, playing);
  });
});

/** A deterministic random source (Park–Miller), so shuffles are repeatable. */
const seeded = (seed: number): (() => number) => {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
};

const shuffleOn = (state: QueueState, seed = 7): QueueState =>
  reduceQueue(state, { type: "setShuffle", on: true }, seeded(seed)).state;

const ids = (entries: readonly { trackId: string }[]): string[] =>
  entries.map((entry) => entry.trackId);

describe("shuffle", () => {
  const tracks = "a b c d e f g h i j";

  test("keeps History and the current track where they are, and shuffles only Up Next", () => {
    const playing = start(tracks, 2);
    const { state, playback } = reduceQueue(playing, { type: "setShuffle", on: true }, seeded(3));
    assert.equal(state.shuffle, true);
    assert.deepEqual(queueHistory(state), queueHistory(playing));
    assert.equal(state.index, 2);
    assert.equal(currentEntry(state)?.key, currentEntry(playing)?.key);
    assert.deepEqual(ids(upNext(state)).toSorted(), ["d", "e", "f", "g", "h", "i", "j"]);
    assert.notDeepEqual(ids(upNext(state)), ["d", "e", "f", "g", "h", "i", "j"]);
    assert.equal(playback, "keep");
  });

  test("shuffles lined-up tracks in with the rest of Up Next", () => {
    const queued = apply(start(tracks, 2), { type: "addToQueue", trackIds: ["x", "y"] });
    const spots = new Set(
      [1, 2, 3, 4, 5, 6, 7, 8].map((n) => ids(upNext(shuffleOn(queued, n * 7919))).indexOf("x")),
    );
    assert.ok(spots.size > 1);
    assert.deepEqual(ids(upNext(shuffleOn(queued))).toSorted(), "d e f g h i j x y".split(" "));
  });

  test("turning it off puts lined-up tracks back right after the current one", () => {
    const queued = apply(start("a b c d e", 2), { type: "addToQueue", trackIds: ["x", "y"] });
    const restored = apply(shuffleOn(queued), { type: "setShuffle", on: false });
    assert.match(show(restored), /^a b \[c\] (x y|y x) d e$/);
  });

  test("leaves lined-up tracks that already played in History, out of Up Next", () => {
    const played = apply(
      start(tracks, 2),
      { type: "playNext", trackIds: ["x"] },
      { type: "next" },
      { type: "next" },
    );
    const state = shuffleOn(played);
    assert.deepEqual(ids(queueHistory(state)), ["a", "b", "c", "x"]);
    assert.ok(!ids(upNext(state)).includes("x"));
  });

  test("turning it off keeps History as played and the songs not played yet in context order", () => {
    const shuffled = apply(shuffleOn(start(tracks, 2)), { type: "next" }, { type: "next" });
    const history = ids(queueHistory(shuffled));
    const current = currentEntry(shuffled)!;
    const { state, playback } = reduceQueue(shuffled, { type: "setShuffle", on: false });
    assert.equal(state.shuffle, false);
    assert.deepEqual(ids(queueHistory(state)), history);
    assert.equal(currentEntry(state)?.key, current.key);
    const notPlayed = tracks
      .split(" ")
      .filter((id) => !history.includes(id) && id !== current.trackId);
    assert.deepEqual(ids(upNext(state)), notPlayed);
    assert.equal(playback, "keep");
  });

  test("turning it off keeps lined-up tracks next and removed tracks gone", () => {
    const shuffled = shuffleOn(start("a b c d e", 2));
    const edited = apply(
      shuffled,
      { type: "remove", key: keyOf(shuffled, "d") },
      { type: "playNext", trackIds: ["x"] },
    );
    assert.equal(show(apply(edited, { type: "setShuffle", on: false })), "a b [c] x e");
  });

  test("turning it off while a lined-up track plays keeps it playing after History", () => {
    const shuffled = shuffleOn(start("a b c d e", 2));
    const [before, after] = ids(upNext(shuffled));
    const queuedPlaying = apply(
      shuffled,
      { type: "next" },
      { type: "playNext", trackIds: ["x"] },
      { type: "next" },
    );
    const state = apply(queuedPlaying, { type: "setShuffle", on: false });
    assert.equal(currentEntry(state)?.trackId, "x");
    assert.equal(show(state), `a b c ${before} [x] ${after}`);
  });

  test("playing with shuffle starts at the tapped track and shuffles the rest", () => {
    const { state } = reduceQueue(
      EMPTY_QUEUE,
      { type: "play", trackIds: tracks.split(" "), startIndex: 4, context: songs, shuffle: true },
      seeded(11),
    );
    assert.equal(state.shuffle, true);
    assert.equal(show(state).split(" ")[0], "[e]");
    assert.equal(state.entries.length, 10);
  });

  test("an album's Shuffle button starts anywhere, and the setting carries over", () => {
    const { state } = reduceQueue(
      EMPTY_QUEUE,
      { type: "play", trackIds: tracks.split(" "), context: songs, shuffle: true },
      seeded(5),
    );
    assert.equal(state.index, 0);
    assert.deepEqual(ids(state.entries).toSorted(), tracks.split(" "));
    const next = reduceQueue(state, {
      type: "play",
      trackIds: ["p", "q", "r"],
      startIndex: 1,
      context: songs,
    }).state;
    assert.equal(next.shuffle, true);
    assert.equal(show(next).split(" ")[0], "[q]");
  });

  test("unshuffling a context started on Shuffle restores its order", () => {
    const { state } = reduceQueue(
      EMPTY_QUEUE,
      { type: "play", trackIds: tracks.split(" "), context: songs, shuffle: true },
      seeded(5),
    );
    assert.deepEqual(
      ids(apply(state, { type: "setShuffle", on: false }).entries),
      tracks.split(" "),
    );
  });
});

describe("playerMoved", () => {
  test("follows the player to the entry it moved to on its own", () => {
    const playing = start("a b c d");
    const { state, playback } = reduceQueue(playing, {
      type: "playerMoved",
      key: keyOf(playing, "c"),
    });
    assert.equal(show(state), "a b [c] d");
    assert.equal(playback, "keep");
  });

  test("treats the player wrapping around as a repeat-all wrap", () => {
    const wrapped = apply(
      start("a b", 1),
      { type: "playNext", trackIds: ["x"] },
      { type: "setRepeat", mode: "all" },
      { type: "next" },
    );
    const state = apply(wrapped, { type: "playerMoved", key: keyOf(wrapped, "a") });
    assert.equal(show(state), "[a] b");
  });

  test("ignores the entry already current and keys it doesn't know", () => {
    const playing = start("a b");
    assert.equal(apply(playing, { type: "playerMoved", key: keyOf(playing, "a") }), playing);
    assert.equal(apply(playing, { type: "playerMoved", key: "nope" }), playing);
  });
});

describe("parseQueueState", () => {
  test("restores a queue saved as JSON", () => {
    const saved = apply(
      shuffleOn(start("a b c d", 1)),
      { type: "addToQueue", trackIds: ["x"] },
      { type: "setRepeat", mode: "one" },
    );
    assert.deepEqual(parseQueueState(JSON.parse(JSON.stringify(saved))), saved);
  });

  test("keeps handing out fresh keys after a restore", () => {
    const saved = start("a b");
    const restored = parseQueueState(JSON.parse(JSON.stringify(saved)))!;
    const next = apply(restored, { type: "addToQueue", trackIds: ["c"] });
    assert.equal(new Set(next.entries.map((entry) => entry.key)).size, 3);
  });

  test("rejects anything that isn't a valid queue", () => {
    const valid = JSON.parse(JSON.stringify(start("a b"))) as Record<string, unknown>;
    const broken: unknown[] = [
      null,
      "queue",
      {},
      { ...valid, index: 2 },
      { ...valid, repeat: "sometimes" },
      { ...valid, shuffle: "yes" },
      { ...valid, entries: [{ key: "1", trackId: 3, contextIndex: 0 }] },
      {
        ...valid,
        entries: [...(valid["entries"] as unknown[]), (valid["entries"] as unknown[])[0]],
      },
      { ...valid, context: { kind: 1 } },
      { ...valid, nextKey: "3" },
    ];
    for (const value of broken) assert.equal(parseQueueState(value), null, JSON.stringify(value));
  });

  test("accepts an empty queue", () => {
    assert.deepEqual(parseQueueState(JSON.parse(JSON.stringify(EMPTY_QUEUE))), EMPTY_QUEUE);
  });
});

describe("trackEnded", () => {
  test("moves on to the next entry", () => {
    assert.equal(show(apply(start("a b c"), { type: "trackEnded" })), "a [b] c");
  });

  test("stops after the last entry with repeat off and wraps with repeat all", () => {
    assert.equal(reduceQueue(start("a b", 1), { type: "trackEnded" }).playback, "stop");
    const all = apply(start("a b", 1), { type: "setRepeat", mode: "all" });
    assert.equal(show(apply(all, { type: "trackEnded" })), "[a] b");
  });
});

describe("nextRepeatMode", () => {
  test("cycles off, all, one, then back to off", () => {
    assert.equal(nextRepeatMode("off"), "all");
    assert.equal(nextRepeatMode("all"), "one");
    assert.equal(nextRepeatMode("one"), "off");
  });
});

describe("removeTracks (deleted songs)", () => {
  test("drops every entry of the tracks, played, queued or upcoming, and keeps playing", () => {
    const playing = apply(start("a b c d", 1), { type: "addToQueue", trackIds: ["d"] });
    const { state, playback } = reduceQueue(playing, {
      type: "removeTracks",
      trackIds: ["a", "d"],
    });
    assert.equal(show(state), "[b] c");
    assert.equal(currentEntry(state)?.key, keyOf(playing, "b"));
    assert.equal(playback, "keep");
  });

  test("deleting the current track moves on to the next one", () => {
    const playing = start("a b c", 1);
    const { state, playback } = reduceQueue(playing, { type: "removeTracks", trackIds: ["b"] });
    assert.equal(show(state), "a [c]");
    assert.equal(playback, "keep");
  });

  test("with repeat one, deleting the current track still moves on", () => {
    const playing = apply(start("a b c", 1), { type: "setRepeat", mode: "one" });
    assert.equal(show(apply(playing, { type: "removeTracks", trackIds: ["b"] })), "a [c]");
  });

  test("deleting the last track with nothing after it stops on the one before", () => {
    const { state, playback } = reduceQueue(start("a b c", 2), {
      type: "removeTracks",
      trackIds: ["c"],
    });
    assert.equal(show(state), "a [b]");
    assert.equal(playback, "stop");
  });

  test("with repeat all, deleting the last track wraps to the first", () => {
    const last = apply(start("a b c", 2), { type: "setRepeat", mode: "all" });
    const { state, playback } = reduceQueue(last, { type: "removeTracks", trackIds: ["c"] });
    assert.equal(show(state), "[a] b");
    assert.equal(playback, "keep");
  });

  test("deleting every track empties the queue", () => {
    const { state } = reduceQueue(start("a b", 0), { type: "removeTracks", trackIds: ["a", "b"] });
    assert.deepEqual(state.entries, []);
    assert.equal(state.index, -1);
    assert.equal(currentEntry(state), null);
  });

  test("tracks the queue doesn't hold change nothing", () => {
    const playing = start("a b c", 1);
    const { state, playback } = reduceQueue(playing, { type: "removeTracks", trackIds: ["x"] });
    assert.equal(state, playing);
    assert.equal(playback, "keep");
  });
});

describe("withPendingMoves", () => {
  test("shows a dropped move before the queue has it, and the same order once it does", () => {
    const playing = start("a b c d e", 1);
    const move = upNextMove(playing, keyOf(playing, "e"), 0);
    assert.equal(show(withPendingMoves(playing, [move])), "a [b] e c d");
    const landed = apply(playing, { type: "move", ...move });
    assert.equal(show(withPendingMoves(landed, [move])), "a [b] e c d");
  });

  test("a track change before or after the queue takes the move keeps the dropped order", () => {
    const playing = start("a b c d e", 1);
    // e dropped between c and d.
    const move = upNextMove(playing, keyOf(playing, "e"), 1);
    assert.equal(show(withPendingMoves(playing, [move])), "a [b] c e d");
    const advanced = apply(playing, { type: "next" });
    assert.equal(show(withPendingMoves(advanced, [move])), "a b [c] e d");
    const landedAfter = apply(advanced, { type: "move", ...move });
    assert.equal(show(landedAfter), "a b [c] e d");
    const advancedAfter = apply(playing, { type: "move", ...move }, { type: "next" });
    assert.equal(show(withPendingMoves(advancedAfter, [move])), "a b [c] e d");
  });

  test("a neighbour removed before the queue takes the move keeps it beside the other one", () => {
    const playing = start("a b c d e", 1);
    const move = upNextMove(playing, keyOf(playing, "e"), 1);
    const removed = apply(playing, { type: "remove", key: keyOf(playing, "c") });
    assert.equal(show(withPendingMoves(removed, [move])), "a [b] e d");
    assert.equal(show(apply(removed, { type: "move", ...move })), "a [b] e d");
  });
});

describe("queueHistory", () => {
  const tracks = "a b c d e";

  test("holds the entries behind the current one, oldest first", () => {
    assert.deepEqual(ids(queueHistory(start(tracks, 2))), ["a", "b"]);
    assert.deepEqual(queueHistory(start(tracks)), []);
    assert.deepEqual(queueHistory(EMPTY_QUEUE), []);
  });

  test("stays as it is when shuffle turns on", () => {
    assert.deepEqual(ids(queueHistory(shuffleOn(start(tracks, 2)))), ["a", "b"]);
  });

  test("stays as played, out of context order too, when shuffle turns off", () => {
    const shuffled = apply(shuffleOn(start(tracks)), { type: "next" }, { type: "next" });
    const played = ids(queueHistory(shuffled));
    assert.notDeepEqual(played, ["a", "b"]);
    const off = apply(shuffled, { type: "setShuffle", on: false });
    assert.deepEqual(ids(queueHistory(off)), played);
    assert.equal(currentEntry(off)?.key, currentEntry(shuffled)?.key);
  });

  test("empties when Repeat All wraps", () => {
    const wrapped = apply(start(tracks, 4), { type: "setRepeat", mode: "all" }, { type: "next" });
    assert.deepEqual(queueHistory(wrapped), []);
  });

  test("takes the entries a jump ahead skipped over", () => {
    const playing = start(tracks);
    const jumped = apply(playing, { type: "jumpTo", key: keyOf(playing, "d") });
    assert.deepEqual(ids(queueHistory(jumped)), ["a", "b", "c"]);
  });

  test("gives back to Up Next the entries after one jumped back to", () => {
    const playing = start(tracks, 3);
    const back = apply(playing, { type: "jumpTo", key: keyOf(playing, "b") });
    assert.deepEqual(ids(queueHistory(back)), ["a"]);
    assert.deepEqual(ids(upNext(back)), ["c", "d", "e"]);
  });
});

/** Applies commands in order with one seeded random source, returning the final state. */
const run = (state: QueueState, seed: number, ...commands: QueueCommand[]): QueueState => {
  const random = seeded(seed);
  return commands.reduce((current, command) => reduceQueue(current, command, random).state, state);
};

/** Moves on with `next` until the last entry plays. */
const toLast = (state: QueueState): QueueState => {
  let at = state;
  while (at.index < at.entries.length - 1) at = apply(at, { type: "next" });
  return at;
};

describe("Repeat All's next lap after a shuffle toggle", () => {
  const tracks = "a b c d e f g h i j";
  const album = tracks.split(" ");

  /** Shuffle on from f with Repeat All, played to the last song: History holds a–e in album order. */
  const onMidAlbum = (seed: number): QueueState =>
    toLast(
      run(
        start(tracks, 5),
        seed,
        { type: "setRepeat", mode: "all" },
        { type: "setShuffle", on: true },
      ),
    );

  /** Shuffle on from the start, 5 songs played, then shuffle off: History holds 5 shuffled songs. */
  const offAfterShuffle = (seed: number): QueueState => {
    const shuffled = reduceQueue(
      EMPTY_QUEUE,
      { type: "play", trackIds: album, context: songs, shuffle: true },
      seeded(seed),
    ).state;
    const played = apply(
      shuffled,
      { type: "setRepeat", mode: "all" },
      ...Array.from({ length: 5 }, () => ({ type: "next" }) as const),
      { type: "setShuffle", on: false },
    );
    assert.notDeepEqual(ids(queueHistory(played)), album.slice(0, 5));
    return toLast(played);
  };

  test("with shuffle turned on mid-album, the next lap is a new shuffle, not History's album order", () => {
    const orders = new Set<string>();
    for (const seed of [3, 7, 11, 19, 23]) {
      const last = onMidAlbum(seed);
      for (const command of [{ type: "next" }, { type: "trackEnded" }] as const) {
        const { state, playback } = reduceQueue(last, command, seeded(seed + 1));
        assert.equal(state.shuffle, true);
        assert.equal(state.index, 0);
        assert.equal(playback, "keep");
        assert.deepEqual(ids(state.entries).toSorted(), album);
        assert.notDeepEqual(ids(state.entries).slice(0, 5), album.slice(0, 5), `seed ${seed}`);
        orders.add(ids(state.entries).join(" "));
      }
    }
    assert.ok(orders.size > 1);
  });

  test("with shuffle turned off, the next lap plays in the context's order", () => {
    for (const seed of [3, 7, 11]) {
      const last = offAfterShuffle(seed);
      assert.equal(show(apply(last, { type: "next" })), `[a] ${album.slice(1).join(" ")}`);
      assert.equal(show(apply(last, { type: "trackEnded" })), `[a] ${album.slice(1).join(" ")}`);
    }
  });

  test("the player wrapping by itself opens the lap with History's first song, the rest as shuffle says", () => {
    const off = offAfterShuffle(5);
    const first = off.entries[0]!;
    const wrappedOff = apply(off, { type: "playerMoved", key: first.key });
    assert.equal(currentEntry(wrappedOff)?.key, first.key);
    assert.equal(wrappedOff.index, 0);
    assert.deepEqual(
      ids(upNext(wrappedOff)),
      album.filter((id) => id !== first.trackId),
    );

    const on = onMidAlbum(5);
    const wrappedOn = run(on, 9, { type: "playerMoved", key: keyOf(on, "a") });
    assert.equal(show(wrappedOn).split(" ")[0], "[a]");
    assert.deepEqual(ids(wrappedOn.entries).toSorted(), album);
    assert.notDeepEqual(ids(upNext(wrappedOn)), album.slice(1));
  });

  test("lined-up songs that played still drop out of the lap", () => {
    const queued = apply(onMidAlbum(5), { type: "playNext", trackIds: ["x"] }, { type: "next" });
    const { state } = reduceQueue(queued, { type: "next" }, seeded(2));
    assert.deepEqual(ids(state.entries).toSorted(), album);
  });

  test("deleting the last song with shuffle off wraps to the context's order", () => {
    const last = offAfterShuffle(7);
    const { state } = reduceQueue(last, {
      type: "removeTracks",
      trackIds: [currentEntry(last)!.trackId],
    });
    assert.equal(state.index, 0);
    assert.deepEqual(
      ids(state.entries),
      album.filter((id) => id !== currentEntry(last)!.trackId),
    );
  });
});

/** [command] on [state], with the state it leads to. */
const step = (state: QueueState, command: QueueCommand) => ({
  state,
  command,
  after: reduceQueue(state, command, seeded(3)).state,
});

/** What `reshuffledUpNext` says of [a step](step). */
const says = ({ state, command, after }: ReturnType<typeof step>): boolean =>
  reshuffledUpNext(state, command, after);

describe("reshuffledUpNext", () => {
  const playing = start("a b c d e", 1);

  test("a shuffle toggle either way reorders Up Next", () => {
    const on = step(playing, { type: "setShuffle", on: true });
    assert.equal(says(on), true);
    assert.equal(says(step(on.after, { type: "setShuffle", on: false })), true);
  });

  test("a kind picked on the shuffle card does, the one already chosen too", () => {
    const shuffled = step(playing, { type: "setShuffle", on: true }).after;
    assert.equal(says(step(playing, { type: "reshuffle" })), true);
    assert.equal(says(step(shuffled, { type: "reshuffle" })), true);
  });

  test("a toggle to what shuffle already is, or any other command, doesn't", () => {
    assert.equal(says(step(playing, { type: "setShuffle", on: false })), false);
    assert.equal(says(step(playing, { type: "next" })), false);
    assert.equal(says(step(playing, { type: "addToQueue", trackIds: ["x"] })), false);
    const play = { type: "play", trackIds: ["p", "q"], context: songs, shuffle: true } as const;
    assert.equal(says(step(playing, play)), false);
  });
});
