/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import {
  refreshArtistImages,
  selectArtistCovers,
  selectArtistSongs,
  selectArtists,
} from "./artists.ts";
import * as schema from "./schema.ts";
import {
  addTrack,
  migrateTestDatabase,
  openTestDatabase,
  type TestDatabase,
} from "./testDatabase.ts";

let db: TestDatabase;

/** Files `name` under `sort`, as the scanner does (leading article and accents dropped). */
const sortAs = (name: string, sort: string) =>
  db.update(schema.artists).set({ sort }).where(eq(schema.artists.name, name)).run();

beforeEach(async () => {
  db = await openTestDatabase();
  addTrack(db, { title: "Airbag", album: "OK Computer", artist: "Radiohead" });
  addTrack(db, { title: "Something", album: "Abbey Road", artist: "The Beatles" });
  addTrack(db, { title: "Jóga", album: "Homogenic", artist: "Björk" });
  addTrack(db, { title: "Intro", album: "Discovery", artist: "Daft Punk" });
  addTrack(db, { title: "Hey", album: "Compilation", artist: "Pixies", albumArtist: "Various" });
  sortAs("The Beatles", "beatles");
  sortAs("Björk", "bjork");
});

const names = (page?: { offset: number; limit: number }) =>
  selectArtists(db, { page }).map((artist) => artist.name);

describe("selectArtists", () => {
  test("lists every artist with songs by sort name, album artists included", () => {
    assert.deepEqual(names(), [
      "The Beatles",
      "Björk",
      "Daft Punk",
      "Pixies",
      "Radiohead",
      "Various",
    ]);
    const various = selectArtists(db, {}).find((artist) => artist.name === "Various");
    assert.equal(various?.albumCount, 1);
    assert.equal(various?.trackCount, 1);
  });

  test("a page is a window of that order", () => {
    assert.deepEqual(names({ offset: 1, limit: 2 }), ["Björk", "Daft Punk"]);
    assert.deepEqual(names({ offset: 5, limit: 10 }), ["Various"]);
    assert.deepEqual(names({ offset: 6, limit: 10 }), []);
  });

  test("can be limited to some artists", () => {
    const ids = selectArtists(db, {})
      .filter((artist) => artist.name.startsWith("R") || artist.name.startsWith("D"))
      .map((artist) => artist.id);
    assert.deepEqual(
      selectArtists(db, { ids }).map((artist) => artist.name),
      ["Daft Punk", "Radiohead"],
    );
  });
});

const idOf = (name: string) =>
  selectArtists(db, {}).find((artist) => artist.name === name)?.id ?? -1;

describe("selectArtistCovers", () => {
  test("an artist's cover is their image: their album with the most songs", () => {
    addTrack(db, {
      title: "15 Step",
      album: "In Rainbows",
      artist: "Radiohead",
      artworkHash: "rainbows",
    });
    addTrack(db, { title: "Everything", album: "Kid A", artist: "Radiohead", artworkHash: "kida" });
    addTrack(db, { title: "Idioteque", album: "Kid A", artist: "Radiohead", artworkHash: "kida" });
    refreshArtistImages(db);
    const covers = selectArtistCovers(db, [idOf("Radiohead")]);
    assert.equal(covers.get(idOf("Radiohead")), "/covers/kida.jpg");
  });

  test("an artist with no album of their own takes a cover from their songs", () => {
    addTrack(db, {
      title: "Debaser",
      album: "Indie Hits",
      artist: "Pixies",
      albumArtist: "Various",
      artworkHash: "indie",
    });
    refreshArtistImages(db);
    assert.equal(selectArtistCovers(db, [idOf("Pixies")]).get(idOf("Pixies")), "/covers/indie.jpg");
  });

  test("artists without any artwork have no cover", () => {
    refreshArtistImages(db);
    const covers = selectArtistCovers(db, [idOf("Björk"), idOf("Daft Punk")]);
    assert.equal(covers.size, 0);
    assert.equal(selectArtistCovers(db, []).size, 0);
  });
});

