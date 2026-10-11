import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  createSearchIndex,
  rememberSearch,
  type SearchEntry,
  type SearchKind,
  type SearchResults,
} from "./index.ts";

const artist = (name: string): SearchEntry => ({ kind: "artist", name });

type Song = SearchEntry & { readonly artist: string };
const song = (title: string, by: string, album: string): Song => ({
  kind: "song",
  name: title,
  also: [by, album],
  artist: by,
});

const names = (results: SearchResults<SearchEntry>): string[] =>
  results.groups.flatMap((group) => group.items.map((item) => item.name));

const artists = (results: SearchResults<Song>): string[] =>
  results.groups.flatMap((group) => group.items.map((item) => item.artist));

describe("search matching", () => {
  test('"beyo" finds "Beyoncé": case and accents are ignored, words match by prefix', () => {
    const index = createSearchIndex([artist("Beyoncé"), artist("Björk"), artist("Radiohead")]);
    assert.deepEqual(names(index.search("beyo")), ["Beyoncé"]);
  });

  test("punctuation separates words and apostrophes vanish", () => {
    const index = createSearchIndex([artist("Guns N' Roses"), artist("Sigur Rós")]);
    assert.deepEqual(names(index.search("guns n roses")), ["Guns N' Roses"]);
    assert.deepEqual(names(index.search("ROSES!")), ["Guns N' Roses"]);
    assert.deepEqual(names(index.search("ros")).toSorted(), ["Guns N' Roses", "Sigur Rós"]);
  });

  test("a name split by punctuation is also found spelled as one word", () => {
    const index = createSearchIndex([artist("AC/DC"), artist("a-ha"), artist("Acid Pauli")]);
    assert.deepEqual(names(index.search("acdc")), ["AC/DC"]);
    assert.deepEqual(names(index.search("aha")), ["a-ha"]);
    assert.deepEqual(names(index.search("ac dc")), ["AC/DC"]);
  });

  test("every word of the query has to match, in any order", () => {
    const index = createSearchIndex([artist("Massive Attack"), artist("Massive Töne")]);
    assert.deepEqual(names(index.search("attack mass")), ["Massive Attack"]);
    assert.deepEqual(names(index.search("massive attack x")), []);
  });

  test("a query without letters or digits finds nothing", () => {
    const index = createSearchIndex([artist("!!!"), artist("Beyoncé")]);
    assert.deepEqual(names(index.search("")), []);
    assert.deepEqual(names(index.search("  ")), []);
    assert.deepEqual(names(index.search("!!!")), []);
  });

  test("words in the middle of a name don't match from their middle", () => {
    const index = createSearchIndex([artist("Beyoncé")]);
    assert.deepEqual(names(index.search("yonce")), []);
  });

  test("a song is also found by its artist and album, and the query can mix them", () => {
    const index = createSearchIndex([
      song("Halo", "Beyoncé", "I Am... Sasha Fierce"),
      song("Halo", "Depeche Mode", "Violator"),
      song("Hunter", "Björk", "Homogenic"),
    ]);
    assert.deepEqual(artists(index.search("halo beyo")), ["Beyoncé"]);
    assert.deepEqual(artists(index.search("sasha")), ["Beyoncé"]);
    assert.deepEqual(artists(index.search("bjork")), ["Björk"]);
  });
});

const entry = (kind: SearchKind, name: string, also?: string[]): SearchEntry => ({
  kind,
  name,
  also,
});

const grouped = (results: SearchResults<SearchEntry>): [SearchKind, string[]][] =>
  results.groups.map((group) => [group.kind, group.items.map((item) => item.name)]);

