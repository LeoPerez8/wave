import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EMPTY_QUEUE,
  PLAYING_SEARCHES,
  passedOverNotice,
  playerQueueList,
  playingAnswerStep,
  playingSearches,
  queuedYtTracks,
  restorableTrack,
  settleUnsearched,
  readUnsearchedTrackId,
  reduceQueue,
  unsearchedTrackId,
  type QueueState,
  type UnsearchedSong,
} from "./index.ts";

const context = { kind: "playlist", id: "4" } as const;

const listed = (title: string): UnsearchedSong => ({
  title,
  artists: ["Daft Punk"],
  album: "Random Access Memories",
  durationMs: 300_000,
  artworkUrl: "https://i.scdn.co/image/ram",
});

/** "u:Touch" stands for the unsearched song Touch, anything else for a Library or YT Music id. */
const id = (name: string): string =>
  name.startsWith("u:") ? unsearchedTrackId(listed(name.slice(2))) : name;

const play = (names: string, startIndex = 0, shuffle = false): QueueState =>
  reduceQueue(
    EMPTY_QUEUE,
    { type: "play", trackIds: names.split(" ").map(id), startIndex, context, shuffle },
    // A fixed shuffle: the same order every run.
    (() => {
      let seed = 0.37;
      return () => (seed = (seed * 9301 + 0.49297) % 1);
    })(),
  ).state;

const searched = (state: QueueState, now = 0, searching = {}): string[] =>
  playingSearches(state, searching, now).map((search) => search.trackId);

/** Track ids in play order, the current one in brackets, unsearched ones as "u:Title". */
const show = (state: QueueState): string =>
  state.entries
    .map((entry, i) => {
      const name = readUnsearchedTrackId(entry.trackId);
      const shown = name === null ? entry.trackId : `u:${name.title}`;
      return i === state.index ? `[${shown}]` : shown;
    })
    .join(" ");

describe("the queue once an unsearched song is settled", () => {
  test("found, each of its entries becomes the YT Music song, in its place and keeping its key", () => {
    const state = play("1 u:A 2 u:A", 1);
    const { state: settled, playback } = reduceQueue(state, {
      type: "settled",
      trackId: id("u:A"),
      becomes: "yt:found",
    });
    assert.equal(show(settled), "1 [yt:found] 2 yt:found");
    assert.deepEqual(
      settled.entries.map((entry) => entry.key),
      state.entries.map((entry) => entry.key),
    );
    assert.equal(playback, "keep");
  });

  test("not found, its entries leave the queue, and the next song takes the playing one's place", () => {
    const state = play("1 u:A 2 u:A 3", 1);
    assert.equal(
      show(reduceQueue(state, { type: "settled", trackId: id("u:A"), becomes: null }).state),
      "1 [2] 3",
    );
  });

  test("a song not in the queue changes nothing", () => {
    const state = play("1 2");
    const { state: same } = reduceQueue(state, {
      type: "settled",
      trackId: id("u:A"),
      becomes: null,
    });
    assert.equal(same, state);
  });
});

describe("what the player holds of a queue with unsearched songs", () => {
  test("every entry but the unsearched ones, which it can't play until they're found", () => {
    const state = play("1 u:A yt:b u:B 2", 2);
    const keys = state.entries.map((entry) => entry.key);
    assert.deepEqual(playerQueueList(state), { keys: [keys[0], keys[2], keys[4]], index: 1 });
  });

  test("found, a song's entry joins it under its own key", () => {
    const state = play("1 u:A 2", 0);
    const found = reduceQueue(state, { type: "settled", trackId: id("u:A"), becomes: "yt:a" });
    assert.deepEqual(
      playerQueueList(found.state)?.keys,
      state.entries.map((entry) => entry.key),
    );
  });

  test("with an unsearched song playing, the player waits for its search", () => {
    assert.equal(playerQueueList(play("1 u:A 2", 1)), null);
  });

  test("an empty queue is an empty player", () => {
    assert.deepEqual(playerQueueList(EMPTY_QUEUE), { keys: [], index: -1 });
  });
});

describe("the playing song's search answered", () => {
  const touch = listed("Touch");
  const found = settleUnsearched(touch, {
    ok: true,
    songs: [
      {
        videoId: "t",
        title: "Touch",
        artists: ["Daft Punk"],
        album: null,
        durationMs: 300_000,
        artworkUrl: null,
        explicit: false,
      },
    ],
  });
  const notFound = settleUnsearched(touch, { ok: true, songs: [] });
  const failed = (reason: "offline" | "failed" | "disabled") =>
    settleUnsearched(touch, { ok: false, reason });

  test("found, it plays", () => {
    assert.deepEqual(playingAnswerStep(touch, found, { chosen: true }), { kind: "play" });
  });

  test("not found, the next song plays, and a short notice names the song skipped", () => {
    for (const chosen of [true, false]) {
      assert.deepEqual(playingAnswerStep(touch, notFound, { chosen }), {
        kind: "skip",
        notice: `Skipped "Touch": it isn't on YouTube Music.`,
      });
    }
  });

  test("a failed search plays the next song with a notice, the song staying unsearched", () => {
    assert.deepEqual(playingAnswerStep(touch, failed("failed"), { chosen: true }), {
      kind: "skip",
      notice: `Skipped "Touch": YouTube Music didn't answer.`,
    });
    assert.deepEqual(playingAnswerStep(touch, failed("offline"), { chosen: false }), {
      kind: "skip",
      notice: `Skipped "Touch": you're offline.`,
    });
  });

  test("tapped offline or with YT Music off, it says what a YT Music song says, and nothing plays", () => {
    assert.deepEqual(playingAnswerStep(touch, failed("offline"), { chosen: true }), {
      kind: "stay",
      notice: "You're offline. YT Music songs need the network.",
    });
    assert.deepEqual(playingAnswerStep(touch, failed("disabled"), { chosen: true }), {
      kind: "stay",
      notice: "YT Music is off in Settings.",
    });
  });
});

