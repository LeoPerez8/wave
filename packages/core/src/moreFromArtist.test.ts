import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { EMPTY_QUEUE, artistRanking, reduceQueue } from "./index.ts";
import type { ArtistRankingSong, PlayTotals, QueueCommand, QueueState } from "./index.ts";

const album = { kind: "album", id: "1" } as const;

/** Track ids in play order, the current one wrapped in brackets. */
const show = (state: QueueState): string =>
  state.entries
    .map((entry, i) => (i === state.index ? `[${entry.trackId}]` : entry.trackId))
    .join(" ");

/** Plays `trackIds` from an album, starting at `startIndex`. */
const start = (trackIds: string, startIndex = 0): QueueState =>
  reduceQueue(EMPTY_QUEUE, {
    type: "play",
    trackIds: trackIds.split(" "),
    startIndex,
    context: album,
  }).state;

const apply = (state: QueueState, ...commands: QueueCommand[]): QueueState =>
  commands.reduce((current, command) => reduceQueue(current, command).state, state);

/** A tap on More from this artist, for an artist whose ranking is `ranking`. */
const more = (ranking: string): QueueCommand => ({
  type: "moreFromArtist",
  ranking: ranking.split(" "),
});

describe("More from this artist", () => {
  test("the first tap puts the top three of the ranking right after the current track", () => {
    const { state, playback } = reduceQueue(start("a b c", 1), more("r1 r2 r3 r4 r5"));
    assert.equal(show(state), "a [b] r1 r2 r3 c");
    assert.equal(playback, "keep");
  });

  test("each later tap adds the next three after the ones added before", () => {
    const state = apply(
      start("a b c", 1),
      more("r1 r2 r3 r4 r5 r6 r7"),
      more("r1 r2 r3 r4 r5 r6 r7"),
    );
    assert.equal(show(state), "a [b] r1 r2 r3 r4 r5 r6 c");
    assert.equal(show(apply(state, more("r1 r2 r3 r4 r5 r6 r7"))), "a [b] r1 r2 r3 r4 r5 r6 r7 c");
  });

  test("songs playing or already in Up Next are skipped", () => {
    // Playing r2 off its album, with x and r5 lined up and r4 further down the album.
    const state = apply(
      start("r1 r2 c r4", 1),
      { type: "playNext", trackIds: ["x"] },
      { type: "addToQueue", trackIds: ["r5"] },
    );
    assert.equal(show(apply(state, more("r1 r2 r3 r4 r5 r6 r7"))), "r1 [r2] r1 r3 r6 x r5 c r4");
  });

  test("songs it added that have since played are not added again", () => {
    const state = apply(
      start("a b c", 1),
      more("r1 r2 r3 r4 r5 r6 r7"),
      { type: "next" },
      { type: "next" },
    );
    assert.equal(show(state), "a b r1 [r2] r3 c");
    assert.equal(show(apply(state, more("r1 r2 r3 r4 r5 r6 r7"))), "a b r1 [r2] r3 r4 r5 r6 c");
  });

  test("a tap with every song of the artist already queued changes nothing", () => {
    const state = apply(start("a b c", 1), more("r1 r2"));
    const { state: after, playback } = reduceQueue(state, more("r1 r2"));
    assert.equal(after, state);
    assert.equal(playback, "keep");
  });

  test("nothing is added while nothing plays", () => {
    const { state, playback } = reduceQueue(EMPTY_QUEUE, more("r1 r2 r3"));
    assert.equal(state, EMPTY_QUEUE);
    assert.equal(playback, "keep");
  });
});

/** Song `id` on album `albumId` at `trackNumber` (disc 1). */
const song = (id: number, albumId: number, trackNumber: number | null): ArtistRankingSong => ({
  id,
  albumId,
  discNumber: null,
  trackNumber,
  titleSort: `song ${id}`,
  path: `/music/${id}.mp3`,
});

/** Song `id`'s all-time counted plays, three minutes each. */
const played = (
  id: number,
  countedPlays: number,
  overrides: Partial<PlayTotals> = {},
): PlayTotals => ({
  id,
  sortKey: `song ${id}`,
  countedPlays,
  listenedMs: countedPlays * 180_000,
  latestPlayAt: 1_000,
  ...overrides,
});

describe("artistRanking", () => {
  test("ranks the artist's songs by counted plays, the most played first", () => {
    const ranking = artistRanking({
      albumIds: [1],
      songs: [song(1, 1, 1), song(2, 1, 2), song(3, 1, 3), song(4, 1, 4)],
      plays: [played(1, 2), played(2, 9), played(3, 1), played(4, 5)],
    });
    assert.deepEqual(ranking, ["2", "4", "1", "3"]);
  });

  test("unplayed songs follow, album by album as the artist page lists them", () => {
    const ranking = artistRanking({
      // Album 20 first on the page (newer), then album 10, then Appears on album 30.
      albumIds: [20, 10, 30],
      songs: [
        song(11, 10, 1),
        song(12, 10, 2),
        song(31, 30, 5),
        song(22, 20, 2),
        song(21, 20, 1),
        { ...song(23, 20, 1), discNumber: 2 },
      ],
      plays: [played(12, 3), played(99, 50)],
    });
    assert.deepEqual(ranking, ["12", "21", "22", "23", "11", "31"]);
  });

  test("a tap for an artist with one played song tops it up with unplayed ones", () => {
    const ranking = artistRanking({
      albumIds: [10],
      songs: [song(1, 10, 1), song(2, 10, 2), song(3, 10, 3), song(4, 10, 4)],
      plays: [played(3, 1)],
    });
    const state = apply(start("a b"), { type: "moreFromArtist", ranking });
    assert.equal(show(state), "[a] 3 1 2 b");
  });
});
