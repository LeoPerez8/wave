import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EMPTY_QUEUE,
  answerPlayingWalk,
  explicitPassOver,
  explicitPlayNotice,
  queuedPassedOver,
  reduceQueue,
  settleUnsearched,
  startPlayingWalk,
  unsearchedTrackId,
} from "./index.ts";
import type { ExplicitFlag, QueueCommand, QueueState, UnsearchedSong } from "./index.ts";

const songs = { kind: "songs", id: null } as const;

/** Track ids in play order, the current one wrapped in brackets. */
const show = (state: QueueState): string =>
  state.entries
    .map((entry, i) => (i === state.index ? `[${entry.trackId}]` : entry.trackId))
    .join(" ");

const explicit = new Set(["b", "d"]);
const passOver = (trackId: string): boolean => explicit.has(trackId);
const reduce = (state: QueueState, command: QueueCommand) =>
  reduceQueue(state, command, () => 0, undefined, passOver);
const play = (trackIds: string, startIndex?: number, base: QueueState = EMPTY_QUEUE) =>
  reduce(base, { type: "play", trackIds: trackIds.split(" "), startIndex, context: songs });

/** An unsearched song Spotify listed. */
const listed = (title: string): UnsearchedSong => ({
  title,
  artists: ["Daft Punk"],
  album: null,
  durationMs: 300_000,
  artworkUrl: null,
});

/** A play of [trackIds] from the Songs context, from the one at [startIndex] if given. */
const playOf = (trackIds: string, startIndex?: number): QueueCommand => ({
  type: "play",
  trackIds: trackIds.split(" "),
  startIndex,
  context: songs,
});

describe("the queue passes over explicit songs (Don't play explicit)", () => {
  test("a list plays only its clean songs, in order", () => {
    const { state, playback } = play("a b c d e");
    assert.equal(show(state), "[a] c e");
    assert.equal(playback, "play");
  });

  test("a tapped clean song plays where it is among the clean ones", () => {
    assert.equal(show(play("a b c d e", 2).state), "a [c] e");
  });

  test("a tapped explicit song gives way to the next clean one", () => {
    const { state, playback } = play("a b c d e", 1);
    assert.equal(show(state), "a [c] e");
    assert.equal(playback, "play");
  });

  test("a tapped explicit song with no clean one after it gives way to the last before it", () => {
    assert.equal(show(play("a c d", 2).state), "a [c]");
  });

  test("a list of explicit songs alone leaves the queue as it was", () => {
    const playing = play("a c", 1).state;
    const { state, playback } = play("b d", 0, playing);
    assert.equal(state, playing);
    assert.equal(playback, "keep");
  });

  test("Next never lands on an explicit song", () => {
    const first = play("a b c d e").state;
    const second = reduce(first, { type: "next" }).state;
    assert.equal(show(second), "a [c] e");
    assert.equal(show(reduce(second, { type: "next" }).state), "a c [e]");
  });

  test("a shuffled list holds its clean songs alone", () => {
    const { state } = play("a b c d e", undefined, { ...EMPTY_QUEUE, shuffle: true });
    const held = state.entries.map((entry) => entry.trackId);
    assert.equal(held.length, 3);
    assert.deepEqual(new Set(held), new Set(["a", "c", "e"]));
  });

  test("Play Next and Add to Queue leave explicit songs out", () => {
    const playing = play("a").state;
    const next = reduce(playing, { type: "playNext", trackIds: ["b", "c"] }).state;
    assert.equal(show(next), "[a] c");
    const added = reduce(next, { type: "addToQueue", trackIds: ["d", "e"] }).state;
    assert.equal(show(added), "[a] c e");
  });

  test("queuing explicit songs alone changes nothing", () => {
    const playing = play("a").state;
    assert.equal(reduce(playing, { type: "addToQueue", trackIds: ["b", "d"] }).state, playing);
    const { state, playback } = reduce(EMPTY_QUEUE, { type: "playNext", trackIds: ["b"] });
    assert.equal(state, EMPTY_QUEUE);
    assert.equal(playback, "keep");
  });

  test("More from this artist takes the artist's clean songs", () => {
    const playing = play("a").state;
    const more = reduce(playing, { type: "moreFromArtist", ranking: ["b", "c", "d", "e", "f"] });
    assert.equal(show(more.state), "[a] c e f");
  });

  test("an unsearched song found as an explicit one goes, as one not found does", () => {
    const playing = play("a u c").state;
    const settled = reduce(playing, { type: "settled", trackId: "u", becomes: "d" }).state;
    assert.equal(show(settled), "[a] c");
    const clean = reduce(playing, { type: "settled", trackId: "u", becomes: "e" }).state;
    assert.equal(show(clean), "[a] e c");
  });
});

