import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { catalogueOf } from "./localisation.ts";
import {
  EMPTY_QUEUE,
  newQueueToast,
  noticeLine,
  queueUndo,
  reduceQueue,
  undoneQueue,
} from "./index.ts";
import type { QueueCommand, QueueState } from "./index.ts";

const album = { kind: "album", id: "7" } as const;
const songs = { kind: "songs", id: null } as const;

const playAlbum: QueueCommand = { type: "play", trackIds: ["x", "y"], context: album };

/** The Songs list playing "b" of "a b c", with "q" added to the queue. */
const playing: QueueState = [
  { type: "play", trackIds: ["a", "b", "c"], startIndex: 1, context: songs },
  { type: "addToQueue", trackIds: ["q"] },
].reduce<QueueState>(
  (state, command) => reduceQueue(state, command as QueueCommand).state,
  EMPTY_QUEUE,
);

/** The player on the playing queue's song ("b", key 2), 73 s in. */
const onB = { key: "2", positionMs: 73_000 };

describe("queueUndo", () => {
  test("a play over a queue with a song current offers going back to it, where its song was", () => {
    assert.deepEqual(queueUndo(playing, playAlbum, onB, reduceQueue(playing, playAlbum)), {
      state: playing,
      positionMs: 73_000,
    });
  });

  test("Play Downloaded Songs' Library songs played next offer going back to the queue as it was", () => {
    const command: QueueCommand = { type: "playNow", trackIds: ["x", "y"], newQueue: true };
    const after = reduceQueue(playing, command);
    const undo = queueUndo(playing, command, onB, after);
    assert.deepEqual(undo, { state: playing, positionMs: 73_000 });
    assert.deepEqual(undoneQueue(undo!, after.state).entries, playing.entries);
    assert.equal(undoneQueue(undo!, after.state).index, playing.index);
    // A related song played now is no new queue.
    const related: QueueCommand = { type: "playNow", trackIds: ["x"] };
    assert.equal(queueUndo(playing, related, onB, reduceQueue(playing, related)), null);
  });

  test("goes back to the start of the song when the player is on another one", () => {
    // The player went on to "q" while a search held the queue on "b".
    assert.deepEqual(
      queueUndo(
        playing,
        playAlbum,
        { key: "4", positionMs: 12_000 },
        reduceQueue(playing, playAlbum),
      ),
      {
        state: playing,
        positionMs: 0,
      },
    );
  });

  test("marks a Magic Queue from the current song for playback-preserving Undo", () => {
    const command: QueueCommand = {
      type: "play",
      trackIds: ["b"],
      context: { kind: "magic", id: "session" },
      keepCurrentAndReplaceUpNext: { trackId: "b" },
    };
    assert.deepEqual(queueUndo(playing, command, onB, reduceQueue(playing, command)), {
      state: playing,
      positionMs: 73_000,
      keepPlayback: true,
    });
  });

  test("the first play offers nothing: there's no queue to go back to", () => {
    assert.equal(queueUndo(EMPTY_QUEUE, playAlbum, onB, reduceQueue(EMPTY_QUEUE, playAlbum)), null);
  });

  test("a play of nothing offers nothing: no new queue plays", () => {
    const command: QueueCommand = { type: "play", trackIds: [], context: album };
    assert.equal(queueUndo(playing, command, onB, reduceQueue(playing, command)), null);
  });

  test("a play whose every song is passed over offers nothing: the queue stays", () => {
    const explicit = (trackId: string): boolean => trackId === "x" || trackId === "y";
    assert.equal(
      queueUndo(
        playing,
        playAlbum,
        onB,
        reduceQueue(playing, playAlbum, undefined, undefined, explicit),
        explicit,
      ),
      null,
    );
    const one = (trackId: string): boolean => trackId === "x";
    assert.deepEqual(
      queueUndo(
        playing,
        playAlbum,
        onB,
        reduceQueue(playing, playAlbum, undefined, undefined, one),
        one,
      ),
      { state: playing, positionMs: 73_000 },
    );
  });

  test("only a play offers it, not changes to the same queue", () => {
    assert.equal(
      queueUndo(playing, { type: "next" }, onB, reduceQueue(playing, { type: "next" })),
      null,
    );
    const command: QueueCommand = { type: "playNext", trackIds: ["x"] };
    assert.equal(queueUndo(playing, command, onB, reduceQueue(playing, command)), null);
  });
});

