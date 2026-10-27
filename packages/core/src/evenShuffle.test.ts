import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { EMPTY_QUEUE, currentEntry, readShuffleKind, reduceQueue, upNext } from "./index.ts";
import type { QueueCommand, QueueState, Shuffle, ShuffleSong } from "./index.ts";

const songs = { kind: "songs", id: null } as const;

/** A deterministic random source (Park–Miller), so shuffles are repeatable. */
const seeded = (seed: number): (() => number) => {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
};

const SEEDS = Array.from({ length: 40 }, (_, i) => i * 7919 + 13);

const ids = (entries: readonly { trackId: string }[]): string[] =>
  entries.map((entry) => entry.trackId);

/** Plays [trackIds] from the Songs context, in order, from [startIndex]. */
const start = (trackIds: readonly string[], startIndex = 0): QueueState =>
  reduceQueue(EMPTY_QUEUE, { type: "play", trackIds, startIndex, context: songs }).state;

/**
 * Songs named `<artist>.<album>.<genre>.<n>` ("-" for an unknown album or no
 * genre), so a test reads each song's artist, album and genre off its id.
 */
const song = (artist: string, album = "-", genre = "-", n = 0): string =>
  `${artist}.${album}.${genre}.${n}`;

const artistOf = (id: string): string => id.split(".")[0]!;
const albumOf = (id: string): string => id.split(".")[1]!;
const genreOf = (id: string): string => id.split(".")[2]!;

/** The artist, album and genre of each of [trackIds], read off their ids. */
const songsOf = (trackIds: readonly string[]): [string, ShuffleSong][] =>
  trackIds.map((id) => {
    const [artist, album, genre] = id.split(".");
    return [
      id,
      {
        artist: artist!,
        album: album === "-" ? null : album!,
        genre: genre === "-" ? null : genre!,
      },
    ];
  });

/** Even Shuffle given the artist, album and genre of each of [trackIds], read off their ids. */
const even = (trackIds: readonly string[]): Shuffle => ({
  kind: "even",
  songs: new Map(songsOf(trackIds)),
});

const run = (state: QueueState, command: QueueCommand, seed: number, shuffle: Shuffle) =>
  reduceQueue(state, command, seeded(seed), shuffle);

/** How many neighbours in [trackIds] share what [of] reads off them. */
const repeats = (trackIds: readonly string[], of: (id: string) => string): number =>
  trackIds.filter((id, i) => i > 0 && of(id) === of(trackIds[i - 1]!)).length;

/** [count] songs by [artist], spread over [albums] and [genres] in turn. */
const many = (
  artist: string,
  count: number,
  albums: readonly string[] = ["-"],
  genres: readonly string[] = ["-"],
): string[] =>
  Array.from({ length: count }, (_, i) =>
    song(artist, albums[i % albums.length], genres[i % genres.length], i),
  );

