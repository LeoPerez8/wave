/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { selectAlbums } from "./albums.ts";
import { addTrack, openTestDatabase, type TestDatabase } from "./testDatabase.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
  addTrack(db, { title: "Airbag", album: "OK Computer", artist: "Radiohead" });
  addTrack(db, { title: "Paranoid Android", album: "OK Computer", artist: "Radiohead" });
  addTrack(db, { title: "Everything", album: "Kid A", artist: "Radiohead" });
  addTrack(db, { title: "Intro", album: "Discovery", artist: "Daft Punk" });
  addTrack(db, { title: "Intro (live)", album: "Discovery", artist: "Abba" });
  addTrack(db, { title: "Bloom", album: "The King of Limbs", artist: "Radiohead" });
});

const titles = (page: { offset: number; limit: number } | undefined) =>
  selectAlbums(db, undefined, page).map((album) => `${album.title} / ${album.albumArtist}`);

describe("selectAlbums", () => {
  test("lists every album by title, then album artist, with its track count", () => {
    assert.deepEqual(titles(undefined), [
      "Discovery / Abba",
      "Discovery / Daft Punk",
      "Kid A / Radiohead",
      "OK Computer / Radiohead",
      "The King of Limbs / Radiohead",
    ]);
    assert.equal(selectAlbums(db, undefined)[3]?.trackCount, 2);
  });

  test("a page is a window of that order", () => {
    assert.deepEqual(titles({ offset: 1, limit: 2 }), [
      "Discovery / Daft Punk",
      "Kid A / Radiohead",
    ]);
    assert.deepEqual(titles({ offset: 4, limit: 10 }), ["The King of Limbs / Radiohead"]);
    assert.deepEqual(titles({ offset: 5, limit: 10 }), []);
  });
});