describe("search results", () => {
  test("are grouped by type, each type once", () => {
    const index = createSearchIndex([
      entry("song", "Love Story", ["Taylor Swift", "Fearless"]),
      entry("genre", "Lovers Rock"),
      entry("song", "Lovely", ["Billie Eilish", "Lovely"]),
      entry("album", "Lover", ["Taylor Swift"]),
      entry("playlist", "Love songs"),
      entry("artist", "Love"),
      entry("artist", "Radiohead"),
    ]);
    const groups = grouped(index.search("love"));
    assert.deepEqual(groups.map(([kind]) => kind).toSorted(), [
      "album",
      "artist",
      "genre",
      "playlist",
      "song",
    ]);
    assert.deepEqual(groups.find(([kind]) => kind === "song")?.[1].toSorted(), [
      "Love Story",
      "Lovely",
    ]);
    assert.deepEqual(groups.find(([kind]) => kind === "artist")?.[1], ["Love"]);
  });

  test("best match first: the exact name, then names starting with the query, then other words, then artist or album", () => {
    const index = createSearchIndex([
      entry("song", "Crazy in Love", ["Beyoncé", "Dangerously in Love"]),
      entry("song", "Lovely", ["Billie Eilish", "Lovely"]),
      entry("song", "Glove", ["Lucky Soul", "Woman"]),
      entry("song", "Pressure", ["Love Inc", "Pressure"]),
      entry("song", "Love Story", ["Taylor Swift", "Fearless"]),
      entry("song", "Love", ["Lana Del Rey", "Lust for Life"]),
    ]);
    assert.deepEqual(names(index.search("love")), [
      "Love",
      "Love Story",
      "Lovely",
      "Crazy in Love",
      "Pressure",
    ]);
  });

  test("a leading The, A or An doesn't stand in the way of an exact match", () => {
    const index = createSearchIndex([
      artist("Beatles Revival Band"),
      artist("The Beatles"),
      artist("Beat Happening"),
    ]);
    assert.deepEqual(names(index.search("beatles")), ["The Beatles", "Beatles Revival Band"]);
  });

  test("equally good matches: the shorter name first, then alphabetical", () => {
    const index = createSearchIndex([
      artist("Love Yes"),
      artist("Love Now"),
      artist("Love Me Two"),
      artist("Lovers"),
      artist("Lovesong"),
    ]);
    assert.deepEqual(names(index.search("love")), [
      "Love Now",
      "Love Yes",
      "Love Me Two",
      "Lovers",
      "Lovesong",
    ]);
  });

  test("the top result is the best match of any type; artists, then albums, songs, playlists and genres win ties", () => {
    const index = createSearchIndex([
      entry("song", "Beyond", ["Daft Punk", "Random Access Memories"]),
      entry("album", "Beyoncé", ["Beyoncé"]),
      entry("artist", "Beyoncé"),
    ]);
    assert.deepEqual(index.search("beyo").top, entry("artist", "Beyoncé"));

    const ties = createSearchIndex([
      entry("genre", "Halo"),
      entry("playlist", "Halo"),
      entry("song", "Halo", ["Beyoncé", "I Am... Sasha Fierce"]),
    ]);
    assert.equal(ties.search("halo").top?.kind, "song");
  });

  test("a better match of a later type still makes the top result", () => {
    const index = createSearchIndex([
      entry("artist", "Halo Benders"),
      entry("song", "Halo", ["Beyoncé", "I Am... Sasha Fierce"]),
    ]);
    assert.deepEqual(
      index.search("halo").top,
      entry("song", "Halo", ["Beyoncé", "I Am... Sasha Fierce"]),
    );
  });

  test("groups are ordered by their best match", () => {
    const index = createSearchIndex([
      entry("album", "Halo Jones", ["Various Artists"]),
      entry("artist", "Halo Benders"),
      entry("genre", "Haloween Metal"),
      entry("song", "Halo", ["Beyoncé", "I Am... Sasha Fierce"]),
    ]);
    assert.deepEqual(
      index.search("halo").groups.map((group) => group.kind),
      ["song", "artist", "album", "genre"],
    );
  });

  test("a limit keeps the best matches of each type and counts them all", () => {
    const index = createSearchIndex([
      entry("song", "Love Story", ["Taylor Swift", "Fearless"]),
      entry("song", "Lovely", ["Billie Eilish", "Lovely"]),
      entry("song", "Love", ["Lana Del Rey", "Lust for Life"]),
      entry("song", "Crazy in Love", ["Beyoncé", "Dangerously in Love"]),
      entry("artist", "Love"),
    ]);
    const results = index.search("love", { limit: 2 });
    assert.deepEqual(
      results.groups.map((group) => [
        group.kind,
        group.items.map((item) => item.name),
        group.total,
      ]),
      [
        ["artist", ["Love"], 1],
        ["song", ["Love", "Love Story"], 4],
      ],
    );
  });

  test("typing, deleting and retyping gives the same results as a fresh search", () => {
    const entries = [
      entry("song", "Love Story", ["Taylor Swift", "Fearless"]),
      entry("song", "Lovely", ["Billie Eilish", "Lovely"]),
      entry("song", "Lost", ["Frank Ocean", "Channel Orange"]),
      entry("song", "Crazy in Love", ["Beyoncé", "Dangerously in Love"]),
      entry("song", "Halo", ["Beyoncé", "I Am... Sasha Fierce"]),
      entry("artist", "Love"),
      entry("artist", "AC/DC"),
    ];
    const typed = createSearchIndex(entries);
    for (const query of [
      "l",
      "lo",
      "lov",
      "love",
      "love s",
      "lo",
      "los",
      "",
      "b",
      "be",
      "ac",
      "acd",
    ]) {
      assert.deepEqual(
        typed.search(query, { limit: 3 }),
        createSearchIndex(entries).search(query, { limit: 3 }),
        query,
      );
    }
  });

  test("keeps up with typing on a library of 50,000 songs", () => {
    const syllables = ["la", "lo", "ve", "ri", "ka", "mo", "ne", "sa", "ti", "be", "yo", "ce"];
    let seed = 1;
    const pick = (): string => {
      seed = (seed * 16_807) % 2_147_483_647;
      return syllables[seed % syllables.length]!;
    };
    const name = (words: number): string =>
      Array.from({ length: words }, () => pick() + pick()).join(" ");
    const entries: SearchEntry[] = [];
    for (let i = 0; i < 2000; i++) entries.push(entry("artist", name(2)));
    for (let i = 0; i < 5000; i++) entries.push(entry("album", name(3), [name(2)]));
    for (let i = 0; i < 50_000; i++) entries.push(entry("song", name(3), [name(2), name(3)]));

    const started = performance.now();
    const index = createSearchIndex(entries);
    for (const query of ["l", "lo", "lov", "love", "love s", "love sa", "love s", "love", "lo"]) {
      index.search(query, { limit: 100 });
    }
    // Generous for CI; on a phone the app also defers results behind the keystroke.
    assert.ok(performance.now() - started < 2000);
  });

  test("nothing found: no groups and no top result", () => {
    const results = createSearchIndex([artist("Björk")]).search("zz");
    assert.deepEqual(results, { top: null, groups: [] });
  });
});

