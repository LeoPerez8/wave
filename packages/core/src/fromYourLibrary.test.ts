import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  FROM_YOUR_LIBRARY_PLAYLISTS,
  fromYourLibrary,
  playlistPlays,
  RECENT_WINDOW_DAYS,
  type PlaylistPlayEvent,
} from "./index.ts";

const DAY_MS = 86_400_000;
const NOW = Date.UTC(2026, 10, 20, 12);
const WINDOW_START = NOW - RECENT_WINDOW_DAYS * DAY_MS;
/** Well before the window. */
const LONG_AGO = NOW - 90 * DAY_MS;

const play = (
  playlistId: number | string,
  startedAt: number,
  more: Partial<PlaylistPlayEvent> = {},
): PlaylistPlayEvent => ({
  context: { kind: "playlist", id: String(playlistId) },
  startedAt,
  counted: true,
  ...more,
});

const times = (count: number, playlistId: number, startedAt: number): PlaylistPlayEvent[] =>
  Array.from({ length: count }, (_, index) => play(playlistId, startedAt + index));

const playlist = (id: number, name = `playlist ${id}`) => ({ id, name, sort: name });

/** The section's playlist ids for [events], over playlists 1 to [count]. */
const section = (events: readonly PlaylistPlayEvent[], count = 6): number[] =>
  fromYourLibrary(
    Array.from({ length: count }, (_, index) => playlist(index + 1)),
    playlistPlays(events, NOW),
  ).map(({ id }) => id);

describe("From your library", () => {
  test("playlists played in the last 14 days come first, the most played of them on top", () => {
    assert.deepEqual(
      section([
        ...times(1, 1, NOW - DAY_MS),
        ...times(3, 2, NOW - 2 * DAY_MS),
        ...times(2, 3, NOW - 3 * DAY_MS),
      ]),
      [2, 3, 1],
    );
  });

  test("the rest fill in after them by their plays of all time", () => {
    assert.deepEqual(
      section([
        ...times(9, 1, LONG_AGO),
        ...times(20, 2, LONG_AGO),
        ...times(1, 3, NOW - DAY_MS),
        ...times(2, 4, NOW - DAY_MS),
      ]),
      [4, 3, 2, 1],
    );
  });

  test("a recent play outranks any number of older ones", () => {
    assert.deepEqual(section([...times(50, 1, LONG_AGO), play(2, NOW - DAY_MS)]), [2, 1]);
  });

  test("a playlist played both recently and before appears once, among the recent", () => {
    assert.deepEqual(
      section([...times(30, 1, LONG_AGO), play(1, NOW - DAY_MS), ...times(5, 2, LONG_AGO)]),
      [1, 2],
    );
  });

  test("playlists never played are left out", () => {
    assert.deepEqual(section([play(4, NOW - DAY_MS)]), [4]);
    assert.deepEqual(section([]), []);
  });

  test("a play at the window's first instant is recent, one a millisecond older is not", () => {
    assert.deepEqual(
      playlistPlays([play(1, WINDOW_START), play(2, WINDOW_START - 1)], NOW).map(
        ({ id, recentPlays, plays }) => ({ id, recentPlays, plays }),
      ),
      [
        { id: 1, recentPlays: 1, plays: 1 },
        { id: 2, recentPlays: 0, plays: 1 },
      ],
    );
    // The older one has more plays of all time, and still comes second.
    assert.deepEqual(section([play(1, WINDOW_START), ...times(3, 2, WINDOW_START - 10)]), [1, 2]);
  });

  test("a play counts for a playlist only when its play context is that playlist", () => {
    assert.deepEqual(
      section([
        play(1, NOW - DAY_MS, { context: { kind: "album", id: "1" } }),
        play(2, NOW - DAY_MS, { context: { kind: "home", id: "most-played" } }),
        play(3, NOW - DAY_MS, { context: null }),
        play(4, NOW - DAY_MS, { context: { kind: "playlist", id: null } }),
        play(5, NOW - DAY_MS),
      ]),
      [5],
    );
  });

  test("a play that isn't counted adds nothing", () => {
    assert.deepEqual(section([play(1, NOW - DAY_MS, { counted: false })]), []);
    assert.deepEqual(
      section([
        ...times(2, 1, NOW - DAY_MS),
        play(2, NOW - DAY_MS),
        ...times(5, 2, NOW - DAY_MS).map((event) => ({ ...event, counted: false })),
      ]),
      [1, 2],
    );
  });

  test("plays from a playlist the owner no longer has show nothing", () => {
    assert.deepEqual(section([...times(4, 99, NOW - DAY_MS), play(1, LONG_AGO)]), [1]);
  });

  test("equal recent plays fall back to all-time plays, then the latest play, then the name", () => {
    assert.deepEqual(
      section([play(1, NOW - DAY_MS), play(2, NOW - DAY_MS), ...times(2, 2, LONG_AGO)]),
      [2, 1],
    );
    assert.deepEqual(section([play(1, NOW - 2 * DAY_MS), play(2, NOW - DAY_MS)]), [2, 1]);
    assert.deepEqual(
      fromYourLibrary(
        [playlist(1, "b"), playlist(2, "a")],
        playlistPlays([play(1, LONG_AGO), play(2, LONG_AGO)], NOW),
      ).map(({ id }) => id),
      [2, 1],
    );
  });

  test("the order doesn't depend on the order plays or playlists arrive in", () => {
    const events = [
      ...times(2, 1, LONG_AGO),
      ...times(2, 2, NOW - DAY_MS),
      ...times(4, 3, LONG_AGO),
      play(4, NOW - DAY_MS),
    ];
    const playlists = [1, 2, 3, 4].map((id) => playlist(id));
    assert.deepEqual(
      fromYourLibrary(playlists.toReversed(), playlistPlays(events.toReversed(), NOW)),
      fromYourLibrary(playlists, playlistPlays(events, NOW)),
    );
  });

  test(`shows at most ${FROM_YOUR_LIBRARY_PLAYLISTS} playlists, the recent ones kept first`, () => {
    const count = FROM_YOUR_LIBRARY_PLAYLISTS + 3;
    const old = Array.from({ length: count - 1 }, (_, index) => times(5, index + 1, LONG_AGO));
    const shown = section([...old.flat(), play(count, NOW - DAY_MS)], count);
    assert.equal(shown.length, FROM_YOUR_LIBRARY_PLAYLISTS);
    assert.equal(shown[0], count);
  });
});
