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
  searchingAfter,
  settleUnsearched,
  readUnsearchedTrackId,
  reduceQueue,
  unsearchedTrackId,
  withHeldCurrent,
  answerPlayingWalk,
  keptQueue,
  startPlayingWalk,
  type PlayingWalk,
  type QueueCommand,
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

  test("while the song after the playing one is still searched, a crossfade waits on it", () => {
    // The player, which doesn't hold it, would fade into the song after it.
    const state = play("1 u:A 2", 0);
    const playing = state.entries[0]!.key;
    assert.equal(searchingAfter(state, new Set([id("u:A")])), playing);
    // Not being searched (it failed a moment ago): the player passes over it, as it plays along.
    assert.equal(searchingAfter(state, new Set()), null);
    // A song searched further on, or a held next song, doesn't hold this one's overlap.
    assert.equal(searchingAfter(play("1 2 u:A", 0), new Set([id("u:A")])), null);
    // Repeat all: the first song comes after the last.
    const last = { ...play("u:A 1", 1), repeat: "all" as const };
    assert.equal(searchingAfter(last, new Set([id("u:A")])), last.entries[1]!.key);
    assert.equal(searchingAfter({ ...last, repeat: "off" }, new Set([id("u:A")])), null);
  });

  test("an empty queue is an empty player", () => {
    assert.deepEqual(playerQueueList(EMPTY_QUEUE), { keys: [], index: -1 });
  });

  test("a queue that can't wait (picked back up after a restart) starts at the next song it holds", () => {
    assert.equal(show(withHeldCurrent(play("1 u:A u:B 2", 1))), "1 u:A u:B [2]");
    assert.equal(show(withHeldCurrent(play("1 u:A u:B", 2))), "[1] u:A u:B");
    const held = play("1 u:A 2", 2);
    assert.equal(withHeldCurrent(held), held);
    assert.equal(withHeldCurrent(play("u:A u:B", 0)).index, -1);
  });

  test("a queue saved while its playing song was searched is picked back up from the player", () => {
    const saved = play("1 u:A 2", 1);
    const keys = saved.entries.map((entry) => entry.key);
    assert.equal(show(keptQueue(saved, [keys[0]!, keys[2]!])!), "1 u:A [2]");
    assert.equal(keptQueue(saved, [keys[0]!]), null);
    const plain = play("1 2");
    assert.equal(
      keptQueue(
        plain,
        plain.entries.map((entry) => entry.key),
      ),
      plain,
    );
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
  });

  test("skipped to offline or with YT Music off, it says what a YT Music song says, and playback stops", () => {
    assert.deepEqual(playingAnswerStep(touch, failed("offline"), { chosen: false }), {
      kind: "stop",
      notice: "You're offline. YT Music songs need the network.",
    });
    assert.deepEqual(playingAnswerStep(touch, failed("disabled"), { chosen: false }), {
      kind: "stop",
      notice: "YT Music is off in Settings.",
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

  test("at the crossfade's prefetch point the next song is asked again at once, the others still wait", () => {
    const state = play("1 u:B u:C");
    const failedAt = new Map([
      [id("u:B"), 1000],
      [id("u:C"), 1000],
    ]);
    assert.deepEqual(searched(state, 5000, { failedAt, nextDue: true }), [id("u:B")]);
    // Being searched already, it isn't asked twice.
    const asking = new Set([id("u:B")]);
    assert.deepEqual(searched(state, 5000, { failedAt, asking, nextDue: true }), []);
  });

  test("an empty queue, or one with nothing unsearched near, searches nothing", () => {
    assert.deepEqual(searched(EMPTY_QUEUE), []);
    assert.deepEqual(searched(play("1 2 3 4 5 u:A")), []);
  });
});

describe("the queue going through unsearched songs as they come to play", () => {
  type Answer = "found" | "notFound" | "failed" | "offline" | "disabled";
  const answer = (title: string, kind: Answer) => {
    const song = listed(title);
    if (kind === "notFound") return settleUnsearched(song, { ok: true, songs: [] });
    if (kind !== "found") return settleUnsearched(song, { ok: false, reason: kind });
    const result = {
      videoId: title.toLowerCase(),
      title,
      artists: ["Daft Punk"],
      album: null,
      durationMs: 300_000,
      artworkUrl: null,
      explicit: false,
    };
    return settleUnsearched(song, { ok: true, songs: [result] });
  };

  /**
   * Runs [command] on [before], answering each playing song's search by its
   * title ([answers], found when missing), and says what was searched, what
   * was said and where the queue ends up.
   */
  const walk = (
    before: QueueState,
    command: QueueCommand,
    answers: Readonly<Record<string, Answer>> = {},
  ) => {
    let step = startPlayingWalk(before, command, reduceQueue(before, command), null);
    const asked: string[] = [];
    const notices: string[] = [];
    for (;;) {
      if (step.notice !== null) notices.push(step.notice);
      if (step.kind !== "search") break;
      const title = step.song.title;
      asked.push(title);
      if (asked.length > 20) assert.fail(`still searching: ${asked.join(", ")}`);
      step = answerPlayingWalk(step.walk, answer(title, answers[title] ?? "found"));
    }
    return {
      searched: asked,
      notices,
      kind: step.kind,
      queue: show(step.state),
      playback: step.kind === "go" ? step.playback : null,
    };
  };

  const keyOf = (state: QueueState, at: number): string => state.entries[at]!.key;

  test("a tap on an unsearched song searches it, and found, it plays as the YT Music song", () => {
    const before = play("1 u:Touch 2");
    assert.deepEqual(walk(before, { type: "jumpTo", key: keyOf(before, 1) }), {
      searched: ["Touch"],
      notices: [],
      kind: "go",
      queue: "1 [yt:touch] 2",
      playback: "play",
    });
  });

  test("not found, the song leaves the queue with a notice, and the next one goes the same way", () => {
    assert.deepEqual(walk(play("1 u:A u:B 2"), { type: "next" }, { A: "notFound" }), {
      searched: ["A", "B"],
      notices: [`Skipped "A": it isn't on YouTube Music.`],
      kind: "go",
      queue: "1 [yt:b] 2",
      playback: "keep",
    });
  });

  test("failed, the song stays unsearched with a notice, and the next one goes the same way", () => {
    assert.deepEqual(walk(play("1 u:A u:B 2"), { type: "next" }, { A: "failed" }), {
      searched: ["A", "B"],
      notices: [`Skipped "A": YouTube Music didn't answer.`],
      kind: "go",
      queue: "1 u:A [yt:b] 2",
      playback: "keep",
    });
  });

  test("run out at the end, it stops on the last song the player holds", () => {
    const answers = { A: "failed", B: "notFound" } as const;
    assert.deepEqual(walk(play("1 u:A u:B"), { type: "next" }, answers), {
      searched: ["A", "B"],
      notices: [
        `Skipped "A": YouTube Music didn't answer.`,
        `Skipped "B": it isn't on YouTube Music.`,
      ],
      kind: "go",
      queue: "[1] u:A",
      playback: "stop",
    });
  });

  test("with repeat all it wraps to the top, and stops once it has gone round", () => {
    const repeating = (names: string) => ({ ...play(names), repeat: "all" as const });
    const onTop = walk(repeating("1 u:A u:B"), { type: "next" }, { A: "failed", B: "failed" });
    assert.deepEqual(
      [onTop.searched, onTop.queue, onTop.playback],
      [["A", "B"], "[1] u:A u:B", "keep"],
    );
    const before = repeating("u:A u:B");
    const tap = { type: "play", trackIds: [id("u:A"), id("u:B")], context } as const;
    const round = walk(before, tap, { A: "failed", B: "failed" });
    assert.deepEqual(
      [round.searched, round.queue, round.playback],
      [["A", "B"], "u:A u:B", "stop"],
    );
  });

  test("chosen offline or with YT Music off, it says what a YT Music song says, and the queue stays", () => {
    const before = play("1 u:Touch 2");
    const chosen: QueueCommand[] = [
      { type: "jumpTo", key: keyOf(before, 1) },
      { type: "play", trackIds: [id("u:Touch"), "2"], context },
    ];
    for (const command of chosen) {
      assert.deepEqual(walk(before, command, { Touch: "offline" }), {
        searched: ["Touch"],
        notices: ["You're offline. YT Music songs need the network."],
        kind: "stay",
        queue: "[1] u:Touch 2",
        playback: null,
      });
    }
    const queued = walk(
      EMPTY_QUEUE,
      { type: "addToQueue", trackIds: [id("u:Touch")] },
      {
        Touch: "disabled",
      },
    );
    assert.deepEqual([queued.kind, queued.notices], ["stay", ["YT Music is off in Settings."]]);
  });

  test("skipped onto a run of them offline, it says so once and stops at the next song the player holds", () => {
    assert.deepEqual(walk(play("1 u:A u:B u:C 2"), { type: "next" }, { A: "offline" }), {
      searched: ["A"],
      notices: ["You're offline. YT Music songs need the network."],
      kind: "go",
      queue: "1 u:A u:B u:C [2]",
      playback: "stop",
    });
    const before = play("1 u:A u:B 2");
    const tapped = walk(
      before,
      { type: "jumpTo", key: keyOf(before, 1) },
      {
        A: "notFound",
        B: "disabled",
      },
    );
    assert.deepEqual(tapped, {
      searched: ["A", "B"],
      notices: [`Skipped "A": it isn't on YouTube Music.`, "YT Music is off in Settings."],
      kind: "go",
      queue: "1 u:B [2]",
      playback: "stop",
    });
  });

  test("on Previous it keeps going back: skipped, failed or offline, it lands on the song before", () => {
    const back = { type: "previous", positionMs: 0 } as const;
    const ways = [
      ["failed", "[1] u:B 3", "keep"],
      ["notFound", "[1] 3", "keep"],
      ["offline", "[1] u:B 3", "stop"],
    ] as const;
    for (const [answered, queue, playback] of ways) {
      const went = walk(play("1 u:B 3", 2), back, { B: answered });
      assert.deepEqual([went.searched, went.queue, went.playback], [["B"], queue, playback]);
    }
  });

  describe("a command that comes while the playing song is searched", () => {
    const tapped = (before: QueueState, at: number) => {
      const tap = { type: "jumpTo", key: keyOf(before, at) } as const;
      const step = startPlayingWalk(before, tap, reduceQueue(before, tap), null);
      assert.equal(step.kind, "search");
      return step.kind === "search" ? step : assert.fail();
    };
    const then = (waiting: { walk: PlayingWalk; state: QueueState }, command: QueueCommand) =>
      startPlayingWalk(waiting.state, command, reduceQueue(waiting.state, command), waiting.walk);
    const offline = answer("Touch", "offline");

    test("leaving the song playing, the same search goes on, still the owner's choice", () => {
      const before = play("1 u:Touch 2");
      const waiting = tapped(before, 1);
      const step = then(waiting, { type: "addToQueue", trackIds: ["3"] });
      assert.equal(step.kind, "search");
      if (step.kind !== "search") return;
      assert.equal(step.trackId, id("u:Touch"));
      assert.equal(show(step.state), "1 [u:Touch] 3 2");
      const stayed = answerPlayingWalk(step.walk, offline);
      assert.deepEqual([stayed.kind, show(stayed.state)], ["stay", "[1] u:Touch 2"]);
    });

    test("making another one playing, it goes back to the queue the player holds if that can't be searched", () => {
      const before = play("1 u:A u:Touch");
      const step = then(tapped(before, 1), { type: "jumpTo", key: keyOf(before, 2) });
      assert.equal(step.kind, "search");
      if (step.kind !== "search") return;
      const stayed = answerPlayingWalk(step.walk, offline);
      assert.deepEqual([stayed.kind, show(stayed.state)], ["stay", "[1] u:A u:Touch"]);
    });

    test("making a song the player holds playing, it goes there", () => {
      const before = play("1 u:A 2");
      const step = then(tapped(before, 1), { type: "next" });
      assert.deepEqual([step.kind, show(step.state)], ["go", "1 u:A [2]"]);
    });
  });
});
