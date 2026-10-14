/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { joinArtists, normalizeTrack, type RawTrack } from "@wave/core";
import { sql } from "drizzle-orm";

import type { IndexedTrack } from "../LibraryStore.ts";
import { selectArtistDetail, selectArtists } from "./artists.ts";
import { libraryCounts } from "./counts.ts";
import { selectLinkRows } from "./links.ts";
import { removeTracks, saveBatch } from "./save.ts";
import * as schema from "./schema.ts";
import {
  addTrack,
  migrateTestDatabase,
  openTestDatabase,
  star,
  type TestDatabase,
} from "./testDatabase.ts";

let db: TestDatabase;

beforeEach(async () => {
  db = await openTestDatabase();
});

const indexed = (raw: Omit<RawTrack, "path">): IndexedTrack => ({
  ...normalizeTrack({ ...raw, path: `/Music/${raw.album ?? "Singles"}/${raw.title}.mp3` }),
  sizeBytes: 1_000,
  modifiedAt: 0,
  sampleRate: null,
  bitrateKbps: null,
  artworkHash: null,
  hasLyrics: false,
});

/** Saves [tracks] as a scan does: in a batch, then completing the scan. */
const scan = (...tracks: Omit<RawTrack, "path">[]): void => {
  saveBatch(db, tracks.map(indexed), [], [], 0);
  removeTracks(db, []);
};

const ariana = [
  { title: "7 rings", artist: "Ariana Grande", album: "thank u, next" },
  {
    title: "motive",
    artist: "Ariana Grande, Doja Cat",
    album: "Positions",
    albumArtist: "Ariana Grande",
  },
  { title: "boyfriend", artist: "Ariana Grande · Social House", album: "boyfriend" },
];

const artist = (name: string) => selectArtists(db, {}).find((row) => row.name === name);

