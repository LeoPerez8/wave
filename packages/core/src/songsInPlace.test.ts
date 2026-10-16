import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { NO_HELD_SONGS, heldTracks, inLibraryUnlessHeld, songsInPlace } from "./index.ts";
import type { YtSong } from "./index.ts";

const song = (videoId: string): YtSong => ({
  videoId,
  title: videoId,
  artists: ["Artist"],
  album: null,
  durationMs: 200_000,
  artworkUrl: null,
  explicit: false,
});

interface Track {
  readonly id: number;
}

const trackId = (track: Track): number => track.id;

/** A Library that has "a" and "b". */
const hasAOrB = (yt: YtSong): boolean => yt.videoId === "a" || yt.videoId === "b";

/** A Library that has the songs [has] maps to, by video id. */
const libraryWith =
  (has: Readonly<Record<string, Track>>) =>
  (yt: YtSong): Track | null =>
    has[yt.videoId] ?? null;

describe("songsInPlace", () => {
  const a = song("a");
  const b = song("b");
  const c = song("c");

  test("songs the Library lacks stream in their order, and the list starts holding them", () => {
    const placed = songsInPlace(NO_HELD_SONGS, [a, b], libraryWith({}), trackId);

    assert.deepEqual(placed.songs, [
      { source: "stream", song: a },
      { source: "stream", song: b },
    ]);
    assert.deepEqual([...placed.tracks], []);
    assert.deepEqual([...placed.held.keys()].toSorted(), ["a", "b"]);
  });

  test("a held song whose download finished keeps its row, as the Library's file", () => {
    const held = songsInPlace(NO_HELD_SONGS, [a, b, c], libraryWith({}), trackId).held;
    const downloaded = { id: 7 };

    const placed = songsInPlace(held, [a, b, c], libraryWith({ b: downloaded }), trackId);

    assert.deepEqual(placed.songs, [
      { source: "stream", song: a },
      { source: "library", song: b, track: downloaded },
      { source: "stream", song: c },
    ]);
    assert.deepEqual([...placed.tracks], [7]);
  });

  test("downloads finishing one after another and re-renders keep every row where it was", () => {
    const first = songsInPlace(NO_HELD_SONGS, [a, b, c], libraryWith({}), trackId);
    const one = libraryWith({ c: { id: 3 } });
    const afterOne = songsInPlace(first.held, [a, b, c], one, trackId);
    const rerendered = songsInPlace(afterOne.held, [a, b, c], one, trackId);
    const both = libraryWith({ a: { id: 1 }, c: { id: 3 } });
    const afterTwo = songsInPlace(rerendered.held, [a, b, c], both, trackId);

    assert.deepEqual(
      rerendered.songs.map((row) => [row.song.videoId, row.source]),
      [
        ["a", "stream"],
        ["b", "stream"],
        ["c", "library"],
      ],
    );
    assert.deepEqual(
      afterTwo.songs.map((row) => [row.song.videoId, row.source]),
      [
        ["a", "library"],
        ["b", "stream"],
        ["c", "library"],
      ],
    );
    assert.deepEqual([...afterTwo.tracks].toSorted(), [1, 3]);
  });

  test("with nothing new shown, it keeps holding the very same set", () => {
    const held = songsInPlace(NO_HELD_SONGS, [a, b], libraryWith({}), trackId).held;

    assert.equal(songsInPlace(held, [b], libraryWith({ b: { id: 2 } }), trackId).held, held);
  });

  test("a song shown later in the visit (another query) joins what's held", () => {
    const held = songsInPlace(NO_HELD_SONGS, [a], libraryWith({}), trackId).held;

    assert.deepEqual(
      [...songsInPlace(held, [c], libraryWith({}), trackId).held.keys()].toSorted(),
      ["a", "c"],
    );
  });

  test("two rows the Library has as one file show it once, in the first's place", () => {
    const held = songsInPlace(NO_HELD_SONGS, [a, b, c], libraryWith({}), trackId).held;
    const same = { id: 5 };

    const placed = songsInPlace(held, [a, b, c], libraryWith({ a: same, c: same }), trackId);

    assert.deepEqual(
      placed.songs.map((row) => [row.song.videoId, row.source]),
      [
        ["a", "library"],
        ["b", "stream"],
      ],
    );
    assert.deepEqual(
      [...placed.rowOf],
      [
        ["a", 0],
        ["b", 1],
        ["c", 0],
      ],
      "the second plays from the first's row",
    );
  });
});

describe("heldTracks", () => {
  test("the Library's files of the held songs it has now, before the list is laid out", () => {
    const a = song("a");
    const b = song("b");
    const held = songsInPlace(NO_HELD_SONGS, [a, b], libraryWith({}), trackId).held;

    assert.deepEqual([...heldTracks(held, libraryWith({ b: { id: 2 } }), trackId)], [2]);
    assert.deepEqual([...heldTracks(NO_HELD_SONGS, libraryWith({ b: { id: 2 } }), trackId)], []);
  });
});

describe("inLibraryUnlessHeld", () => {
  const a = song("a");
  const b = song("b");

  test("a song the list holds isn't taken out as the Library's; the rest go by the Library", () => {
    const held = songsInPlace(NO_HELD_SONGS, [a], libraryWith({}), trackId).held;
    const inLibrary = inLibraryUnlessHeld(held, hasAOrB);

    assert.equal(inLibrary(a), false);
    assert.equal(inLibrary(b), true);
    assert.equal(inLibrary(song("z")), false);
  });

  test("a new visit holds nothing: the Library's songs leave the streamed part", () => {
    const inLibrary = inLibraryUnlessHeld(NO_HELD_SONGS, hasAOrB);

    assert.equal(inLibrary(a), true);
  });
});
