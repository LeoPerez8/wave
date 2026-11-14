import assert from "node:assert/strict";
import { test } from "node:test";
import {
  GENIUS_LYRICS_SEARCH_LIMIT,
  settleGeniusLyricsSearch,
  uniqueGeniusLyricsHits,
  type GeniusLyricsHit,
} from "./index.ts";

const hit = (id: number, title = `Song ${id}`, artist = "Artist"): GeniusLyricsHit => ({
  id,
  title,
  artist,
  credit: artist,
  url: `https://genius.com/${id}`,
  artworkUrl: null,
});

test("Genius lyric results omit the songs a Lyrics row shows and keep the first page bounded", () => {
  const hits = [hit(1, "Halo", "Beyonce"), ...Array.from({ length: 25 }, (_, i) => hit(i + 2))];
  const unique = uniqueGeniusLyricsHits(hits, [
    { title: "HALO (Live)", artist: "Beyonce", album: "Album", durationMs: 0 },
  ]);
  assert.equal(
    unique.some((item) => item.id === 1),
    false,
  );
  assert.equal(unique.length, GENIUS_LYRICS_SEARCH_LIMIT);
  assert.equal(unique[0]?.id, 2);
});

test("a Genius hit no Lyrics row shows is kept, the original before its covers", () => {
  const hits = [
    hit(1, "Just Pretend (Acoustic)", "The Veer Union"),
    hit(2, "Just Pretend", "Bad Omens"),
    hit(3, "Just Pretend", "Sam Pounds"),
  ];
  assert.deepEqual(
    uniqueGeniusLyricsHits(hits, []).map((item) => item.id),
    [1, 2, 3],
  );
  assert.deepEqual(
    uniqueGeniusLyricsHits(hits, [
      { title: "Just Pretend", artist: "Bad Omens", album: null, durationMs: 0 },
    ]).map((item) => item.id),
    [1, 3],
  );
});

test("a late Genius answer cannot settle a newer lyric query", () => {
  const loading = { query: "second lyric query", status: "loading" } as const;
  assert.equal(
    settleGeniusLyricsSearch(loading, "first lyric query", { status: "failed" }),
    loading,
  );
  assert.deepEqual(
    settleGeniusLyricsSearch(loading, loading.query, { status: "hits", hits: [hit(1)] }),
    { query: loading.query, status: "hits", hits: [hit(1)] },
  );
});
