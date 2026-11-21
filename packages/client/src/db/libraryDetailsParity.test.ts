/// <reference types="node" />
/**
 * #1352: an album's and an artist's page drawn from the lists in memory
 * (Core's `createLibraryDetails`) is what the Library's own reads answer.
 */
import assert from "node:assert/strict";
import { before, describe, test } from "node:test";

import { createLibraryDetails } from "@wave/core";

import { selectAlbumDetail, selectAlbums } from "./albums.ts";
import { selectArtistDetail, selectArtists } from "./artists.ts";
import { creditSplits, relinkCredits } from "./credits.ts";
import { listGenres, listSongs } from "./libraryQueries.ts";
import { addTrack, openTestDatabase, type TestDatabase } from "./testDatabase.ts";

let db: TestDatabase;

before(async () => {
  db = await openTestDatabase();
  addTrack(db, {
    title: "Airbag",
    album: "OK Computer",
    artist: "Radiohead",
    trackNumber: 1,
    year: 1997,
    genre: "Rock",
  });
  addTrack(db, {
    title: "Paranoid Android",
    album: "OK Computer",
    artist: "Radiohead",
    trackNumber: 2,
    year: 1997,
    genre: "Alternative",
  });
  addTrack(db, {
    title: "Lucky",
    album: "OK Computer",
    artist: "Radiohead",
    trackNumber: 11,
    year: 1997,
    genre: "Alternative",
  });
  addTrack(db, { title: "Everything", album: "Kid A", artist: "Radiohead", year: 2000 });
  addTrack(db, {
    title: "Say So",
    album: "Hot Pink",
    artist: "Doja Cat",
    year: 2019,
    genre: "Pop",
  });
  addTrack(db, {
    title: "Boss Bitch",
    album: "Birds of Prey",
    artist: "Doja Cat",
    albumArtist: "Various Artists",
    year: 2020,
    genre: "Pop",
  });
  addTrack(db, {
    title: "34+35 Remix",
    album: "Positions",
    artist: "Ariana Grande, Doja Cat",
    albumArtist: "Ariana Grande",
    year: 2021,
    genre: "Pop",
  });
  addTrack(db, {
    title: "Positions",
    album: "Positions",
    artist: "Ariana Grande",
    albumArtist: "Ariana Grande",
    year: 2020,
    genre: "Rock",
  });
  addTrack(db, {
    title: "Watch",
    album: "Watch the Throne",
    artist: "JAY-Z",
    albumArtist: "JAY-Z & Kanye West",
    year: 2011,
  });
  // Split the credits into their artists, as a scan does.
  relinkCredits(db, creditSplits());
});

const memory = () =>
  createLibraryDetails({
    songs: listSongs(db),
    albums: selectAlbums(db, undefined),
    artists: selectArtists(db, {}),
    genres: listGenres(db),
  });

describe("Library pages from memory match the Library's reads", () => {
  test("every album's page", () => {
    const details = memory();
    const albums = selectAlbums(db, undefined);
    assert.ok(albums.length >= 6);
    for (const album of albums) {
      assert.deepEqual(details.album(album.id), selectAlbumDetail(db, album.id), album.title);
    }
  });

  test("every artist's page", () => {
    const details = memory();
    const artists = selectArtists(db, {});
    assert.ok(artists.some((artist) => artist.name === "Kanye West"));
    for (const artist of artists) {
      assert.deepEqual(details.artist(artist.id), selectArtistDetail(db, artist.id), artist.name);
    }
  });
});