describe("rememberSearch", () => {
  test("puts the newest search first", () => {
    assert.deepEqual(rememberSearch(["bjork", "radiohead"], "beyonce"), [
      "beyonce",
      "bjork",
      "radiohead",
    ]);
  });

  test("searching again moves it to the top, ignoring case, accents and punctuation, with the newest spelling", () => {
    assert.deepEqual(rememberSearch(["bjork", "radiohead", "AC/DC"], "Björk"), [
      "Björk",
      "radiohead",
      "AC/DC",
    ]);
    assert.deepEqual(rememberSearch(["bjork", "AC/DC"], "ac dc"), ["ac dc", "bjork"]);
  });

  test("keeps the search as typed, without surrounding or repeated spaces", () => {
    assert.deepEqual(rememberSearch([], "  massive   attack "), ["massive attack"]);
  });

  test("ignores a search with no letters or digits", () => {
    const recent = ["bjork"];
    assert.equal(rememberSearch(recent, "   "), recent);
    assert.equal(rememberSearch(recent, "?!"), recent);
  });

  test("keeps the 10 most recent searches", () => {
    const recent = Array.from({ length: 10 }, (_, i) => `search ${i + 1}`);
    const next = rememberSearch(recent, "newest");
    assert.equal(next.length, 10);
    assert.equal(next[0], "newest");
    assert.equal(next[9], "search 9");
  });
});