describe("artist images", () => {
  const imageOf = (name: string) => {
    const artist = selectArtists(db, {}).find((row) => row.name === name);
    return { thumbPath: artist?.thumbPath, artworkPath: artist?.artworkPath };
  };
  const cover = (hash: string) => ({
    thumbPath: `/covers/${hash}.thumb.jpg`,
    artworkPath: `/covers/${hash}.jpg`,
  });

  test("an artist's image is the cover of their own album with the most songs", () => {
    addTrack(db, {
      title: "15 Step",
      album: "In Rainbows",
      artist: "Radiohead",
      artworkHash: "ir",
    });
    addTrack(db, { title: "Nude", album: "In Rainbows", artist: "Radiohead", artworkHash: "ir" });
    addTrack(db, { title: "Idioteque", album: "Kid A", artist: "Radiohead", artworkHash: "kida" });
    refreshArtistImages(db);
    assert.deepEqual(imageOf("Radiohead"), cover("ir"));
  });

  test("an artist with no album of their own takes the album they appear on most", () => {
    addTrack(db, {
      title: "Debaser",
      album: "Hits",
      artist: "Pixies",
      albumArtist: "Various",
      artworkHash: "hits",
    });
    refreshArtistImages(db);
    assert.deepEqual(imageOf("Pixies"), cover("hits"));
  });

  test("artists with no artwork have no image", () => {
    refreshArtistImages(db);
    assert.deepEqual(imageOf("Björk"), { thumbPath: null, artworkPath: null });
  });

  test("after the update, artists show their image straight away (splitting credits picks them)", async () => {
    db = await openTestDatabase({ through: "0007_recount_plays" });
    addTrack(db, { title: "Everything", album: "Kid A", artist: "Radiohead", artworkHash: "kida" });
    await migrateTestDatabase(db);
    assert.deepEqual(imageOf("Radiohead"), cover("kida"));
  });

  test("a rescan that adds or removes albums updates the choice", () => {
    addTrack(db, { title: "Everything", album: "Kid A", artist: "Radiohead", artworkHash: "kida" });
    refreshArtistImages(db);
    assert.deepEqual(imageOf("Radiohead"), cover("kida"));

    addTrack(db, {
      title: "15 Step",
      album: "In Rainbows",
      artist: "Radiohead",
      artworkHash: "ir",
    });
    addTrack(db, { title: "Nude", album: "In Rainbows", artist: "Radiohead", artworkHash: "ir" });
    refreshArtistImages(db);
    assert.deepEqual(imageOf("Radiohead"), cover("ir"));

    const inRainbows = db
      .select()
      .from(schema.albums)
      .where(eq(schema.albums.title, "In Rainbows"))
      .get();
    db.delete(schema.tracks)
      .where(eq(schema.tracks.albumId, inRainbows?.id ?? -1))
      .run();
    db.delete(schema.albums)
      .where(eq(schema.albums.id, inRainbows?.id ?? -1))
      .run();
    refreshArtistImages(db);
    assert.deepEqual(imageOf("Radiohead"), cover("kida"));

    db.update(schema.albums).set({ artworkHash: null }).run();
    refreshArtistImages(db);
    assert.deepEqual(imageOf("Radiohead"), { thumbPath: null, artworkPath: null });
  });
});

const songsOf = (name: string, page?: { offset: number; limit: number }) =>
  selectArtistSongs(db, idOf(name), page).map((song) => song.title);

describe("selectArtistSongs", () => {
  beforeEach(() => {
    addTrack(db, { title: "Reckoner", album: "In Rainbows", artist: "Radiohead" });
    addTrack(db, { title: "Creep", album: "Pablo Honey", artist: "Radiohead" });
    addTrack(db, {
      title: "Fake Plastic Trees",
      album: "Covers",
      artist: "Someone",
      albumArtist: "Radiohead",
    });
  });

  test("lists an artist's songs and the songs on their albums, by title", () => {
    assert.deepEqual(songsOf("Radiohead"), ["Airbag", "Creep", "Fake Plastic Trees", "Reckoner"]);
  });

  test("a page is a window of that order", () => {
    assert.deepEqual(songsOf("Radiohead", { offset: 1, limit: 2 }), [
      "Creep",
      "Fake Plastic Trees",
    ]);
    assert.deepEqual(songsOf("Radiohead", { offset: 4, limit: 2 }), []);
  });
});