describe("credits", () => {
  test("a collaboration is listed under each credited artist, once", () => {
    scan(...ariana);
    assert.deepEqual(
      selectArtists(db, {}).map((row) => row.name),
      ["Ariana Grande", "Doja Cat", "Social House"],
    );
    assert.equal(artist("Ariana Grande")?.trackCount, 3);
    assert.equal(artist("Doja Cat")?.trackCount, 1);
  });

  test("an artist's page lists every song they're credited on, and a collaboration album under its first artist", () => {
    scan(...ariana);
    const page = (name: string) => {
      const detail = selectArtistDetail(db, artist(name)?.id ?? -1);
      return {
        songs: detail?.songs.map((song) => song.title),
        albums: detail?.albums.map((album) => album.title),
        appearsOn: detail?.appearsOn.map((album) => album.title),
      };
    };
    assert.deepEqual(page("Ariana Grande"), {
      songs: ["boyfriend", "motive", "7 rings"],
      albums: ["boyfriend", "Positions", "thank u, next"],
      appearsOn: [],
    });
    assert.deepEqual(page("Social House"), {
      songs: ["boyfriend"],
      albums: [],
      appearsOn: ["boyfriend"],
    });
    assert.deepEqual(page("Doja Cat"), { songs: ["motive"], albums: [], appearsOn: ["Positions"] });
  });

  test('an "&" artist the Library has on their own stays whole', () => {
    scan(
      { title: "The Boxer", artist: "Simon & Garfunkel", album: "Bridge over Troubled Water" },
      { title: "Cecilia", artist: "Simon & Garfunkel", album: "Bridge over Troubled Water" },
    );
    assert.deepEqual(
      selectArtists(db, {}).map((row) => row.name),
      ["Simon & Garfunkel"],
    );
  });

  test('"&" splits again once a scan brings one of its artists on their own', () => {
    scan({ title: "boyfriend", artist: "Ariana Grande & Social House", album: "boyfriend" });
    assert.deepEqual(
      selectArtists(db, {}).map((row) => row.name),
      ["Ariana Grande & Social House"],
    );
    scan({ title: "7 rings", artist: "Ariana Grande", album: "thank u, next" });
    assert.deepEqual(
      selectArtists(db, {}).map((row) => row.name),
      ["Ariana Grande", "Social House"],
    );
    assert.deepEqual(
      selectArtistDetail(db, artist("Social House")?.id ?? -1)?.appearsOn.map((a) => a.title),
      ["boyfriend"],
    );
  });

  test("upgrading files the Library under each credited artist without a rescan, keeping stars, playlists and plays", async () => {
    const v7 = await openTestDatabase({ through: "0011_track_lyrics" });
    const rings = addTrack(v7, {
      title: "7 rings",
      artist: "Ariana Grande",
      album: "thank u, next",
    });
    const motive = addTrack(v7, {
      title: "motive",
      artist: "Ariana Grande, Doja Cat",
      album: "Positions",
      albumArtist: "Ariana Grande",
    });
    const boyfriend = addTrack(v7, {
      title: "boyfriend",
      artist: "Ariana Grande, Social House",
      album: "boyfriend",
      artworkHash: "bf",
    });
    star(v7, motive, 1_000);
    v7.run(sql`INSERT INTO playlists (name, created_at, updated_at) VALUES ('Mix', 0, 0)`);
    v7.run(sql`INSERT INTO playlist_items (playlist_id, track_id, position, added_at)
      VALUES (1, ${boyfriend}, 0, 0), (1, ${rings}, 1, 0)`);
    const collab = v7.get<{ id: number }>(
      sql`SELECT id FROM artists WHERE name = 'Ariana Grande, Social House'`,
    ).id;
    // A play of a song since deleted, which kept its whole-credit artist.
    v7.run(sql`INSERT INTO play_events (track_id, started_at, listened_ms, duration_ms, end_reason, counted, artist_id)
      VALUES (${boyfriend}, 1, 180000, 180000, 'completed', 1, NULL), (999, 2, 180000, 180000, 'completed', 1, ${collab})`);

    await migrateTestDatabase(v7);
    db = v7;

    assert.deepEqual(
      selectArtists(db, {}).map((row) => [row.name, row.trackCount, row.albumCount]),
      [
        ["Ariana Grande", 3, 3],
        ["Doja Cat", 1, 0],
        ["Social House", 1, 0],
      ],
    );
    assert.equal(artist("Social House")?.artworkPath, "/covers/bf.jpg");
    assert.deepEqual(
      selectArtistDetail(db, artist("Social House")?.id ?? -1)?.appearsOn.map((a) => a.title),
      ["boyfriend"],
    );
    assert.equal(
      selectArtistDetail(db, artist("Social House")?.id ?? -1)?.songs[0]?.artist,
      "Ariana Grande, Social House",
    );
    assert.deepEqual(
      db.select({ trackId: schema.favorites.trackId }).from(schema.favorites).all(),
      [{ trackId: motive }],
    );
    assert.deepEqual(
      db
        .select({ trackId: schema.playlistItems.trackId })
        .from(schema.playlistItems)
        .orderBy(schema.playlistItems.position)
        .all(),
      [{ trackId: boyfriend }, { trackId: rings }],
    );
    assert.deepEqual(
      db
        .select({ trackId: schema.playEvents.trackId, artistId: schema.playEvents.artistId })
        .from(schema.playEvents)
        .all(),
      [
        { trackId: boyfriend, artistId: null },
        { trackId: 999, artistId: artist("Ariana Grande")?.id },
      ],
    );
  });

  test("the Library's artist count and an artist's link row count collaborations", () => {
    scan(...ariana);
    assert.equal(libraryCounts(db).artists, 3);
    const doja = selectLinkRows(db, { artistId: artist("Doja Cat")?.id }).artist;
    assert.equal(doja?.trackCount, 1);
    assert.equal(doja?.albumCount, 0);
    assert.equal(
      selectLinkRows(db, { artistId: artist("Ariana Grande")?.id }).artist?.trackCount,
      3,
    );
  });

  test("an artist only credited on collaborations shows a cover of theirs", () => {
    saveBatch(
      db,
      [
        indexed(ariana[0] ?? { title: "" }),
        { ...indexed(ariana[2] ?? { title: "" }), artworkHash: "boyfriend" },
      ],
      [
        {
          hash: "boyfriend",
          path: "/covers/boyfriend.jpg",
          thumbPath: "/thumbs/boyfriend.jpg",
          palette: {},
        },
      ],
      [],
      0,
    );
    removeTracks(db, []);
    assert.equal(artist("Social House")?.artworkPath, "/covers/boyfriend.jpg");
  });

  const creepin = {
    title: "Creepin'",
    artist: joinArtists(["Metro Boomin", "The Weeknd", "21 Savage"]),
    album: "Heroes & Villains",
  };

  test("a downloaded YT Music collaboration files under each of its artists once one has a song of their own", () => {
    scan(creepin, { title: "Blinding Lights", artist: "The Weeknd", album: "After Hours" });
    assert.deepEqual(
      selectArtists(db, {}).map((row) => [row.name, row.trackCount]),
      [
        ["Metro Boomin", 1],
        ["The Weeknd", 2],
        ["21 Savage", 1],
      ],
    );
  });

  test("a downloaded YT Music collaboration whose artists have no other song stays one artist", () => {
    scan(creepin);
    assert.deepEqual(
      selectArtists(db, {}).map((row) => row.name),
      ["Metro Boomin, The Weeknd & 21 Savage"],
    );
  });

  test("rows show the credit as written, and link to the primary artist", () => {
    scan(...ariana);
    const detail = selectArtistDetail(db, artist("Social House")?.id ?? -1);
    assert.equal(detail?.songs[0]?.artist, "Ariana Grande · Social House");
    assert.equal(detail?.songs[0]?.artistId, artist("Ariana Grande")?.id);
    assert.equal(detail?.appearsOn[0]?.albumArtist, "Ariana Grande · Social House");
    assert.equal(detail?.appearsOn[0]?.albumArtistId, artist("Ariana Grande")?.id);
  });
});
