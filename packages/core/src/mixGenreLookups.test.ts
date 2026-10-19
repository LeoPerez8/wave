import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  discoverMixSongs,
  genreProfile,
  mixAffinity,
  magicArtistKey,
  magicRadioLookups,
  mixProfileLookupsNext,
  ytTrackId,
  type DiscoverRadioSong,
  type GenreProfileOf,
  type MagicSession,
} from "./index.ts";

const radioSong = (
  videoId: string,
  artists: readonly string[],
  { video = false, title = `Song ${videoId}` } = {},
): DiscoverRadioSong => ({
  videoId,
  title,
  artists,
  album: null,
  durationMs: null,
  artworkUrl: null,
  explicit: false,
  video,
});

const rock = genreProfile([{ genre: "Rock" }]);
const jazz = genreProfile([{ genre: "Jazz" }]);
/** M… artists match a rock seed, X… miss it, N… have no genre known, the rest were never looked up. */
const profileOf: GenreProfileOf = (artist) =>
  artist.startsWith("M")
    ? rock
    : artist.startsWith("X")
      ? jazz
      : artist.startsWith("N")
        ? null
        : undefined;
const filter = {
  known: () => false,
  taken: new Set<string>(),
  affinity: mixAffinity(rock, profileOf),
};

const songsBy = (prefix: string, count: number) =>
  Array.from({ length: count }, (_, n) => radioSong(`${prefix}${n}`, [`${prefix}${n}`]));

describe("The genres a mix looks up next", () => {
  test("are the artists of the songs it would keep next, in the radio's order", () => {
    const radio = [radioSong("m", ["M1"]), ...songsBy("U", 4)];
    assert.deepEqual(mixProfileLookupsNext(radio, { filter, profileOf, enough: 3 }), ["U0", "U1"]);
  });

  test("are none once the mix's 50 songs match, so mixes stay as long as before", () => {
    const unseen = radioSong("u", ["U"]);
    const matching = (count: number) => [...songsBy("M", count), unseen];
    assert.deepEqual(mixProfileLookupsNext(matching(50), { filter, profileOf }), []);
    assert.deepEqual(mixProfileLookupsNext(matching(49), { filter, profileOf }), ["U"]);
  });

  test("skip the songs the mix leaves out anyway", () => {
    const radio = [
      radioSong("v", ["U0"], { video: true }),
      radioSong("k", ["U1"]),
      radioSong("t", ["U2"]),
      radioSong("x", ["X"]),
      radioSong("n", ["N"]),
      radioSong("a", ["U3"], { title: "Again" }),
      radioSong("a", ["U4"]),
      radioSong("a2", ["U3"], { title: "Again" }),
      radioSong("u", ["U5"]),
    ];
    const leaving = {
      ...filter,
      known: (song: DiscoverRadioSong) => song.videoId === "k",
      taken: new Set(["t"]),
    };
    assert.deepEqual(mixProfileLookupsNext(radio, { filter: leaving, profileOf, enough: 2 }), [
      "U3",
      "U5",
    ]);
  });

  test("ask nothing more for a song one of whose artists matches, and the rest for one whose known artist misses", () => {
    const radio = [radioSong("m", ["M", "U0"]), radioSong("x", ["X", "U1"])];
    assert.deepEqual(mixProfileLookupsNext(radio, { filter, profileOf }), ["U1"]);
  });

  test("ask for each artist once, and never for a name that isn't an artist's", () => {
    const radio = [
      radioSong("a", ["Fall Out Boy", "Various Artists"]),
      radioSong("b", ["fall out boy"]),
      radioSong("c", ["Various Artists"]),
    ];
    assert.deepEqual(mixProfileLookupsNext(radio, { filter, profileOf }), ["Fall Out Boy"]);
  });

  test("count an artist asked already as one with no genre known, so a failed lookup isn't asked again", () => {
    const radio = songsBy("U", 3);
    const asked = ["u0"];
    assert.deepEqual(mixProfileLookupsNext(radio, { filter, profileOf, asked, enough: 1 }), ["U1"]);
    const all = ["U0", "U1", "U2"];
    assert.deepEqual(mixProfileLookupsNext(radio, { filter, profileOf, asked: all }), []);
  });

  test("ask for the songs a refresh avoids only to make up the mix's ten songs", () => {
    const avoided = songsBy("A", 10);
    const refresh = { ...filter, avoid: new Set(avoided.map((song) => song.videoId)) };
    const lookups = (radio: readonly DiscoverRadioSong[]) =>
      mixProfileLookupsNext(radio, { filter: refresh, profileOf });
    assert.deepEqual(lookups([...avoided, ...songsBy("M", 10)]), []);
    assert.deepEqual(lookups([...avoided, radioSong("u", ["U"]), ...songsBy("M", 3)]), ["U"]);
    assert.deepEqual(lookups([...avoided, ...songsBy("M", 3)]), [
      "A0",
      "A1",
      "A2",
      "A3",
      "A4",
      "A5",
      "A6",
    ]);
  });
});

