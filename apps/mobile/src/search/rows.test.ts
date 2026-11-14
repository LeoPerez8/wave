/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type { GeniusLyricsHit, SearchResults } from "@wave/core";
import type { SongRow } from "@/library/LibraryStore";
import type { NativeYtSong } from "@/native/waveYtMusic";
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

  test("a Genius hit for a Library song shows unless a local result shows that song", () => {
    const original = {
      id: 7,
      title: "Just Pretend",
      artist: "Bad Omens",
      album: "The Death of Peace of Mind",
      durationMs: 205_000,
    } as SongRow;
    const hits: GeniusLyricsHit[] = [
      {
        id: 1,
        title: "Just Pretend (Acoustic)",
        artist: "The Veer Union",
        credit: "The Veer Union",
        url: "https://genius.com/1",
        artworkUrl: null,
      },
      {
        id: 2,
        title: "Just Pretend",
        artist: "Bad Omens",
        credit: "Bad Omens",
        url: "https://genius.com/2",
        artworkUrl: null,
      },
    ];
    const query = "i can wait for you at the bottom";
    const geniusIds = (rows: ReturnType<typeof resultRows>) =>
      rows.flatMap((row) => (row.type === "geniusLyric" ? [row.hit.id] : []));

    // The Library holds the song, but its file has no lyrics: no local result shows it.
    const noLocal = resultRows(
      empty,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      [],
      false,
      query,
      hits,
    );
    assert.deepEqual(geniusIds(noLocal), [1, 2]);

    const lyricRow: LocalLyricsHit = {
      source: "library",
      song: original,
      line: "I can wait for you at the bottom",
      ranges: [{ start: 0, end: 32 }],
    };
    const local = resultRows(
      empty,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      [lyricRow],
      false,
      query,
      hits,
    );
    assert.deepEqual(geniusIds(local), [1]);

    const inSongs: SearchResults<SearchHit> = {
      top: null,
      groups: [
        {
          kind: "song",
          items: [{ kind: "song", name: original.title, also: [], song: original }],
          total: 1,
        },
      ],
    };
    const shownInSongs = resultRows(
      inSongs,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      [lyricRow],
      false,
      query,
      hits,
    );
    assert.deepEqual(geniusIds(shownInSongs), [1]);

    const placedLibrary: PlacedYtSongs = {
      songs: [
        {
          source: "library",
          song: {
            videoId: "just-pretend",
            title: "Just Pretend",
            artists: ["Bad Omens"],
            album: null,
            albumId: null,
            durationMs: 205_000,
            artworkUrl: null,
            explicit: false,
          },
          track: original,
        },
      ],
      rowOf: new Map(),
    };
    const placedInSongs = resultRows(
      empty,
      new Set(),
      null,
      placedLibrary,
      null,
      "en",
      [],
      false,
      query,
      hits,
    );
    assert.deepEqual(geniusIds(placedInSongs), [1]);
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

  test("online lyrics states appear in Lyrics only for eligible queries", () => {
    const signedOut = resultRows(
      empty,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      [],
      false,
      "one two three",
      [],
      "signedOut",
    );
    assert.deepEqual(
      signedOut.map((row) => row.type),
      ["heading", "geniusState"],
    );
    const signInRow = signedOut.at(-1);
    assert.equal(signInRow?.type, "geniusState");
    if (signInRow?.type === "geniusState") assert.equal(signInRow.status, "signedOut");

    const offline = resultRows(
      empty,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      lyricHits(1),
      false,
      "one two three",
      [],
      "offline",
    );
    assert.equal(
      offline.some((row) => row.type === "lyric"),
      true,
    );
    assert.equal(offline.at(-1)?.type, "geniusState");

    const short = resultRows(
      empty,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      [],
      false,
      "two words",
      [],
      "failed",
    );
    assert.equal(
      short.some((row) => row.type === "geniusState"),
      false,
    );
  });

  test("saved streamed songs keep one lyric row and leave out their YT result duplicate", () => {
    const song = {
      videoId: "streamed-video",
      title: "Streamed song",
      artists: ["Artist"],
      album: null,
      albumId: null,
      durationMs: 180_000,
      artworkUrl: null,
      explicit: false,
    } satisfies NativeYtSong;
    const hit = {
      source: "stream",
      song,
      line: "remembered lyric",
      ranges: [{ start: 0, end: 10 }],
    } as const;
    const rows = resultRows(
      empty,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      [hit],
      false,
      "three words here",
    );
    const lyric = rows.find((row) => row.type === "lyric");
    assert.equal(lyric?.type, "lyric");
    if (lyric?.type === "lyric") {
      assert.equal(lyric.key, "lyrics:yt:streamed-video");
      assert.equal(lyric.hit.source, "stream");
    }

    const sameSong = resultRows(
      empty,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      [hit],
      false,
      "three words here",
      [
        {
          id: 99,
          title: song.title,
          artist: "Artist",
          credit: "Artist",
          url: "https://genius.com/streamed-song",
          artworkUrl: null,
        },
      ],
    );
    assert.equal(
      sameSong.some((row) => row.type === "geniusLyric"),
      false,
    );

    const alreadyShown: PlacedYtSongs = {
      songs: [{ source: "stream", song }],
      rowOf: new Map([[song.videoId, 0]]),
    };
    const deduplicated = resultRows(
      empty,
      new Set(),
      null,
      alreadyShown,
      null,
      "en",
      [hit],
      false,
      "three words here",
    );
    assert.equal(
      deduplicated.some((row) => row.type === "lyric"),
      false,
    );
  });
});
