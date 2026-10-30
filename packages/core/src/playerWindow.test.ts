import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EMPTY_QUEUE,
  applyPlayerSync,
  keptQueue,
  keysToLoad,
  planPlayerSync,
  playerQueueWindow,
  playerRepeatMode,
  reduceQueue,
  restorePlayback,
  unsearchedTrackId,
  type PlayerList,
  type QueueState,
  type RepeatMode,
} from "./index.ts";

const context = { kind: "playlist", id: "4" } as const;

/** A queue of [size] songs named "0", "1"…, playing the one at [startIndex]. */
const queueOf = (size: number, startIndex: number): QueueState =>
  reduceQueue(EMPTY_QUEUE, {
    type: "play",
    trackIds: Array.from({ length: size }, (_, i) => String(i)),
    startIndex,
    context,
    shuffle: false,
  }).state;

describe("playerQueueWindow", () => {
  test("a 4,875-song queue holds 100 songs: 30 behind the playing one, the rest ahead", () => {
    const state = queueOf(4875, 2000);
    const list = playerQueueWindow(state)!;
    assert.equal(list.keys.length, 100);
    assert.equal(list.index, 30);
    assert.equal(list.keys[list.index], state.entries[2000]!.key);
    assert.equal(list.keys[0], state.entries[1970]!.key);
    assert.equal(list.keys[99], state.entries[2069]!.key);
  });

  test("at the queue's start nothing is behind, and at its end nothing is ahead", () => {
    const atStart = queueOf(4875, 0);
    assert.deepEqual(playerQueueWindow(atStart), {
      keys: atStart.entries.slice(0, 70).map((entry) => entry.key),
      index: 0,
    });
    const atEnd = queueOf(4875, 4874);
    assert.deepEqual(playerQueueWindow(atEnd), {
      keys: atEnd.entries.slice(4844).map((entry) => entry.key),
      index: 30,
    });
  });

  test("a queue of 100 songs loads whole, and one of 101 doesn't", () => {
    const hundred = queueOf(100, 50);
    assert.deepEqual(playerQueueWindow(hundred), {
      keys: hundred.entries.map((entry) => entry.key),
      index: 50,
    });
    // 30 behind and what's left of the 69 after it: from song 20 to the queue's end.
    assert.equal(playerQueueWindow(queueOf(101, 50))!.keys.length, 81);
  });

  test("the player holds no unsearched song, and waits while the playing one is searched", () => {
    const unsearched = unsearchedTrackId({
      title: "Touch",
      artists: ["Daft Punk"],
      album: "Random Access Memories",
      durationMs: 300_000,
      artworkUrl: null,
    });
    const trackIds = Array.from({ length: 150 }, (_, i) => (i === 1 ? unsearched : String(i)));
    const play = (startIndex: number) =>
      reduceQueue(EMPTY_QUEUE, { type: "play", trackIds, startIndex, context, shuffle: false })
        .state;
    assert.equal(playerQueueWindow(play(1)), null);
    const state = play(0);
    const list = playerQueueWindow(state)!;
    assert.equal(list.keys[1], state.entries[2]!.key);
    assert.equal(list.keys.length, 70);
  });
});

