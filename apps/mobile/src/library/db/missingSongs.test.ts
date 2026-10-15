/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import { selectAlbumDetail, selectAlbums } from "./albums.ts";
import { selectArtistDetail, selectArtistSongs, selectArtists } from "./artists.ts";
import { libraryCounts } from "./counts.ts";
import { selectGenreSongs } from "./genres.ts";
import { homeSections, listFavorites, setFavorites } from "./playHistory.ts";
import { selectMissingSongs } from "./missingSongs.ts";
import { createPlaylist, selectPlaylist, selectPlaylistEntries } from "./playlists.ts";
import * as schema from "./schema.ts";
import { selectPlayableSongs } from "./tracks.ts";
import { addMissingSong, addTrack, openTestDatabase, type TestDatabase } from "./testDatabase.ts";

/**
 * A Library signed in to a Wave account: OK Computer with Airbag's file and
 * Lucky missing, and Kid A, of which the phone has nothing.
 */
let db: TestDatabase;
let airbag: number;
let lucky: number;
let everything: number;

beforeEach(async () => {
  db = await openTestDatabase();
  airbag = addTrack(db, { title: "Airbag", album: "OK Computer", artist: "Radiohead" });
  lucky = addMissingSong(db, {
    title: "Lucky",
    album: "OK Computer",
    artist: "Radiohead",
    genre: "Rock",
  });
  everything = addMissingSong(db, { title: "Everything", album: "Kid A", artist: "Radiohead" });
});

const titles = (songs: readonly { readonly title: string }[]) => songs.map((song) => song.title);

describe("missing songs in the Library", () => {
  test("albums list them with their tracks, counted, an album of missing songs included", () => {
    assert.deepEqual(
      selectAlbums(db, undefined).map((album) => [album.title, album.trackCount]),
      [
        ["Kid A", 1],
        ["OK Computer", 2],
      ],
    );
    const album = selectAlbumDetail(db, selectAlbums(db, undefined)[1]?.id ?? -1);
    assert.deepEqual(
      album?.tracks.map((track) => [track.title, track.path]),
      [
        ["Airbag", "/Music/OK Computer/Airbag.mp3"],
        ["Lucky", null],
      ],
    );
  });

  test("artists count them and list them among their songs", () => {
    const [radiohead] = selectArtists(db, {});
    assert.equal(radiohead?.trackCount, 3);
    const detail = selectArtistDetail(db, radiohead?.id ?? -1);
    assert.deepEqual(titles(detail?.songs ?? []), ["Airbag", "Everything", "Lucky"]);
    assert.deepEqual(
      detail?.albums.map((album) => album.title),
      ["Kid A", "OK Computer"],
    );
  });

  test("genres, playlists, favorites and Home show them where their Tracks would be", () => {
    assert.deepEqual(titles(selectGenreSongs(db, 1)), ["Lucky"]);
    createPlaylist(
      db,
      "Drive",
      [
        { source: "library", trackId: lucky },
        { source: "library", trackId: airbag },
      ],
      1,
    );
    const items = selectPlaylist(db, 1)?.items ?? [];
    assert.deepEqual(
      items.map((item) => (item.source === "library" ? item.track.title : "")),
      ["Lucky", "Airbag"],
    );
    setFavorites(db, [everything], true, 2);
    assert.deepEqual(titles(listFavorites(db)), ["Everything"]);
    assert.deepEqual(titles(homeSections(db).favorites), ["Everything"]);
  });

  test("the Library tab counts them", () => {
    const counts = libraryCounts(db);
    assert.deepEqual([counts.songs, counts.albums, counts.artists], [3, 2, 1]);
  });
});

describe("what plays, and Android Auto, leave missing songs out", () => {
  test("a queue's songs are only those with a file", () => {
    assert.deepEqual(titles(selectPlayableSongs(db, [airbag, lucky, everything])), ["Airbag"]);
  });

  test("albums and artists with no file aren't listed, and their counts are of files", () => {
    assert.deepEqual(
      selectAlbums(db, undefined, undefined, "files").map((album) => [
        album.title,
        album.trackCount,
      ]),
      [["OK Computer", 1]],
    );
    const [radiohead] = selectArtists(db, { scope: "files" });
    assert.equal(radiohead?.trackCount, 1);
    assert.deepEqual(titles(selectArtistSongs(db, radiohead?.id ?? -1, undefined, "files")), [
      "Airbag",
    ]);
    const detail = selectArtistDetail(db, radiohead?.id ?? -1, "files");
    assert.deepEqual(titles(detail?.songs ?? []), ["Airbag"]);
    assert.deepEqual(
      detail?.albums.map((album) => album.title),
      ["OK Computer"],
    );
    assert.deepEqual(titles(selectAlbumDetail(db, 1, "files")?.tracks ?? []), ["Airbag"]);
  });

  test("a playlist's entries of missing songs are left out", () => {
    createPlaylist(
      db,
      "Drive",
      [
        { source: "library", trackId: lucky },
        { source: "library", trackId: airbag },
      ],
      1,
    );
    const entries = selectPlaylistEntries(db, 1, undefined, "files");
    assert.deepEqual(
      entries.map((item) => (item.source === "library" ? item.track.title : "")),
      ["Airbag"],
    );
    assert.equal(selectPlaylistEntries(db, 1, { offset: 0, limit: 1 }, "files").length, 1);
  });

  test("Home's songs are only those with a file", () => {
    setFavorites(db, [everything, airbag], true, 2);
    assert.deepEqual(titles(homeSections(db, "files").favorites), ["Airbag"]);
  });
});

describe("what downloading missing songs reads", () => {
  test("the missing songs, as a download takes them: their Track's tags, in title order", () => {
    db.update(schema.tracks).set({ videoId: "abc" }).where(eq(schema.tracks.id, lucky)).run();
    assert.deepEqual(selectMissingSongs(db), [
      {
        id: everything,
        title: "Everything",
        artist: "Radiohead",
        artists: ["Radiohead"],
        album: "Kid A",
        albumArtist: "Radiohead",
        year: null,
        trackNumber: null,
        discNumber: null,
        genre: null,
        durationMs: 180_000,
        videoId: null,
      },
      {
        id: lucky,
        title: "Lucky",
        artist: "Radiohead",
        artists: ["Radiohead"],
        album: "OK Computer",
        albumArtist: "Radiohead",
        year: null,
        trackNumber: null,
        discNumber: null,
        genre: "Rock",
        durationMs: 180_000,
        videoId: "abc",
      },
    ]);
  });

  test("one of them by its Track, and none for a song with a file", () => {
    assert.deepEqual(titles(selectMissingSongs(db, [lucky, airbag])), ["Lucky"]);
  });
});
