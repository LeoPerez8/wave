import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createLibraryDetails } from "./index.ts";

/** Songs as the Library's Songs list holds them: by title. */
const song = (
  id: number,
  fields: {
    title: string;
    albumId: number;
    artistIds: readonly number[];
    disc?: number | null;
    track?: number | null;
    genre?: string | null;
  },
) => ({
  id,
  path: `/music/${id}.mp3`,
  titleSort: fields.title,
  artistSort: "x",
  albumId: fields.albumId,
  artistId: fields.artistIds[0]!,
  artistIds: fields.artistIds,
  discNumber: fields.disc ?? null,
  trackNumber: fields.track ?? null,
  genre: fields.genre ?? null,
});

const album = (
  id: number,
  albumArtistIds: readonly number[],
  year: number | null,
  title: string,
) => ({
  id,
  albumArtistId: albumArtistIds[0]!,
  albumArtistIds,
  year,
  titleSort: title,
});

const artist = (id: number) => ({ id, albumCount: 99, trackCount: 99 });

// Artist 1 has album 10; artist 2 is featured on album 10's song and has album 20;
// album 30 is a compilation filed under artist 3 with a song by artist 1.
const library = {
  songs: [
    song(101, { title: "a song", albumId: 10, artistIds: [1], disc: 1, track: 2, genre: "Pop" }),
    song(102, {
      title: "b song",
      albumId: 10,
      artistIds: [1, 2],
      disc: 1,
      track: 1,
      genre: "Rock",
    }),
    song(103, { title: "c song", albumId: 10, artistIds: [1], disc: 2, track: 1, genre: "Rock" }),
    song(201, { title: "d song", albumId: 20, artistIds: [2], genre: "Pop" }),
    song(301, { title: "e song", albumId: 30, artistIds: [1] }),
    song(302, { title: "f song", albumId: 30, artistIds: [4] }),
  ],
  albums: [
    album(10, [1], 2001, "ten"),
    album(20, [2], 1999, "twenty"),
    album(30, [3], 2010, "thirty"),
  ],
  artists: [artist(1), artist(2), artist(3), artist(4)],
  genres: [
    { name: "Pop", sort: "pop" },
    { name: "Rock", sort: "rock" },
  ],
};

describe("Library pages drawn from the rows in memory (#1352)", () => {
  test("an album's page: its row, its tracks in album order and its most common genre", () => {
    const details = createLibraryDetails(library);
    const page = details.album(10);
    assert.equal(page?.album.id, 10);
    assert.deepEqual(
      page?.tracks.map((track) => track.id),
      [102, 101, 103],
    );
    assert.equal(page?.genre, "Rock");
  });

  test("a genre tie goes to the genre first by its sort", () => {
    const details = createLibraryDetails({
      ...library,
      songs: library.songs.filter((row) => row.id !== 103),
    });
    assert.equal(details.album(10)?.genre, "Pop");
    assert.equal(details.album(30)?.genre, null);
  });

  test("an artist's page: songs credited to them or on albums credited to them, by title", () => {
    const details = createLibraryDetails(library);
    assert.deepEqual(
      details.artist(1)?.songs.map((row) => row.id),
      [101, 102, 103, 301],
    );
    // Album 30 is credited to artist 3: both its songs are theirs.
    assert.deepEqual(
      details.artist(3)?.songs.map((row) => row.id),
      [301, 302],
    );
  });

  test("an artist's albums: filed under them, and Appears on, each newest first", () => {
    const details = createLibraryDetails(library);
    const two = details.artist(2);
    assert.deepEqual(
      two?.albums.map((row) => row.id),
      [20],
    );
    assert.deepEqual(
      two?.appearsOn.map((row) => row.id),
      [10],
    );
    assert.deepEqual(
      details.artist(1)?.appearsOn.map((row) => row.id),
      [30],
    );
  });

  test("an artist's row counts what their page lists", () => {
    const page = createLibraryDetails(library).artist(2);
    assert.equal(page?.artist.albumCount, 1);
    assert.equal(page?.artist.trackCount, 2);
  });

  test("an id the rows don't hold has no page here: the Library is asked instead", () => {
    const details = createLibraryDetails(library);
    assert.equal(details.album(99), undefined);
    assert.equal(details.artist(99), undefined);
  });

  test("asking for a page again answers the same page: a screen following it draws nothing new", () => {
    const details = createLibraryDetails(library);
    assert.equal(details.album(10), details.album(10));
    assert.equal(details.artist(1), details.artist(1));
  });
});
