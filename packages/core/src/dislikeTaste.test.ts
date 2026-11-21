import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  EMPTY_QUEUE,
  MAGIC_QUEUE_CONTEXT,
  magicArtistKey,
  magicQueueDislikedEntries,
  magicQueueEdits,
  reduceQueue,
  startMagicQueue,
  tasteLearned,
  tasteLearnedSteps,
  tasteProfile,
  tasteProfileSteps,
  tasteWeight,
  type MagicSession,
  type MagicSong,
  type QueueCommand,
  type QueueState,
  type TasteHistory,
  type TasteProfile,
} from "./index.ts";

const DAY = 24 * 60 * 60 * 1000;
const NOW = 1_000 * DAY;

const song = (trackId: string, artists: readonly string[]): MagicSong => ({
  trackId,
  artists: artists.map(magicArtistKey),
  genre: "rock",
  style: null,
});

const NONE: TasteHistory = { plays: [], favorites: [], downloads: [] };

const finish = <T>(steps: Generator<void, T>): T => {
  for (;;) {
    const step = steps.next();
    if (step.done) return step.value;
  }
};

describe("A dislike in the taste profile", () => {
  const duet = song("duet", ["Ana", "Bruno"]);
  const other = song("other", ["Ana"]);
  const songs = new Map([duet, other].map((each) => [each.trackId, each]));
  const songOf = (trackId: string) => songs.get(trackId);
  const disliked = (at: number): TasteHistory => ({
    ...NONE,
    dislikes: [{ trackId: "duet", dislikedAt: at }],
  });
  const artist = (profile: TasteProfile, name: string) =>
    profile.artists.get(magicArtistKey(name)) ?? 0;

  test("counts against each credited artist, as much as a favorite counts for them", () => {
    const profile = tasteProfile(disliked(NOW), songOf, NOW);
    assert.equal(artist(profile, "Ana"), -3);
    assert.equal(artist(profile, "Bruno"), -3);
    const starred = tasteProfile(
      { ...NONE, favorites: [{ trackId: "duet", changedAt: NOW }] },
      songOf,
      NOW,
    );
    assert.equal(artist(starred, "Ana"), 3);
  });

  test("makes the artists' other songs weigh less in a pick", () => {
    const profile = tasteProfile(disliked(NOW), songOf, NOW);
    assert.ok(tasteWeight(profile, other) < 1);
    assert.equal(tasteWeight(tasteProfile(NONE, songOf, NOW), other), 1);
  });

  test("leaves the song's own score and its genre family's alone", () => {
    const profile = tasteProfile(disliked(NOW), songOf, NOW);
    assert.equal(profile.songs.size, 0);
    assert.equal(profile.genres.size, 0);
  });

  test("loses half its weight every 30 days", () => {
    assert.equal(artist(tasteProfile(disliked(NOW - 30 * DAY), songOf, NOW), "Ana"), -1.5);
    assert.equal(artist(tasteProfile(disliked(NOW - 60 * DAY), songOf, NOW), "Bruno"), -0.75);
  });

  test("is gone from a profile derived without it", () => {
    const profile = tasteProfile({ ...NONE, dislikes: [] }, songOf, NOW);
    assert.equal(profile.artists.size, 0);
  });

  test("says nothing about a song the profile can't tell", () => {
    const profile = tasteProfile(
      { ...NONE, dislikes: [{ trackId: "gone", dislikedAt: NOW }] },
      songOf,
      NOW,
    );
    assert.equal(profile.artists.size, 0);
  });

  test("learned as it comes, scores as one derived from the history", () => {
    const at = NOW - 10 * DAY;
    const derived = tasteProfile(disliked(at), songOf, NOW);
    const before = tasteProfile(NONE, songOf, NOW);
    assert.deepEqual(tasteLearned(before, { kind: "dislike", song: duet, at }), derived);
    assert.deepEqual(
      finish(tasteLearnedSteps(before, [{ kind: "dislike", song: duet, at }])),
      derived,
    );
    assert.deepEqual(finish(tasteProfileSteps(disliked(at), songOf, NOW)), derived);
  });
});

describe("A disliked song in a running Magic Queue", () => {
  const session: MagicSession = startMagicQueue(
    { kind: "track", id: "s1", title: "Seed Song" },
    [song("s1", ["Seed Artist"])],
    { id: "m1", random: () => 0 },
  )!.session;
  const context = { kind: MAGIC_QUEUE_CONTEXT, id: "m1" };
  const run = (state: QueueState, ...commands: QueueCommand[]): QueueState =>
    commands.reduce((current, command) => reduceQueue(current, command).state, state);
  const show = (state: QueueState): string =>
    state.entries
      .map((entry, i) => (i === state.index ? `[${entry.trackId}]` : entry.trackId))
      .join(" ");
  /** The queue once the session's disliked entries are removed, as the app removes them. */
  const dropped = (state: QueueState, disliked: readonly string[]): QueueState =>
    run(
      state,
      ...magicQueueDislikedEntries(session, state, new Set(disliked)).map((key): QueueCommand => ({
        type: "remove",
        key,
      })),
    );
  const playing = run(
    EMPTY_QUEUE,
    { type: "play", trackIds: ["s1", "a", "b", "c"], startIndex: 0, context },
    { type: "next" },
  );

  test("leaves the songs not yet played", () => {
    assert.equal(show(playing), "s1 [a] b c");
    assert.equal(show(dropped(playing, ["c"])), "s1 [a] b");
    assert.equal(show(dropped(playing, ["b", "c"])), "s1 [a]");
  });

  test("stays where it played already, and where it plays now", () => {
    assert.equal(show(dropped(playing, ["s1", "a"])), "s1 [a] b c");
  });

  test("goes every time the queue holds it", () => {
    const twice = run(playing, { type: "append", trackIds: ["b"] });
    assert.equal(show(dropped(twice, ["b"])), "s1 [a] c");
  });

  test("stays when the owner lined it up", () => {
    const lined = run(playing, { type: "playNext", trackIds: ["q"] });
    assert.equal(show(dropped(lined, ["q", "b"])), "s1 [a] q c");
  });

  test("counts as a recommendation taken out of the queue", () => {
    assert.deepEqual(magicQueueEdits(session, playing, dropped(playing, ["b"])), {
      added: [],
      removed: ["b"],
    });
  });

  test("stays in a queue that isn't the session's", () => {
    const album = run(EMPTY_QUEUE, {
      type: "play",
      trackIds: ["x", "b"],
      startIndex: 0,
      context: { kind: "album", id: "4" },
    });
    assert.deepEqual(magicQueueDislikedEntries(session, album, new Set(["b"])), []);
    assert.deepEqual(magicQueueDislikedEntries(session, playing, new Set()), []);
  });
});