// Deezer, as the lookups find it: in every 30 artists, three play jazz and two have no genre.
const deezer = (artist: string) => {
  const n = Number(artist.slice(1));
  return n % 10 === 0 ? jazz : n % 15 === 7 ? null : rock;
};

describe("A mix whose genres are looked up as they're needed", () => {
  const radio = Array.from({ length: 150 }, (_, n) => radioSong(`s${n}`, [`D${n % 120}`]));

  /** Looks up what the rule asks, round after round: the profiles found and how many lookups. */
  const lookedUp = () => {
    const found = new Map<string, ReturnType<typeof deezer>>();
    const of: GenreProfileOf = (artist) => (found.has(artist) ? found.get(artist) : undefined);
    const known = { ...filter, affinity: mixAffinity(rock, of) };
    for (;;) {
      const names = mixProfileLookupsNext(radio, { filter: known, profileOf: of });
      if (names.length === 0) return { found, filter: known };
      for (const name of names) found.set(name, deezer(name));
    }
  };

  test("keeps the songs every lookup would have kept, leaving out those that miss", () => {
    const everything = { ...filter, affinity: mixAffinity(rock, deezer) };
    const kept = discoverMixSongs([radio], lookedUp().filter);
    assert.deepEqual(ids(kept), ids(discoverMixSongs([radio], everything)));
    assert.equal(kept.length, 50);
    assert.ok(kept.every((song) => deezer(song.artists[0] ?? "") === rock));
  });

  test("looks up the artists of the radio's first 60 songs, where its first 50 rock songs are, of its 120", () => {
    assert.equal(lookedUp().found.size, 60);
  });
});

const ids = (songs: readonly { videoId: string }[]) => songs.map((song) => song.videoId);
const isU0 = (song: DiscoverRadioSong) => song.videoId === "U0";

describe("The genres a Magic Queue looks up next", () => {
  const session: MagicSession = {
    id: "m1",
    seed: { kind: "artist", id: "a1", title: "Seed" },
    used: [],
    batches: 1,
    artistAffinity: {},
    genreAffinity: {},
    excludedArtists: [],
    ytShare: 0.5,
    radioArtists: ["Seed"],
    seedProfile: Object.fromEntries(rock ?? []),
  };
  const options = { profileOf, inLibrary: () => false };

  test("are those of two batches' worth of candidates, in the radio's order", () => {
    const radio = songsBy("U", 30);
    assert.deepEqual(magicRadioLookups(session, radio, options), ids(radio.slice(0, 20)));
    assert.deepEqual(magicRadioLookups(session, [...songsBy("M", 20), ...radio], options), []);
  });

  test("go further down the radio once batches queued its candidates, past artists the session excluded", () => {
    const queued = songsBy("M", 20);
    const later: MagicSession = {
      ...session,
      used: queued.map((song) => ytTrackId(song.videoId)),
      excludedArtists: [magicArtistKey("U0")],
    };
    const radio = [...queued, ...songsBy("U", 30)];
    assert.deepEqual(magicRadioLookups(later, radio, options), ids(radio.slice(21, 41)));
  });

  test("leave out songs the Library has", () => {
    assert.deepEqual(magicRadioLookups(session, songsBy("U", 3), { ...options, inLibrary: isU0 }), [
      "U1",
      "U2",
    ]);
  });
});
