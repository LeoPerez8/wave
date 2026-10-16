/// <reference types="node" />
import { songSpineKeys, spineEntries, SONG_SORTS, sortSongs } from "@wave/core";
import { eq } from "drizzle-orm";
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import * as schema from "./schema.ts";
import { selectSongOrder, selectSongSummaries, selectSongsWithIds } from "./songOrder.ts";
import { addMissingSong, addTrack, openTestDatabase, type TestDatabase } from "./testDatabase.ts";
import { BY_TITLE, trackQuery } from "./tracks.ts";

/** Every song as the Songs list read them before paging: all rows, then Core's sort. */
const everySong = (db: TestDatabase) =>
  trackQuery(db)
    .orderBy(...BY_TITLE)
    .all();

/**
 * A Library with the ties each sort breaks: a title several artists sing, two
 * albums of one name, discs and track numbers (some missing), songs added
 * together, missing songs, a leading article and accents.
 */
const seed = async (): Promise<TestDatabase> => {
  const db = await openTestDatabase();
  const titles = ["Intro", "The Beat", "Écho", "Alone", "123", "Zebra", "alone"];
  const artists = ["Muse", "The Cure", "ABBA", "Ásgeir"];
  const albums = ["Origin", "Disintegration", "Gold"];
  for (let i = 0; i < 90; i++) {
    const track = {
      title: `${titles[i % titles.length]!}`,
      artist: artists[(i * 3) % artists.length]!,
      // Two "Origin" albums: one by each album artist.
      album: albums[(i * 5) % albums.length]!,
      albumArtist: i % 2 === 0 ? "Various" : "Other",
      ...(i % 7 === 0 ? {} : { trackNumber: (i % 4) + 1 }),
      addedAt: (i % 6) * 1_000,
    };
    const id = i % 11 === 0 ? addMissingSong(db, track) : addTrack(db, track);
    db.update(schema.tracks)
      .set({
        discNumber: i % 5 === 0 ? null : (i % 2) + 1,
        // Unique files, some sorting before others of the same title.
        ...(i % 11 === 0 ? {} : { path: `/Music/${String(89 - i).padStart(2, "0")}-${i}.mp3` }),
      })
      .where(eq(schema.tracks.id, id))
      .run();
  }
  return db;
};

describe("selectSongOrder", () => {
  test("orders the Songs list as sorting every song row did, for every sort", async () => {
    const db = await seed();
    const songs = everySong(db);
    for (const sort of SONG_SORTS) {
      const label = `${sort.key} ${sort.descending ? "descending" : "ascending"}`;
      const sorted = sortSongs(songs, sort);
      const order = selectSongOrder(db, sort);
      assert.deepEqual(
        order.ids,
        sorted.map((song) => song.id),
        label,
      );
      assert.deepEqual(order.spine, spineEntries(songSpineKeys(sorted, sort) ?? []), label);
      assert.deepEqual(
        [...order.missing].toSorted((a, b) => a - b),
        songs.filter((song) => song.path === null).map((song) => song.id).toSorted((a, b) => a - b),
        label,
      );
    }
  });

  test("an empty Library has an empty order", async () => {
    const db = await openTestDatabase();
    assert.deepEqual(selectSongOrder(db, { key: "title", descending: false }), {
      ids: [],
      spine: [],
      missing: [],
    });
  });
});

describe("selectSongSummaries", () => {
  test("gives what a row shows for each id, in the order asked, leaving out ids gone", async () => {
    const db = await openTestDatabase();
    const airbag = addTrack(db, {
      title: "Airbag",
      artist: "Radiohead",
      durationMs: 284_000,
      artworkHash: "ok",
    });
    const gone = addMissingSong(db, { title: "Gone", artist: "Nobody" });
    assert.deepEqual(selectSongSummaries(db, [gone, 999, airbag]), [
      {
        id: gone,
        title: "Gone",
        artist: "Nobody",
        durationMs: 180_000,
        thumbPath: null,
        hasFile: false,
      },
      {
        id: airbag,
        title: "Airbag",
        artist: "Radiohead",
        durationMs: 284_000,
        thumbPath: "/covers/ok.thumb.jpg",
        hasFile: true,
      },
    ]);
  });
});

describe("selectSongsWithIds", () => {
  test("gives full song rows, missing songs too, in the order asked", async () => {
    const db = await seed();
    const songs = everySong(db);
    const ids = [songs[40]!.id, songs[0]!.id, 12_345, songs[11]!.id];
    assert.deepEqual(selectSongsWithIds(db, ids), [songs[40], songs[0], songs[11]]);
  });
});
