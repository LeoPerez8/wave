import assert from "node:assert/strict";
import { test } from "node:test";

import {
  magicQueueMixPicks,
  magicQueueRow,
  type BlendedDiscoverMix,
  type DiscoverMixesSection,
  type DiscoverMixSong,
  type YtAlbumSong,
} from "./index.ts";

const song = (videoId: string, artist: string): YtAlbumSong => ({
  videoId,
  title: `Song ${videoId}`,
  artists: [artist],
  album: null,
  albumId: null,
  durationMs: 200_000,
  artworkUrl: null,
  explicit: false,
});

const streamed = (videoId: string, artist: string): DiscoverMixSong => ({
  source: "stream",
  song: song(videoId, artist),
});

/** A chart artist's mix of [count] streamed songs, `<artist>1`…. */
const mix = (artist: string, count: number): BlendedDiscoverMix => ({
  id: `artist:${artist}`,
  seed: { kind: "artist", name: artist },
  songs: Array.from({ length: count }, (_, place) => streamed(`${artist}${place + 1}`, artist)),
});

/** A song of a mix the Library has a file for. */
const kept = (id: number): DiscoverMixSong => ({
  source: "library",
  track: { id, title: "Kept", artist: "a" },
});

const mixes = (shown: readonly BlendedDiscoverMix[]): DiscoverMixesSection => ({
  kind: "mixes",
  mixes: shown,
  updating: false,
  failed: false,
});

const SKELETON: DiscoverMixesSection = { kind: "skeleton", failed: false };
const HIDDEN: DiscoverMixesSection = { kind: "hidden", failed: false };
const FAILED: DiscoverMixesSection = { kind: "empty", failed: true };

const chartMixes = [mix("a", 10), mix("b", 10), mix("c", 10)];

test("with YT Music off the row is hidden, Library songs or mixes alike", () => {
  for (const library of [[1, 2, 3], []])
    assert.deepEqual(magicQueueRow({ ytMusic: false, library, artistMixes: mixes(chartMixes) }), {
      kind: "hidden",
    });
});

test("the row waits hidden until the Library has been read", () => {
  assert.deepEqual(
    magicQueueRow({ ytMusic: true, library: null, artistMixes: mixes(chartMixes) }),
    {
      kind: "hidden",
    },
  );
});

test("a Library with songs to show fills the row, whatever mixes exist", () => {
  assert.deepEqual(
    magicQueueRow({ ytMusic: true, library: [1, 2, 3], artistMixes: mixes(chartMixes) }),
    { kind: "library", songs: [1, 2, 3] },
  );
  assert.deepEqual(magicQueueRow({ ytMusic: true, library: [7], artistMixes: SKELETON }), {
    kind: "library",
    songs: [7],
  });
});

test("an empty Library takes the row's songs from the Artist mixes", () => {
  assert.deepEqual(magicQueueRow({ ytMusic: true, library: [], artistMixes: mixes(chartMixes) }), {
    kind: "mixes",
    mixes: chartMixes,
  });
});

test("an empty Library shows skeletons while the first mixes build", () => {
  assert.deepEqual(magicQueueRow({ ytMusic: true, library: [], artistMixes: SKELETON }), {
    kind: "skeleton",
  });
});

test("an empty Library without mixes hides the row", () => {
  for (const artistMixes of [HIDDEN, FAILED])
    assert.deepEqual(magicQueueRow({ ytMusic: true, library: [], artistMixes }), {
      kind: "hidden",
    });
});

test("mixes with no streamed song to start from leave the row hidden", () => {
  const onlyLibrary: BlendedDiscoverMix = { ...mix("a", 0), songs: [kept(1)] };
  assert.deepEqual(
    magicQueueRow({ ytMusic: true, library: [], artistMixes: mixes([onlyLibrary]) }),
    { kind: "hidden" },
  );
});

const ids = (songs: readonly YtAlbumSong[]) => songs.map((picked) => picked.videoId);
const artistsOf = (songs: readonly YtAlbumSong[]) => songs.map((picked) => picked.artists[0]);

test("nine streamed songs are picked, spread evenly over the mixes", () => {
  const picked = magicQueueMixPicks(chartMixes, Math.random);
  assert.equal(picked.length, 9);
  assert.equal(new Set(ids(picked)).size, 9);
  for (const artist of ["a", "b", "c"])
    assert.equal(artistsOf(picked).filter((name) => name === artist).length, 3);
});

test("with more mixes than places, no mix gives two songs", () => {
  const many = Array.from({ length: 12 }, (_, place) => mix(`m${place}`, 5));
  const picked = magicQueueMixPicks(many, Math.random);
  assert.equal(picked.length, 9);
  assert.equal(new Set(artistsOf(picked)).size, 9);
});

test("the supplied randomness decides the draw", () => {
  assert.deepEqual(ids(magicQueueMixPicks(chartMixes, () => 0)), [
    "a1",
    "b1",
    "c1",
    "a2",
    "b2",
    "c2",
    "a3",
    "b3",
    "c3",
  ]);
});

test("fewer than nine streamed songs are all shown, a video once", () => {
  const twice: BlendedDiscoverMix = {
    ...mix("b", 0),
    songs: [streamed("a1", "a"), streamed("b1", "b")],
  };
  const picked = magicQueueMixPicks([mix("a", 2), twice], () => 0);
  assert.deepEqual(ids(picked).toSorted(), ["a1", "a2", "b1"]);
});

test("a mix's Library songs are never picked: the row starts from streams", () => {
  const withLibrary: BlendedDiscoverMix = {
    ...mix("a", 1),
    songs: [kept(4), ...mix("a", 1).songs],
  };
  assert.deepEqual(ids(magicQueueMixPicks([withLibrary], () => 0)), ["a1"]);
});

test("rebuilt mixes keep the songs still in them in their places and fill the rest", () => {
  const previous = ["a1", "b1", "c1", "a2", "gone", "c2", "a3", "b3", "c3"];
  const picked = ids(magicQueueMixPicks(chartMixes, () => 0, previous));
  assert.deepEqual(picked.slice(0, 4), ["a1", "b1", "c1", "a2"]);
  assert.deepEqual(picked.slice(5), ["c2", "a3", "b3", "c3"]);
  // The place "gone" left goes to the mix with the fewest songs shown.
  assert.match(picked[4]!, /^b/);
});

test("no mixes, no picks", () => {
  assert.deepEqual(
    magicQueueMixPicks([], () => 0),
    [],
  );
});
