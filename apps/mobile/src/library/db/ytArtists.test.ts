/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import type { YtArtistSaved } from "@wave/core";
import { sql } from "drizzle-orm";

import { openTestDatabase, type TestDatabase } from "./testDatabase.ts";
import { saveYtArtist, selectYtArtist, selectYtArtistSimilar } from "./ytArtists.ts";

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

  test("a saved page whose every-song list isn't a list can't be read back", () => {
    const broken = { ...found.page, allSongs: { videoId: "khnokW3Mw24" } };
    // Saved as an older or damaged build could have written it.
    saveYtArtist(db, "daft punk", { ...found, page: broken } as unknown as YtArtistSaved);
    assert.equal(selectYtArtist(db, "daft punk"), null);
  });
});

describe("the saved pages' similar artists, for the artist graph", () => {
  const portishead = { name: "Portishead", browseId: "UCportishead", audience: 1_000 };

  test("every found page gives its artist and who 'Fans might also like', in its order", () => {
    saveYtArtist(db, "daft punk", {
      ...found,
      page: { ...found.page, similar: [portishead, { ...portishead, name: "Justice" }] },
    });
    saveYtArtist(db, "yt:UCjustice", { ...found, page: { ...found.page, name: "Justice" } });
    saveYtArtist(db, "air", { outcome: "unmatched", checkedAt: 500 });
    assert.deepEqual(selectYtArtistSimilar(db), [
      { name: "Daft Punk", similar: [portishead, { ...portishead, name: "Justice" }] },
      { name: "Justice", similar: [] },
    ]);
  });

  test("a page that can't be read, or whose similar artists aren't a list, gives none", () => {
    saveYtArtist(db, "daft punk", {
      ...found,
      page: { ...found.page, similar: { name: "Portishead" } },
    } as unknown as YtArtistSaved);
    db.run(
      sql`INSERT INTO yt_artists (artist_key, outcome, checked_at, browse_id, page) VALUES ('x', 'found', 1, 'UCx', 'not json')`,
    );
    assert.deepEqual(selectYtArtistSimilar(db), [{ name: "Daft Punk", similar: [] }]);
  });

  test("a similar artist saved without a name or a page id is left out, the others kept", () => {
    saveYtArtist(db, "daft punk", {
      ...found,
      page: {
        ...found.page,
        similar: [null, { name: "Justice" }, { browseId: "UCx" }, portishead, "Air"],
      },
    } as unknown as YtArtistSaved);
    assert.deepEqual(selectYtArtistSimilar(db), [
      {
        name: "Daft Punk",
        similar: [{ name: "Portishead", browseId: "UCportishead", audience: 1_000 }],
      },
    ]);
  });

  test("a similar artist's audience or picture of the wrong kind reads as none", () => {
    saveYtArtist(db, "daft punk", {
      ...found,
      page: { ...found.page, similar: [{ ...portishead, audience: "many", artworkUrl: 3 }] },
    } as unknown as YtArtistSaved);
    assert.deepEqual(selectYtArtistSimilar(db), [
      {
        name: "Daft Punk",
        similar: [{ name: "Portishead", browseId: "UCportishead", audience: null }],
      },
    ]);
  });
});