describe("undoneQueue", () => {
  test("goes back to the replaced queue as it was: its entries, keys, song and modes", () => {
    const replaced = { ...playing, shuffle: true, repeat: "all" } satisfies QueueState;
    const now = reduceQueue(replaced, playAlbum).state;
    const back = undoneQueue({ state: replaced, positionMs: 73_000 }, now);
    assert.deepEqual({ ...back, nextKey: 0 }, { ...replaced, nextKey: 0 });
  });

  test("keeps counting keys past the new queue's, so no entry added later reuses one", () => {
    // "a b c" took keys 1-3, "q" 4, the album's "x y" 5-6.
    const now = reduceQueue(playing, playAlbum).state;
    const back = undoneQueue({ state: playing, positionMs: 0 }, now);
    assert.equal(back.nextKey, 7);
    const added = reduceQueue(back, { type: "addToQueue", trackIds: ["z"] }).state;
    assert.equal(added.entries.find((entry) => entry.trackId === "z")?.key, "7");
  });

  test("restores a Magic Queue's previous queue without changing the kept entry", () => {
    const before = { ...playing, shuffle: true, repeat: "all" } satisfies QueueState;
    const command: QueueCommand = {
      type: "play",
      context: { kind: "magic", id: "session" },
      keepCurrentAndReplaceUpNext: { trackId: "b" },
      trackIds: ["b", "r1", "r2"],
    };
    const started = reduceQueue(before, command).state;
    const undo = queueUndo(before, command, onB, reduceQueue(before, command))!;
    const restored = undoneQueue(undo, started);
    assert.deepEqual(
      { ...restored, nextKey: before.nextKey },
      { ...before, nextKey: before.nextKey },
    );
    assert.equal(restored.nextKey, started.nextKey);
  });

  test("keeps a played recommendation current and puts the previous Up Next after it", () => {
    const before = { ...playing, shuffle: true, repeat: "all" } satisfies QueueState;
    const command: QueueCommand = {
      type: "play",
      context: { kind: "magic", id: "session" },
      keepCurrentAndReplaceUpNext: { trackId: "b" },
      trackIds: ["b", "r1", "r2"],
    };
    const started = reduceQueue(before, command).state;
    const advanced = reduceQueue(started, { type: "next" }).state;
    const undo = queueUndo(before, command, onB, reduceQueue(before, command))!;
    const restored = undoneQueue(undo, advanced);
    const expected = {
      ...advanced,
      context: before.context,
      entries: [
        ...advanced.entries.slice(0, advanced.index + 1),
        ...before.entries.slice(before.index + 1),
      ],
      shuffle: before.shuffle,
      repeat: before.repeat,
      nextKey: advanced.nextKey,
    };
    assert.deepEqual(restored, expected);
  });

  test("does not mark Undo playback-preserving when the reducer replaced the queue", () => {
    const before = playing;
    const command: QueueCommand = {
      type: "play",
      trackIds: ["x", "y"],
      context: { kind: "magic", id: "session" },
      keepCurrentAndReplaceUpNext: { trackId: "not-current" },
    };
    assert.deepEqual(queueUndo(before, command, onB, reduceQueue(before, command)), {
      state: before,
      positionMs: 73_000,
    });
  });

  test("restores the whole old queue when Undo follows a move back into History", () => {
    const before = { ...playing, shuffle: true, repeat: "all" } satisfies QueueState;
    const command: QueueCommand = {
      type: "play",
      trackIds: ["b", "r1", "r2"],
      context: { kind: "magic", id: "session" },
      keepCurrentAndReplaceUpNext: { trackId: "b" },
    };
    const started = reduceQueue(before, command).state;
    const backInHistory = reduceQueue(started, {
      type: "jumpTo",
      key: before.entries[0]!.key,
    }).state;
    const undo = queueUndo(before, command, onB, reduceQueue(before, command))!;

    assert.deepEqual(
      { ...undoneQueue(undo, backInHistory), nextKey: before.nextKey },
      { ...before, nextKey: before.nextKey },
    );
  });
});

describe("newQueueToast", () => {
  test("says a new queue is playing", () => {
    assert.equal(newQueueToast("play", []), "New queue playing");
    assert.equal(newQueueToast("play", [null, null]), "New queue playing");
  });

  test("says it in Portuguese for an app in pt-BR", () => {
    assert.equal(
      newQueueToast(
        "play",
        [null, `"Airbag" foi pulada: não encontrada online.`],
        catalogueOf("pt-BR"),
      ),
      `Nova fila em reprodução · "Airbag" foi pulada: não encontrada online.`,
    );
  });

  test("says why a song was skipped on the way along with it", () => {
    assert.equal(
      newQueueToast("play", [null, `Skipped "Airbag": not found online.`]),
      `New queue playing · Skipped "Airbag": not found online.`,
    );
  });

  test("says nothing of a new queue when nothing plays: every song was skipped", () => {
    assert.equal(newQueueToast("stop", [`Skipped "Airbag": you're offline.`]), null);
  });

  test("says every notice of the way, in order", () => {
    assert.equal(
      newQueueToast("play", [
        "Skipped “Airbag”: it's explicit.",
        "Skipped “Lucky”: you're offline.",
      ]),
      "New queue playing · Skipped “Airbag”: it's explicit. · Skipped “Lucky”: you're offline.",
    );
  });
});

describe("noticeLine", () => {
  test("says each notice there is on one line, in order, or nothing", () => {
    assert.equal(
      noticeLine([null, "Skipped “Lucky”: you're offline."]),
      "Skipped “Lucky”: you're offline.",
    );
    assert.equal(noticeLine(["A.", null, "B."]), "A. · B.");
    assert.equal(noticeLine([null]), null);
  });
});