describe("the window through a repeat-all lap", () => {
  const repeating = (size: number, startIndex: number): QueueState =>
    reduceQueue(queueOf(size, startIndex), { type: "setRepeat", mode: "all" }).state;

  test("near the queue's end it wraps through the start, with 100 songs held", () => {
    const state = repeating(500, 495);
    const list = playerQueueWindow(state)!;
    assert.equal(list.keys.length, 100);
    assert.equal(list.index, 30);
    assert.equal(list.keys[34], state.entries[499]!.key);
    assert.equal(list.keys[35], state.entries[0]!.key);
    assert.equal(list.keys[99], state.entries[64]!.key);
  });

  test("near the queue's start it holds the queue's last songs behind the playing one", () => {
    const state = repeating(500, 2);
    const list = playerQueueWindow(state)!;
    assert.equal(list.keys.length, 100);
    assert.equal(list.index, 30);
    assert.equal(list.keys[0], state.entries[472]!.key);
    assert.equal(list.keys[27], state.entries[499]!.key);
    assert.equal(list.keys[28], state.entries[0]!.key);
  });

  test("a queue just over the window never holds a song twice", () => {
    const list = playerQueueWindow(repeating(101, 100))!;
    assert.equal(list.keys.length, 100);
    assert.equal(new Set(list.keys).size, 100);
  });

  test("a queue of 100 songs loads whole in its order, for the player's own repeat", () => {
    const state = repeating(100, 99);
    assert.deepEqual(playerQueueWindow(state), {
      keys: state.entries.map((entry) => entry.key),
      index: 99,
    });
  });

  test("past the last song the window offers the lap's opening song, not a lined-up one", () => {
    const lined = reduceQueue(queueOf(500, 0), { type: "playNext", trackIds: ["queued"] }).state;
    const atLast = {
      ...reduceQueue(lined, { type: "setRepeat", mode: "all" }).state,
      index: 500,
    };
    const list = playerQueueWindow(atLast)!;
    const opening = atLast.entries[0]!;
    assert.equal(list.keys[list.index + 1], opening.key);
    assert.equal(new Set(list.keys).has(atLast.entries[1]!.key), false);
  });

  test("the player moving past the last song starts the next lap in the queue's order", () => {
    const state = repeating(500, 499);
    const list = playerQueueWindow(state)!;
    const next = list.keys[list.index + 1]!;
    const moved = reduceQueue(state, { type: "playerMoved", key: next }).state;
    assert.equal(moved.index, 0);
    assert.equal(moved.entries.length, 500);
    assert.equal(moved.entries[moved.index]!.key, next);
    assert.equal(playerQueueWindow(moved)!.keys[31], moved.entries[1]!.key);
  });

  test("repeat off and repeat one don't wrap", () => {
    assert.equal(playerQueueWindow(queueOf(500, 499))!.keys.length, 31);
    const one = reduceQueue(queueOf(500, 499), { type: "setRepeat", mode: "one" }).state;
    assert.equal(playerQueueWindow(one)!.keys.length, 31);
  });
});

describe("the player's repeat mode", () => {
  const withRepeat = (size: number, mode: RepeatMode): QueueState =>
    reduceQueue(queueOf(size, 0), { type: "setRepeat", mode }).state;

  test("repeat all stays off in the player once the queue outgrows the window", () => {
    assert.equal(playerRepeatMode(withRepeat(101, "all")), "off");
    assert.equal(playerRepeatMode(withRepeat(100, "all")), "all");
  });

  test("off and one are the player's own at any length", () => {
    assert.equal(playerRepeatMode(withRepeat(4875, "one")), "one");
    assert.equal(playerRepeatMode(withRepeat(4875, "off")), "off");
  });
});

describe("moving the window with the sync plan", () => {
  const mirrored = (state: QueueState): PlayerList => {
    const list = playerQueueWindow(state)!;
    return { keys: list.keys, currentKey: list.keys[list.index]! };
  };

  /** What a sync does to the player [from] when the queue becomes [state]. */
  const syncTo = (from: PlayerList, state: QueueState) => {
    const steps = planPlayerSync(from, playerQueueWindow(state)!);
    return { steps, held: applyPlayerSync(from, steps) };
  };

  test("a song ending on its own moves the window one song, sending only the new song", () => {
    const before = queueOf(4875, 2000);
    const native = mirrored(before);
    const nextKey = before.entries[2001]!.key;
    const after = reduceQueue(before, { type: "playerMoved", key: nextKey }).state;
    const { steps, held } = syncTo({ ...native, currentKey: nextKey }, after);
    assert.deepEqual(steps, [
      { type: "edit", at: 100, removeCount: 0, insertKeys: [after.entries[2070]!.key] },
      { type: "edit", at: 0, removeCount: 1, insertKeys: [] },
    ]);
    assert.deepEqual(held.keys, mirrored(after).keys);
    assert.equal(keysToLoad(native, steps).length, 1);
  });

  test("a skip seeks inside the window, keeping the next song loaded", () => {
    const before = queueOf(4875, 2000);
    const native = mirrored(before);
    const after = reduceQueue(before, { type: "next" }).state;
    const { steps, held } = syncTo(native, after);
    assert.equal(steps[0]!.type, "seek");
    assert.ok(!steps.some((step) => step.type === "replace" || step.type === "clear"));
    assert.deepEqual(held.keys, mirrored(after).keys);
    assert.equal(held.currentKey, after.entries[2001]!.key);
  });

  test("a jump outside the window replaces it, sending that window's songs only", () => {
    const before = queueOf(4875, 2000);
    const native = mirrored(before);
    const target = before.entries[10]!.key;
    const after = reduceQueue(before, { type: "jumpTo", key: target }).state;
    const steps = planPlayerSync(native, playerQueueWindow(after)!);
    assert.equal(steps.length, 1);
    const step = steps[0]!;
    assert.equal(step.type, "replace");
    if (step.type !== "replace") return;
    assert.equal(step.keys.length, 80);
    assert.equal(step.keys[step.index], target);
    assert.equal(keysToLoad(native, steps).length, 80);
  });

  test("shuffling keeps the playing song in place and the window around it", () => {
    const before = queueOf(4875, 2000);
    const native = mirrored(before);
    const after = reduceQueue(before, { type: "setShuffle", on: true }).state;
    const { steps, held } = syncTo(native, after);
    assert.ok(!steps.some((step) => step.type === "replace" || step.type === "seek"));
    assert.deepEqual(held.keys, mirrored(after).keys);
    assert.equal(held.keys.length, 100);
    assert.equal(held.currentKey, before.entries[2000]!.key);
  });

  test("reordering Up Next keeps the window correct, also from beyond it", () => {
    const before = queueOf(4875, 2000);
    const native = mirrored(before);
    const key = before.entries[3000]!.key;
    const after = reduceQueue(before, {
      type: "move",
      key,
      after: before.entries[2000]!.key,
      before: null,
    }).state;
    const { steps, held } = syncTo(native, after);
    assert.ok(!steps.some((step) => step.type === "replace" || step.type === "seek"));
    assert.equal(held.keys[31], key);
    assert.deepEqual(held.keys, mirrored(after).keys);
  });
});

