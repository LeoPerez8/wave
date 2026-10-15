/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import type { YtArtistSaved } from "@wave/core";

import { openTestDatabase, type TestDatabase } from "./testDatabase.ts";
import { saveYtArtist, selectYtArtist } from "./ytArtists.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

const instantCrush = {
  videoId: "khnokW3Mw24",
  title: "Instant Crush (feat. Julian Casablancas)",
  artists: ["Daft Punk", "Julian Casablancas"],
  album: "Random Access Memories",
  durationMs: null,
  artworkUrl: "https://yt3.googleusercontent.com/cover=w120-h120",
  explicit: false,
};

const found: YtArtistSaved = {
  outcome: "found",
  checkedAt: 1_000,
  browseId: "UCRr1xG_2WIDs18a6cIiCxeA",
  page: {
    name: "Daft Punk",
    songs: [instantCrush],
    songsPlaylistId: "OLAK5uy_lNVBcjNtiCwq-n95uoxJ-Gd4vsfMkyZNs",
    allSongs: [instantCrush, { ...instantCrush, videoId: "veoQXniI6mI", title: "Touch" }],
    albums: [
      {
        kind: "album",
        browseId: "MPREb_K8qWMWVqXGi",
        title: "Random Access Memories",
        artists: ["Daft Punk"],
        year: 2013,
        artworkUrl: null,
      },
    ],
    singles: [
      {
        kind: "album",
        browseId: "MPREb_X1DQ1j0PPrX",
        title: "GLBTM (Studio Outtakes)",
        artists: ["Daft Punk"],
        year: 2023,
        artworkUrl: null,
      },
    ],
  },
};

describe("the artist page's saved YT Music section", () => {
  test("nothing is saved for an artist at first", () => {
    assert.equal(selectYtArtist(db, "daft punk"), null);
  });

  test("a found artist is kept whole: the match, when, the page's songs, every song, albums and singles", () => {
    saveYtArtist(db, "daft punk", found);
    assert.deepEqual(selectYtArtist(db, "daft punk"), found);
    assert.equal(selectYtArtist(db, "justice"), null);
  });

  test("'no match' is kept too, and a later answer replaces it", () => {
    saveYtArtist(db, "daft punk", { outcome: "unmatched", checkedAt: 500 });
    assert.deepEqual(selectYtArtist(db, "daft punk"), { outcome: "unmatched", checkedAt: 500 });
    saveYtArtist(db, "daft punk", found);
    assert.deepEqual(selectYtArtist(db, "daft punk"), found);
  });
});
