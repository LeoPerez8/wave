/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { eq } from "drizzle-orm";

import { libraryCounts, libraryScale, sectionSongCounts } from "./counts.ts";
import * as schema from "./schema.ts";
import { addTrack, openTestDatabase, star, type TestDatabase } from "./testDatabase.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

describe("libraryCounts", () => {
  test("an empty library counts zero everywhere", () => {
    assert.deepEqual(libraryCounts(db), {
      playlists: 0,
      artists: 0,
      albums: 0,
      songs: 0,
      genres: 0,
      favorites: 0,
    });
  });

  test("counts what each Library list shows", () => {
    const airbag = addTrack(db, { title: "Airbag", album: "OK Computer", artist: "Radiohead" });
    addTrack(db, { title: "Karma Police", album: "OK Computer", artist: "Radiohead" });
    const joga = addTrack(db, { title: "Jóga", album: "Homogenic", artist: "Björk" });
    // A compilation: its album artist is listed under Artists too.
    addTrack(db, { title: "Hey", album: "Compilation", artist: "Pixies", albumArtist: "Various" });
    // An artist left without songs (pruned by the next scan) isn't counted.
    db.insert(schema.artists).values({ key: "Gone", name: "Gone", sort: "gone" }).run();

    const rock = db
      .insert(schema.genres)
      .values({ key: "rock", name: "Rock", sort: "rock" })
      .returning()
      .get().id;
    db.update(schema.tracks).set({ genreId: rock }).where(eq(schema.tracks.id, airbag)).run();
    db.update(schema.tracks).set({ genreId: rock }).where(eq(schema.tracks.id, joga)).run();
    // A genre without songs isn't listed.
    db.insert(schema.genres).values({ key: "jazz", name: "Jazz", sort: "jazz" }).run();

    star(db, airbag, 1);
    star(db, joga, 2);

    db.insert(schema.playlists)
      .values({ name: "Drive", createdAt: 0, updatedAt: 0, changedAt: 0 })
      .run();
    db.insert(schema.playlists)
      .values({ name: "Empty", createdAt: 0, updatedAt: 0, changedAt: 0 })
      .run();

    assert.deepEqual(libraryCounts(db), {
      playlists: 2,
      artists: 4,
      albums: 3,
      songs: 4,
      genres: 1,
      favorites: 2,
    });
  });
});

describe("sectionSongCounts", () => {
  test("counts the songs each Library entry's menu acts on", () => {
    const airbag = addTrack(db, { title: "Airbag", album: "OK Computer", artist: "Radiohead" });
    addTrack(db, { title: "Karma Police", album: "OK Computer", artist: "Radiohead" });
    const joga = addTrack(db, { title: "Jóga", album: "Homogenic", artist: "Björk", genre: "Pop" });
    // Listed under Pixies and under Various, but queued once.
    addTrack(db, { title: "Hey", album: "Compilation", artist: "Pixies", albumArtist: "Various" });
    star(db, joga, 1);

    const drive = db
      .insert(schema.playlists)
      .values({ name: "Drive", createdAt: 0, updatedAt: 0, changedAt: 0 })
      .returning()
      .get().id;
    db.insert(schema.playlists)
      .values({ name: "Empty", createdAt: 0, updatedAt: 0, changedAt: 0 })
      .run();
    // A playlist holding a song twice plays it twice.
    for (const [position, trackId] of [airbag, airbag, joga].entries()) {
      db.insert(schema.playlistItems)
        .values({ playlistId: drive, trackId, orderKey: `a${position}`, addedAt: 0, changedAt: 0 })
        .run();
    }
    // The section queues a playlist's Library songs only, so a YT Music entry isn't counted.
    db.insert(schema.playlistItems)
      .values({
        playlistId: drive,
        ytSong: JSON.stringify({ videoId: "a", title: "Lucky", artists: ["Radiohead"] }),
        orderKey: "a3",
        changedAt: 0,
        addedAt: 0,
      })
      .run();

    assert.deepEqual(sectionSongCounts(db), {
      playlists: 3,
      artists: 4,
      albums: 4,
      songs: 4,
      // Only Jóga has a genre.
      genres: 1,
      favorites: 1,
    });
  });
});

describe("libraryScale", () => {
  const playlist = (name: string, deleted = false): number =>
    db
      .insert(schema.playlists)
      .values({ name, createdAt: 0, updatedAt: 0, changedAt: 0, deleted })
      .returning()
      .get().id;
  const item = (playlistId: number, trackId: number, orderKey: string, deleted = false): void => {
    db.insert(schema.playlistItems)
      .values({ playlistId, trackId, orderKey, addedAt: 0, changedAt: 0, deleted })
      .run();
  };
  const play = (trackId: number, startedAt: number): void => {
    db.insert(schema.playEvents)
      .values({ trackId, startedAt, listenedMs: 1_000, endReason: "completed", counted: true })
      .run();
  };

  test("an empty library has no scale", () => {
    assert.deepEqual(libraryScale(db), {
      tracks: 0,
      playlists: 0,
      playlistItems: 0,
      largestPlaylist: 0,
      playEvents: 0,
    });
  });

  test("measures what a performance run reports: songs, playlists, entries and plays", () => {
    const airbag = addTrack(db, { title: "Airbag", album: "OK Computer", artist: "Radiohead" });
    const joga = addTrack(db, { title: "Jóga", album: "Homogenic", artist: "Björk" });
    const drive = playlist("Drive");
    const short = playlist("Short");
    const gone = playlist("Gone", true);
    item(drive, airbag, "a0");
    item(drive, joga, "a1");
    item(drive, airbag, "a2");
    // A removed entry and a deleted playlist's entries aren't in any playlist the owner sees.
    item(drive, joga, "a3", true);
    item(short, joga, "a0");
    item(gone, joga, "a0");
    item(gone, airbag, "a1");
    item(gone, airbag, "a2");
    item(gone, airbag, "a3");
    play(airbag, 1);
    play(airbag, 2);
    play(joga, 3);

    assert.deepEqual(libraryScale(db), {
      tracks: 2,
      playlists: 2,
      playlistItems: 4,
      largestPlaylist: 3,
      playEvents: 3,
    });
  });
});