describe("picking a long queue back up", () => {
  /** What the player holds of [state]. */
  const held = (state: QueueState): readonly string[] => playerQueueWindow(state)!.keys;

  test("a player holding the window adopts all 4,875 songs on the same song", () => {
    const saved = queueOf(4875, 2000);
    const kept = keptQueue(saved, held(saved))!;
    assert.equal(kept.entries.length, 4875);
    assert.equal(kept.entries[kept.index]!.key, saved.entries[2000]!.key);
  });

  test("a window from a song or two earlier is still this queue's", () => {
    const saved = queueOf(4875, 2000);
    assert.equal(keptQueue(saved, held(queueOf(4875, 1998)))!.entries.length, 4875);
  });

  test("a Repeat All window wrapped through the queue's start is adopted", () => {
    const saved = reduceQueue(queueOf(4875, 4870), { type: "setRepeat", mode: "all" }).state;
    const kept = keptQueue(saved, held(saved))!;
    assert.equal(kept.entries.length, 4875);
    assert.equal(kept.repeat, "all");
  });

  test("a player still holding the whole queue, from before the window, adopts it", () => {
    const saved = queueOf(150, 3);
    const keys = saved.entries.map((entry) => entry.key);
    assert.equal(keptQueue(saved, keys), saved);
  });

  test("a player holding any song outside the saved queue holds something else", () => {
    const saved = queueOf(4875, 2000);
    assert.equal(keptQueue(saved, [...held(saved).slice(0, 99), "not-in-queue"]), null);
    assert.equal(keptQueue(saved, ["not-in-queue"]), null);
  });

  test("an empty player, or one holding more than a window, doesn't take the long queue", () => {
    const saved = queueOf(4875, 2000);
    assert.equal(keptQueue(saved, []), null);
    const tooMany = saved.entries.slice(0, 101).map((entry) => entry.key);
    assert.equal(keptQueue(saved, tooMany), null);
  });

  test("a queue that fits the window still needs the player's list to be exactly its own", () => {
    const saved = queueOf(100, 3);
    const keys = saved.entries.map((entry) => entry.key);
    assert.equal(keptQueue(saved, keys), saved);
    assert.equal(keptQueue(saved, keys.slice(0, 99)), null);
  });

  test("the player having gone on while JS was away moves the window without a song change", () => {
    const saved = queueOf(4875, 2000);
    const keys = held(saved);
    const kept = keptQueue(saved, keys)!;
    const moved = saved.entries[2040]!.key;
    const after = reduceQueue(kept, { type: "playerMoved", key: moved }).state;
    assert.equal(after.entries.length, 4875);
    assert.equal(after.index, 2040);
    const steps = planPlayerSync({ keys, currentKey: moved }, playerQueueWindow(after)!);
    assert.ok(steps.length > 0);
    assert.ok(steps.every((step) => step.type === "edit"));
  });

  test("a queue restored after Wave's process ended keeps every song and its place", () => {
    const saved = queueOf(4875, 2000);
    const restored = restorePlayback(saved, 61_000, () => true)!;
    assert.equal(restored.state.entries.length, 4875);
    assert.equal(restored.state.entries[restored.state.index]!.key, saved.entries[2000]!.key);
    assert.equal(restored.positionMs, 61_000);
    assert.equal(playerQueueWindow(restored.state)!.keys.length, 100);
  });
});
