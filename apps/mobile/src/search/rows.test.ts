/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { GeniusLyricsHit, SearchResults } from "@wave/core";
import type { SongRow } from "@/library/LibraryStore";
import type { LocalLyricsHit } from "./lyricsSearch.ts";
import type { SearchHit } from "./searchIndex.ts";
import { resultRows, type PlacedYtSongs } from "./rows.ts";

const noPlaced: PlacedYtSongs = { songs: [], rowOf: new Map() };
const empty: SearchResults<SearchHit> = { top: null, groups: [] };

const lyricHits = (count: number): LocalLyricsHit[] =>
  Array.from({ length: count }, (_, index) => ({
    source: "library",
    song: { id: index + 1, title: `Song ${index + 1}`, artist: "Artist" } as SongRow,
    line: "Trem bala",
    ranges: [
      { start: 0, end: 4 },
      { start: 5, end: 9 },
    ],
  }));

const geniusHits = (count: number): GeniusLyricsHit[] =>
  Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    title: `Genius song ${index + 1}`,
    artist: "Artist",
    credit: "Artist",
    url: `https://genius.com/${index + 1}`,
    artworkUrl: null,
  }));

describe("Search lyric section", () => {
  test("three or more words put Lyrics first", () => {
    const rows = resultRows(
      empty,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      lyricHits(1),
      false,
      "one two three",
    );
    assert.equal(rows[0]?.type, "heading");
    assert.equal(rows[0]?.key, "heading:lyrics");
  });

  test("short queries put Lyrics after Songs and initially show five with Show all", () => {
    const songs: SearchResults<SearchHit> = {
      top: null,
      groups: [{ kind: "song", items: [], total: 0 }],
    };
    const rows = resultRows(
      songs,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      lyricHits(6),
      false,
      "two words",
    );
    const heading = rows.findIndex((row) => row.key === "heading:lyrics");
    assert.ok(heading > rows.findIndex((row) => row.key === "heading:song"));
    assert.equal(rows.filter((row) => row.type === "lyric").length, 5);
    assert.equal(rows.at(-1)?.type, "moreLyrics");

    const expanded = resultRows(
      songs,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      lyricHits(6),
      true,
      "two words",
    );
    assert.equal(expanded.filter((row) => row.type === "lyric").length, 6);
    assert.equal(
      expanded.some((row) => row.type === "moreLyrics"),
      false,
    );
  });

  test("a song already in Songs is not repeated in Lyrics", () => {
    const song = { id: 1, title: "Trem bala", artist: "Artist" } as SongRow;
    const hit: SearchHit = { kind: "song", name: song.title, also: [], song };
    const results: SearchResults<SearchHit> = {
      top: hit,
      groups: [{ kind: "song", items: [hit], total: 1 }],
    };
    const rows = resultRows(
      results,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      lyricHits(1),
      false,
      "trem bala",
    );
    assert.equal(
      rows.some((row) => row.type === "lyric"),
      false,
    );
  });

  test("Genius follows local hits, shows five hits, and expands to its first page", () => {
    const rows = resultRows(
      empty,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      lyricHits(1),
      false,
      "one two three",
      geniusHits(20),
    );
    assert.equal(rows[1]?.type, "lyric");
    assert.equal(rows[2]?.type, "geniusLyric");
    assert.equal(rows.filter((row) => row.type === "geniusLyric").length, 5);
    assert.equal(rows.at(-1)?.type, "moreLyrics");

    const expanded = resultRows(
      empty,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      lyricHits(1),
      true,
      "one two three",
      geniusHits(20),
    );
    assert.equal(expanded.filter((row) => row.type === "geniusLyric").length, 20);
  });
});
