import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  magicQueueMixPicks,
  magicQueueRow,
  magicQueueSeedId,
  magicQueueShown,
  type BlendedDiscoverMix,
  type DiscoverMixesSection,
  type DiscoverMixSong,
  type MagicQueueSeed,
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
  seed: { kind: "artist", name: artist, from: "chart" },
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

/** A Library song with a file, as the row's pool read it. */
const file = (id: number): MagicQueueSeed<number> => ({ source: "library", song: id });

/** A playlist's YT Music entry, as the row's pool read it. */
const entry = (videoId: string): MagicQueueSeed<number> => ({
  source: "stream",
  song: song(videoId, "e"),
});

const SKELETON: DiscoverMixesSection = { kind: "skeleton", failed: false };
const HIDDEN: DiscoverMixesSection = { kind: "hidden", failed: false };
const FAILED: DiscoverMixesSection = { kind: "empty", failed: true };

const chartMixes = [mix("a", 10), mix("b", 10), mix("c", 10)];

test("with YT Music off the row is hidden, Library songs or mixes alike", () => {
  for (const seeds of [[file(1), entry("x")], []])
    assert.deepEqual(magicQueueRow({ ytMusic: false, seeds, artistMixes: mixes(chartMixes) }), {
      kind: "hidden",
    });
});

test("the row waits hidden until the Library has been read", () => {
  assert.deepEqual(magicQueueRow({ ytMusic: true, seeds: null, artistMixes: mixes(chartMixes) }), {
    kind: "hidden",
  });
});

test("a Library with songs to show fills the row, whatever mixes exist", () => {
  const seeds = [file(1), file(2), file(3)];
  assert.deepEqual(magicQueueRow({ ytMusic: true, seeds, artistMixes: mixes(chartMixes) }), {
    kind: "seeds",
    seeds,
  });
  assert.deepEqual(magicQueueRow({ ytMusic: true, seeds: [file(7)], artistMixes: SKELETON }), {
    kind: "seeds",
    seeds: [file(7)],
  });
});

test("with no Library song with a file, the playlists' YT Music entries fill the row", () => {
  const seeds = [entry("x"), entry("y")];
  for (const artistMixes of [mixes(chartMixes), SKELETON, HIDDEN])
    assert.deepEqual(magicQueueRow({ ytMusic: true, seeds, artistMixes }), {
      kind: "seeds",
      seeds,
    });
});

test("files and entries share the row", () => {
  const seeds = [entry("x"), file(1), entry("y")];
  assert.deepEqual(magicQueueRow({ ytMusic: true, seeds, artistMixes: mixes(chartMixes) }), {
    kind: "seeds",
    seeds,
  });
});

test("with no files and no playlist entries, the row takes its songs from the Artist mixes", () => {
  assert.deepEqual(magicQueueRow({ ytMusic: true, seeds: [], artistMixes: mixes(chartMixes) }), {
    kind: "mixes",
    mixes: chartMixes,
  });
});

test("an empty Library takes the row's songs only from the mixes seeded from the chart", () => {
  const played: BlendedDiscoverMix = {
    ...mix("p", 10),
    seed: { kind: "artist", name: "p", from: "plays" },
  };
  const saved: BlendedDiscoverMix = { ...mix("s", 10), seed: { kind: "artist", name: "s" } };
  assert.deepEqual(
    magicQueueRow({
      ytMusic: true,
      seeds: [],
      artistMixes: mixes([played, chartMixes[0]!, saved, chartMixes[1]!]),
    }),
    { kind: "mixes", mixes: [chartMixes[0], chartMixes[1]] },
  );
});

test("an empty Library with no mix seeded from the chart hides the row", () => {
  const similar: BlendedDiscoverMix = {
    ...mix("s", 10),
    seed: { kind: "artist", name: "s", from: "similar" },
  };
  assert.deepEqual(magicQueueRow({ ytMusic: true, seeds: [], artistMixes: mixes([similar]) }), {
    kind: "hidden",
  });
});

test("an empty Library shows skeletons while the first mixes build", () => {
  assert.deepEqual(magicQueueRow({ ytMusic: true, seeds: [], artistMixes: SKELETON }), {
    kind: "skeleton",
  });
});

test("an empty Library without mixes hides the row", () => {
  for (const artistMixes of [HIDDEN, FAILED])
    assert.deepEqual(magicQueueRow({ ytMusic: true, seeds: [], artistMixes }), {
      kind: "hidden",
    });
});

test("mixes with no streamed song to start from leave the row hidden", () => {
  const onlyLibrary: BlendedDiscoverMix = { ...mix("a", 0), songs: [kept(1)] };
  assert.deepEqual(magicQueueRow({ ytMusic: true, seeds: [], artistMixes: mixes([onlyLibrary]) }), {
    kind: "hidden",
  });
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

describe("the row as drawn, its mixes' songs picked", () => {
  const row = (shown: readonly BlendedDiscoverMix[]) =>
    magicQueueRow<number>({ ytMusic: true, seeds: [], artistMixes: mixes(shown) });

  test("a fresh draw picks nine of the mixes' songs", () => {
    const { shown, picks } = magicQueueShown(row(chartMixes), null, () => 0);
    assert.deepEqual(shown.kind === "mixes" && ids(shown.songs), [
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
    assert.deepEqual(picks?.songs, shown.kind === "mixes" ? shown.songs : null);
  });

  test("keeps its picks while the mixes are the same ones, however often it's drawn", () => {
    const first = magicQueueShown(row(chartMixes), null, Math.random);
    // A plays-seeded mix appearing leaves the chart's mixes as they were.
    const played: BlendedDiscoverMix = {
      ...mix("p", 10),
      seed: { kind: "artist", name: "p", from: "plays" },
    };
    const again = magicQueueShown(row([...chartMixes, played]), first.picks, Math.random);
    assert.equal(again.picks, first.picks);
  });

  test("rebuilt mixes keep the songs still in them in their places", () => {
    const first = magicQueueShown(row(chartMixes), null, () => 0);
    const rebuilt = [mix("a", 10), mix("b", 10), mix("d", 10)];
    const { shown } = magicQueueShown(row(rebuilt), first.picks, () => 0);
    const picked = shown.kind === "mixes" ? ids(shown.songs) : [];
    assert.deepEqual(
      [picked[0], picked[1], picked[3], picked[4], picked[6], picked[7]],
      ["a1", "b1", "a2", "b2", "a3", "b3"],
    );
    for (const place of [2, 5, 8]) assert.match(picked[place]!, /^d/);
  });

  test("the pool's seeds, a skeleton or nothing are drawn as the row says", () => {
    const pool = magicQueueRow({
      ytMusic: true,
      seeds: [file(1), entry("x")],
      artistMixes: SKELETON,
    });
    assert.deepEqual(magicQueueShown(pool, null, () => 0).shown, pool);
    const skeleton = magicQueueRow<number>({ ytMusic: true, seeds: [], artistMixes: SKELETON });
    assert.deepEqual(magicQueueShown(skeleton, null, () => 0).shown, { kind: "skeleton" });
  });
});

test("a seed is kept by its Library id or its video id", () => {
  const seeds: MagicQueueSeed<{ id: number }>[] = [
    { source: "library", song: { id: 4 } },
    { source: "stream", song: song("x", "e") },
  ];
  assert.deepEqual(seeds.map(magicQueueSeedId), [4, "x"]);
});