/** [title]'s search, found as a YT Music song marked explicit or not. */
const found = (title: string, isExplicit: boolean) =>
  settleUnsearched(listed(title), {
    ok: true,
    songs: [
      {
        videoId: title.toLowerCase(),
        title,
        artists: ["Daft Punk"],
        album: null,
        durationMs: 300_000,
        artworkUrl: null,
        explicit: isExplicit,
      },
    ],
  });

/** Next from "1" onto the unsearched song [title], up to its search. */
const searching = (title: string) => {
  const before = reduceQueue(EMPTY_QUEUE, {
    type: "play",
    trackIds: ["1", unsearchedTrackId(listed(title)), "2"],
    context: songs,
  }).state;
  const command: QueueCommand = { type: "next" };
  const step = startPlayingWalk(before, command, reduceQueue(before, command), null);
  if (step.kind !== "search") return assert.fail(`expected a search, got ${step.kind}`);
  return step.walk;
};

describe("an unsearched song found as an explicit one, as it comes to play", () => {
  const marked = new Set(["yt:touch"]);
  const passExplicit = (trackId: string): boolean => marked.has(trackId);
  test("is skipped with a notice saying it's explicit, and the next song plays", () => {
    const answered = answerPlayingWalk(searching("Touch"), found("Touch", true), passExplicit);
    assert.equal(answered.notice, `Skipped "Touch": it's explicit.`);
    assert.equal(answered.kind, "go");
    assert.equal(show(answered.state), "1 [2]");
  });

  test("found clean, it plays", () => {
    const answered = answerPlayingWalk(searching("Around"), found("Around", false), passExplicit);
    assert.equal(answered.notice, null);
    assert.equal(show(answered.state), "1 [yt:around] 2");
  });
});

describe("which songs Don't play explicit passes over", () => {
  const flags = new Map<string, ExplicitFlag | boolean>([
    ["1", "explicit"],
    ["2", "clean"],
    ["3", "unknown"],
    ["yt:a", true],
    ["yt:b", false],
  ]);
  const flagOf = (trackId: string) => flags.get(trackId);

  test("on, explicit Library songs and YT Music songs marked explicit", () => {
    const passes = explicitPassOver({ on: true, flagOf });
    assert.deepEqual(
      ["1", "2", "3", "yt:a", "yt:b", "4"].filter(passes),
      ["1", "yt:a"],
      "unknown and unseen songs count as clean",
    );
  });

  test("off, none: nothing changes", () => {
    const passes = explicitPassOver({ on: false, flagOf });
    assert.deepEqual(["1", "yt:a"].filter(passes), []);
  });

  test("the queue's explicit songs, each once, for when the switch turns on", () => {
    const state = reduceQueue(EMPTY_QUEUE, {
      type: "play",
      trackIds: ["2", "1", "yt:a", "3", "1"],
      context: songs,
    }).state;
    assert.deepEqual(queuedPassedOver(state, explicitPassOver({ on: true, flagOf })), [
      "1",
      "yt:a",
    ]);
  });
});

describe("what a play says when Don't play explicit passed over its songs", () => {
  const titles = new Map([
    ["b", "Bad"],
    ["d", "Dirty"],
  ]);
  const notice = (command: QueueCommand) =>
    explicitPlayNotice(command, passOver, (trackId) => titles.get(trackId) ?? trackId);

  test("a tapped explicit song says it was skipped", () => {
    assert.equal(notice(playOf("a b c", 1)), `Skipped "Bad": it's explicit.`);
  });

  test("a tapped explicit song with nothing clean to play instead says it didn't play", () => {
    assert.equal(notice(playOf("b d", 0)), `Didn't play "Bad": it's explicit.`);
  });

  test("Play on a list of explicit songs alone says none played", () => {
    assert.equal(notice(playOf("b d")), "Didn't play: every song is explicit.");
    assert.equal(notice(playOf("d")), `Didn't play "Dirty": it's explicit.`);
  });

  test("queuing explicit songs alone says none went in", () => {
    assert.equal(notice({ type: "playNext", trackIds: ["b"] }), `Didn't add "Bad": it's explicit.`);
    assert.equal(
      notice({ type: "addToQueue", trackIds: ["b", "d"] }),
      "Didn't add: every song is explicit.",
    );
  });

  test("a play that plays clean songs, or passes none over, says nothing", () => {
    assert.equal(notice(playOf("a b c")), null);
    assert.equal(notice(playOf("a b c", 2)), null);
    assert.equal(notice({ type: "addToQueue", trackIds: ["a", "b"] }), null);
    assert.equal(notice({ type: "next" }), null);
  });
});
