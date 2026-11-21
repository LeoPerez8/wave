import assert from "node:assert/strict";
import { test } from "node:test";

import { djAlbumTile, djArtistTile, type DjAlbum, type MagicSeedSong } from "@wave/core";

import { readDjAlbums, readDjAlbumSongs } from "./djAlbums.ts";

const song = (id: string, title: string): MagicSeedSong => ({
  id: `song:${id}`,
  title,
  artists: ["Portishead"],
  durationMs: null,
  plays: 0,
});

test("the grid's albums are the Library's, then each artist's saved page's", async () => {
  const asked: string[] = [];
  const albums = await readDjAlbums(["Portishead", "Tricky"], {
    library: () => Promise.resolve([{ title: "Dummy", artist: "Portishead", libraryId: 12 }]),
    saved: (artist) => {
      asked.push(artist);
      return Promise.resolve<DjAlbum[]>([
        { title: `${artist} live`, artist, browseId: `MPREb_${artist}` },
      ]);
    },
  });
  assert.deepEqual(asked, ["Portishead", "Tricky"]);
  assert.deepEqual(
    albums.map((album) => album.title),
    ["Dummy", "Portishead live", "Tricky live"],
  );
});

test("a read that fails leaves the albums the others know", async () => {
  const albums = await readDjAlbums(["Portishead", "Tricky"], {
    library: () => Promise.reject(new Error("database")),
    saved: (artist) =>
      artist === "Tricky"
        ? Promise.resolve([{ title: "Maxinquaye", artist }])
        : Promise.reject(new Error("database")),
  });
  assert.deepEqual(albums, [{ title: "Maxinquaye", artist: "Tricky" }]);
});

test("a selected album's songs are the Library's when it has the album", async () => {
  const dummy = djAlbumTile({
    title: "Dummy",
    artist: "Portishead",
    libraryId: 12,
    browseId: "MPREb_d",
  })!;
  const read: string[] = [];
  const songs = await readDjAlbumSongs([djArtistTile("Air")!, dummy], {
    library: (id) => {
      read.push(`library ${id}`);
      return Promise.resolve([song("1", "Mysterons")]);
    },
    page: (browseId) => {
      read.push(`page ${browseId}`);
      return Promise.resolve([song("yt:a", "Mysterons")]);
    },
  });
  assert.deepEqual([...songs], [[dummy.key, [song("1", "Mysterons")]]]);
  assert.deepEqual(read, ["library 12"]);
});

test("an album the Library doesn't have is read from its YT Music page", async () => {
  const third = djAlbumTile({ title: "Third", artist: "Portishead", browseId: "MPREb_third" })!;
  const songs = await readDjAlbumSongs([third], {
    library: () => Promise.reject(new Error("never read")),
    page: (browseId) => Promise.resolve([song(`yt:${browseId}`, "Silence")]),
  });
  assert.deepEqual(songs.get(third.key), [song("yt:MPREb_third", "Silence")]);
});

test("a Library album with no songs left falls back to its page", async () => {
  const dummy = djAlbumTile({
    title: "Dummy",
    artist: "Portishead",
    libraryId: 12,
    browseId: "MPREb_d",
  })!;
  const songs = await readDjAlbumSongs([dummy], {
    library: () => Promise.resolve([]),
    page: () => Promise.resolve([song("yt:a", "Mysterons")]),
  });
  assert.deepEqual(songs.get(dummy.key), [song("yt:a", "Mysterons")]);
});

test("an album whose songs can't be read gives none, and the others still do", async () => {
  const third = djAlbumTile({ title: "Third", artist: "Portishead", browseId: "MPREb_third" })!;
  const dummy = djAlbumTile({ title: "Dummy", artist: "Portishead", libraryId: 12 })!;
  const songs = await readDjAlbumSongs([third, dummy], {
    library: () => Promise.resolve([song("1", "Mysterons")]),
    page: () => Promise.reject(new Error("offline")),
  });
  assert.deepEqual([...songs.keys()], [dummy.key]);
});
