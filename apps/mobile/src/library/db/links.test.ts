/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import { selectArtists, refreshArtistImages } from "./artists.ts";
import { selectLinkRows } from "./links.ts";
import * as schema from "./schema.ts";
import { addTrack, openTestDatabase, type TestDatabase } from "./testDatabase.ts";

let db: TestDatabase;
let airbag: { albumId: number; artistId: number };

beforeEach(async () => {
  db = await openTestDatabase();
  const id = addTrack(db, {
    title: "Airbag",
    album: "OK Computer",
    artist: "Radiohead",
    year: 1997,
    durationMs: 284_000,
    artworkHash: "okc",
  });
  addTrack(db, { title: "Lucky", album: "OK Computer", artist: "Radiohead", durationMs: 259_000 });
  addTrack(db, { title: "Everything", album: "Kid A", artist: "Radiohead" });
  const track = db.select().from(schema.tracks).where(eq(schema.tracks.id, id)).get();
  airbag = { albumId: track?.albumId ?? -1, artistId: track?.artistId ?? -1 };
});

describe("selectLinkRows", () => {
  test("reads the album and artist rows a song links to, as their lists show them", () => {
    const { album, artist } = selectLinkRows(db, airbag);
    assert.equal(album?.title, "OK Computer");
    assert.equal(album?.albumArtist, "Radiohead");
    assert.equal(album?.year, 1997);
    assert.equal(album?.trackCount, 2);
    assert.equal(album?.durationMs, 543_000);
    assert.equal(album?.artworkPath, "/covers/okc.jpg");
    assert.equal(artist?.name, "Radiohead");
    assert.equal(artist?.albumCount, 2);
    assert.equal(artist?.trackCount, 3);
  });

  test("reads only the links asked for", () => {
    assert.equal(selectLinkRows(db, { artistId: airbag.artistId }).album, null);
    assert.equal(selectLinkRows(db, { albumId: airbag.albumId }).artist, null);
  });

  test("an album or artist gone from the library reads as null", () => {
    assert.deepEqual(selectLinkRows(db, { albumId: 9999, artistId: 9999 }), {
      album: null,
      artist: null,
    });
  });

  test("an artist reads as the Artists list shows it, counting the songs on their albums", () => {
    addTrack(db, {
      title: "Otis",
      album: "Watch the Throne",
      artist: "Jay-Z",
      albumArtist: "Kanye West",
      artworkHash: "wtt",
    });
    const stronger = addTrack(db, { title: "Stronger", album: "Graduation", artist: "Kanye West" });
    addTrack(db, { title: "Run This Town", album: "The Blueprint 3", artist: "Jay-Z" });
    refreshArtistImages(db);
    const kanyeId =
      db.select().from(schema.tracks).where(eq(schema.tracks.id, stronger)).get()?.artistId ?? -1;
    const { artist } = selectLinkRows(db, { artistId: kanyeId });
    assert.equal(artist?.albumCount, 2);
    assert.equal(artist?.trackCount, 2);
    assert.deepEqual(artist, selectArtists(db, { ids: [kanyeId] })[0]);
  });
});