describe("the player passing over a song still unsearched", () => {
  test("names the song it skipped, as a failed search does", () => {
    const before = play("1 u:Touch 2", 0);
    const after = reduceQueue(before, { type: "playerMoved", key: before.entries[2]!.key }).state;
    assert.equal(passedOverNotice(before, after), `Skipped "Touch": YouTube Music didn't answer.`);
  });

  test("several are counted, and a move back or onto the next song names none", () => {
    const before = play("1 u:A u:B 2", 0);
    const after = reduceQueue(before, { type: "playerMoved", key: before.entries[3]!.key }).state;
    assert.equal(passedOverNotice(before, after), "Skipped 2 songs: YouTube Music didn't answer.");
    assert.equal(passedOverNotice(after, before), null);
    const plain = play("1 2 3");
    assert.equal(passedOverNotice(plain, reduceQueue(plain, { type: "next" }).state), null);
  });
});

describe("a queue with unsearched songs kept while Wave is closed", () => {
  const state = play("1 u:A yt:b u:A");
  const known = new Map(
    state.entries.map((entry) => [entry.trackId, `details of ${entry.trackId}`]),
  );

  test("their details are kept with it, as a YT Music song's are, each once", () => {
    assert.deepEqual(queuedYtTracks(state.entries, known), [
      `details of ${id("u:A")}`,
      "details of yt:b",
    ]);
  });

  test("they come back with it while YT Music is on and their details were kept", () => {
    const restorable = (ytMusicOn: boolean, saved: readonly string[]) =>
      restorableTrack({ libraryIds: new Set([1]), savedYtTracks: new Set(saved), ytMusicOn });
    assert.equal(restorable(true, [id("u:A")])(id("u:A")), true);
    assert.equal(restorable(false, [id("u:A")])(id("u:A")), false);
    assert.equal(restorable(true, [])(id("u:A")), false);
  });
});

describe("the songs a queue searches as they're about to play", () => {
  test(`the playing song and the next ${PLAYING_SEARCHES - 1}, those unsearched, in play order`, () => {
    const state = play("u:A yt:c u:B u:C u:D", 0);
    assert.deepEqual(searched(state), [id("u:A"), id("u:B"), id("u:C")]);
    const later = play("1 u:A 2 u:B", 1);
    assert.deepEqual(searched(later), [id("u:A"), id("u:B")]);
  });

  test("each search has the playing priority and asks the song's title and artists", () => {
    const [search] = playingSearches(play("u:Touch"), {}, 0);
    assert.deepEqual(search, {
      trackId: id("u:Touch"),
      song: { ...listed("Touch"), artworkUrl: null },
      query: "Touch Daft Punk",
      asker: "playing",
    });
  });

  test("shuffled, the songs searched are the next in the shuffled order", () => {
    const state = play("u:A u:B u:C u:D u:E u:F u:G u:H", 0, true);
    const order = state.entries.map((entry) => entry.trackId);
    assert.notDeepEqual(order, "u:A u:B u:C u:D u:E u:F u:G u:H".split(" ").map(id));
    assert.deepEqual(searched(state), order.slice(state.index, state.index + PLAYING_SEARCHES));
  });

  test("a song queued twice is searched once; with repeat all the top comes after the end", () => {
    const state = play("1 u:A u:B 2 u:C", 3);
    assert.deepEqual(searched(state), [id("u:C")]);
    const repeating = { ...state, repeat: "all" as const };
    assert.deepEqual(searched(repeating), [id("u:C"), id("u:A")]);
    assert.deepEqual(searched(play("u:A u:A u:B")), [id("u:A"), id("u:B")]);
  });

  test("a song being searched isn't asked again; one whose search failed waits a while", () => {
    const state = play("u:A u:B u:C");
    const asking = new Set([id("u:A")]);
    assert.deepEqual(searched(state, 0, { asking }), [id("u:B"), id("u:C")]);
    const failedAt = new Map([[id("u:B"), 1000]]);
    assert.deepEqual(searched(state, 5000, { failedAt }), [id("u:A"), id("u:C")]);
    assert.deepEqual(searched(state, 31_000, { failedAt }), [id("u:A"), id("u:B"), id("u:C")]);
  });

  test("an empty queue, or one with nothing unsearched near, searches nothing", () => {
    assert.deepEqual(searched(EMPTY_QUEUE), []);
    assert.deepEqual(searched(play("1 2 3 4 5 u:A")), []);
  });
});