describe("Even Shuffle", () => {
  test("never puts two songs by one artist side by side while another artist remains", () => {
    const tracks = [
      song("now"),
      ...many("a", 5),
      ...many("b", 4),
      ...many("c", 3),
      ...many("d", 2),
      ...many("e", 1),
    ];
    for (const seed of SEEDS) {
      const { state } = run(start(tracks), { type: "setShuffle", on: true }, seed, even(tracks));
      const rest = ids(upNext(state));
      assert.deepEqual(rest.toSorted(), tracks.slice(1).toSorted());
      assert.equal(repeats(rest, artistOf), 0, `seed ${seed}: ${rest.join(" ")}`);
    }
  });

  test("alternates two artists, the leftovers of the one with more songs closing the order", () => {
    const tracks = [...many("lana", 20), ...many("sleeptoken", 25)];
    for (const seed of SEEDS) {
      const { state } = run(
        EMPTY_QUEUE,
        { type: "play", trackIds: tracks, context: songs, shuffle: true },
        seed,
        even(tracks),
      );
      assert.equal(state.index, 0);
      assert.equal(state.shuffle, true);
      const order = ids(state.entries);
      assert.deepEqual(order.toSorted(), tracks.toSorted());
      const artists = order.map(artistOf);
      assert.deepEqual(
        artists.slice(0, 40),
        Array.from({ length: 20 }, () => ["sleeptoken", "lana"]).flat(),
        `seed ${seed}: ${artists.join(" ")}`,
      );
      assert.deepEqual(artists.slice(40), Array(5).fill("sleeptoken"));
    }
  });

  test("avoids the previous song's genre when another artist's song can follow", () => {
    // Three rock artists and three pop artists, two songs each, after a rock song.
    const tracks = [
      song("now", "-", "rock"),
      ...["r1", "r2", "r3"].flatMap((artist) => many(artist, 2, ["-"], ["rock"])),
      ...["p1", "p2", "p3"].flatMap((artist) => many(artist, 2, ["-"], ["pop"])),
    ];
    for (const seed of SEEDS) {
      const { state } = run(start(tracks), { type: "setShuffle", on: true }, seed, even(tracks));
      const order = ids(state.entries);
      assert.equal(repeats(order, genreOf), 0, `seed ${seed}: ${order.join(" ")}`);
      assert.equal(repeats(order, artistOf), 0, `seed ${seed}: ${order.join(" ")}`);
    }
  });

  test("alternates a lone artist's albums", () => {
    // An artist page's Shuffle: four songs from one album, three from another, two from a third.
    const tracks = [
      ...many("solo", 4, ["first"]),
      ...many("solo", 3, ["second"]),
      ...many("solo", 2, ["third"]),
    ];
    for (const seed of SEEDS) {
      const { state } = run(
        EMPTY_QUEUE,
        { type: "play", trackIds: tracks, context: songs, shuffle: true },
        seed,
        even(tracks),
      );
      const order = ids(state.entries);
      assert.deepEqual(order.toSorted(), tracks.toSorted());
      assert.equal(repeats(order, albumOf), 0, `seed ${seed}: ${order.join(" ")}`);
    }
  });

  test("alternates the albums of the artist left once the others run out", () => {
    // After the one other song, only solo's songs are left: their two albums take turns.
    const tracks = [
      song("now"),
      song("other"),
      ...many("solo", 3, ["first"]),
      ...many("solo", 3, ["second"]),
    ];
    for (const seed of SEEDS) {
      const { state } = run(start(tracks), { type: "setShuffle", on: true }, seed, even(tracks));
      const lone = ids(upNext(state)).filter((id) => artistOf(id) === "solo");
      const stretch = ids(upNext(state)).slice(-5);
      assert.deepEqual(stretch, lone.slice(-5));
      assert.equal(repeats(stretch, albumOf), 0, `seed ${seed}: ${stretch.join(" ")}`);
    }
  });

  // After one of a's songs plays, a and b have three songs each left: they alternate.
  const mixed = [...many("a", 4, ["x", "y"], ["rock"]), ...many("b", 3, ["z"], ["pop"])];

  test("keeps the playing song first, the next song by another artist", () => {
    for (const seed of SEEDS) {
      const { state, playback } = run(
        start(mixed, 2),
        { type: "setShuffle", on: true },
        seed,
        even(mixed),
      );
      assert.equal(playback, "keep");
      assert.equal(state.index, 0);
      assert.equal(currentEntry(state)?.trackId, mixed[2]);
      const order = ids(state.entries);
      assert.equal(repeats(order, artistOf), 0, `seed ${seed}: ${order.join(" ")}`);
      assert.equal(artistOf(order[1]!), "b");
    }
  });

  test("a tapped song with shuffle on plays first, its artist not next", () => {
    for (const seed of SEEDS) {
      const { state } = run(
        EMPTY_QUEUE,
        { type: "play", trackIds: mixed, startIndex: 5, context: songs, shuffle: true },
        seed,
        even(mixed),
      );
      assert.equal(currentEntry(state)?.trackId, mixed[5]);
      assert.equal(artistOf(ids(upNext(state))[0]!), "a");
    }
  });

  test("different randomness gives different orders", () => {
    const tracks = [song("now"), ...["a", "b", "c", "d"].flatMap((artist) => many(artist, 3))];
    const orders = new Set(
      SEEDS.map((seed) =>
        ids(
          upNext(run(start(tracks), { type: "setShuffle", on: true }, seed, even(tracks)).state),
        ).join(" "),
      ),
    );
    assert.ok(orders.size > SEEDS.length / 2, `${orders.size} orders`);
  });

  test("shuffles songs it knows nothing of, or with no genre or album, YT Music songs included", () => {
    const known = [song("a"), song("a", "-", "-", 1), song("b", "x"), song("c", "-", "rock")];
    const tracks = ["now", ...known, "yt:abc", "yt:def", "unknown"];
    const shuffle: Shuffle = {
      kind: "even",
      songs: new Map([
        ...songsOf(known),
        ["yt:abc", { artist: "a", album: "Streamed", genre: null }],
        ["yt:def", { artist: null, album: null, genre: null }],
      ]),
    };
    for (const seed of SEEDS) {
      const { state } = run(start(tracks), { type: "setShuffle", on: true }, seed, shuffle);
      assert.deepEqual(ids(state.entries).toSorted(), tracks.toSorted());
      assert.equal(currentEntry(state)?.trackId, "now");
    }
  });

  test("mixes the lined-up songs in, so their artist takes turns with the rest", () => {
    // Adele playing with three more of hers, three Amy Winehouse songs added to the queue.
    const context = many("adele", 4);
    const added = many("amy", 3);
    const queued = reduceQueue(start(context), { type: "addToQueue", trackIds: added }).state;
    for (const seed of SEEDS) {
      const { state } = run(queued, { type: "reshuffle" }, seed, even([...context, ...added]));
      const order = ids(state.entries);
      assert.equal(order[0], context[0]);
      assert.deepEqual(order.toSorted(), [...context, ...added].toSorted());
      assert.equal(repeats(order, artistOf), 0, `seed ${seed}: ${order.join(" ")}`);
    }
  });

  test("choosing it reshuffles Up Next the even way, turning shuffle on", () => {
    for (const seed of SEEDS) {
      const { state, playback } = run(start(mixed, 1), { type: "reshuffle" }, seed, even(mixed));
      assert.equal(state.shuffle, true);
      assert.equal(playback, "keep");
      assert.equal(currentEntry(state)?.trackId, mixed[1]);
      assert.equal(repeats(ids(state.entries), artistOf), 0);
    }
  });

  test("turning it off restores the original order", () => {
    const tracks = [song("now"), ...many("a", 4), ...many("b", 4)];
    for (const seed of SEEDS) {
      const shuffled = run(start(tracks, 3), { type: "setShuffle", on: true }, seed, even(tracks));
      const { state } = reduceQueue(shuffled.state, { type: "setShuffle", on: false });
      assert.deepEqual(ids(state.entries), tracks);
      assert.equal(currentEntry(state)?.trackId, tracks[3]);
    }
  });

  test("still orders every song with a random source stuck on one value", () => {
    const tracks = [song("now", "-", "rock"), ...many("a", 3, ["x"], ["rock"]), ...many("b", 3)];
    for (const value of [0, 0.5, 0.999]) {
      const { state } = reduceQueue(
        start(tracks),
        { type: "setShuffle", on: true },
        () => value,
        even(tracks),
      );
      const order = ids(state.entries);
      assert.deepEqual(order.toSorted(), tracks.toSorted());
      assert.equal(repeats(order, artistOf), 0, `${value}: ${order.join(" ")}`);
    }
  });
});

describe("readShuffleKind", () => {
  test("reads Even Shuffle when it was chosen", () => {
    assert.equal(readShuffleKind("even"), "even");
  });
});
