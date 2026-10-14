/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import {
  artistPlayTotals,
  creditSplitter,
  joinArtists,
  normalizeTrack,
  type RawTrack,
} from "@wave/core";
import { sql } from "drizzle-orm";

import type { IndexedTrack } from "../LibraryStore.ts";
import { selectArtistDetail, selectArtists } from "./artists.ts";
import { libraryCounts } from "./counts.ts";
import { creditSplits, type CreditSplits } from "./credits.ts";
import { selectLinkRows } from "./links.ts";
import { removeTracks, saveBatch } from "./save.ts";
import * as schema from "./schema.ts";
import { creditedPlayTotals, songListening } from "./stats.ts";
import {
  addTrack,
  migrateTestDatabase,
  openTestDatabase,
  star,
  type TestDatabase,
} from "./testDatabase.ts";

let db: TestDatabase;
let splits: CreditSplits;

beforeEach(async () => {
  db = await openTestDatabase();
  splits = creditSplits();
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

/** Saves [tracks] as a scan does: in a batch each ([batches]), then completing the scan. */
const scanBatches = (...batches: Omit<RawTrack, "path">[][]): void => {
  for (const tracks of batches) saveBatch(db, splits, tracks.map(indexed), [], [], 0);
  removeTracks(db, splits, []);
};

/** Saves [tracks] as a scan does: in a batch, then completing the scan. */
const scan = (...tracks: Omit<RawTrack, "path">[]): void => scanBatches(tracks);

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

  test("each value of a multi-value artist tag is an artist of its own, even with no song alone", () => {
    scan({
      title: "boyfriend",
      artist: "Ariana Grande",
      artists: ["Ariana Grande", "Social House"],
      album: "boyfriend",
      albumArtists: ["Ariana Grande", "Social House"],
    });
    assert.deepEqual(
      selectArtists(db, {}).map((row) => [row.name, row.trackCount]),
      [
        ["Ariana Grande", 1],
        ["Social House", 1],
      ],
    );
    assert.deepEqual(
      selectArtistDetail(db, artist("Social House")?.id ?? -1)?.appearsOn.map((a) => a.title),
      ["boyfriend"],
    );
    // Rows show the values joined with commas.
    assert.equal(
      selectArtistDetail(db, artist("Social House")?.id ?? -1)?.songs[0]?.artist,
      "Ariana Grande, Social House",
    );
  });

  test("a value holding a comma stays one artist when the Library has it", () => {
    scan(
      {
        title: "Boogie Wonderland",
        artist: "Earth, Wind & Fire",
        artists: ["Earth, Wind & Fire", "The Emotions"],
        album: "I Am",
      },
      { title: "September", artist: "Earth, Wind & Fire", album: "The Best of" },
    );
    assert.deepEqual(
      selectArtists(db, {}).map((row) => row.name),
      ["Earth, Wind & Fire", "The Emotions"],
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
    v7.run(sql`INSERT INTO play_events (track_id, started_at, listened_ms, duration_ms, end_reason, counted, album_id, artist_id)
      VALUES (${boyfriend}, 1, 180000, 180000, 'completed', 1, NULL, NULL), (999, 2, 180000, 180000, 'completed', 1, (SELECT album_id FROM tracks WHERE id = ${boyfriend}), ${collab})`);

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
        .orderBy(schema.playlistItems.orderKey)
        .all(),
      [{ trackId: boyfriend }, { trackId: rings }],
    );
    // The deleted collaboration's play counts for each of its artists.
    assert.deepEqual(
      songListening(db)
        .map((song) => [song.trackId, song.artistIds])
        .toSorted(),
      [
        [boyfriend, [artist("Ariana Grande")?.id, artist("Social House")?.id]],
        [999, [artist("Ariana Grande")?.id, artist("Social House")?.id]],
      ],
    );
    assert.deepEqual(
      artistPlayTotals(creditedPlayTotals(db, { from: null, to: 10 }))
        .map((row) => [row.sortKey, row.countedPlays])
        .toSorted(),
      [
        ["ariana grande", 2],
        ["social house", 2],
      ],
    );
  });

  test("a credit a later batch brings re-files what an earlier batch of the scan saved", () => {
    scanBatches(
      [{ title: "boyfriend", artist: "Ariana Grande & Social House", album: "boyfriend" }],
      [{ title: "7 rings", artist: "Ariana Grande", album: "thank u, next" }],
    );
    assert.deepEqual(
      selectArtists(db, {}).map((row) => row.name),
      ["Ariana Grande", "Social House"],
    );
  });

  test("deleting the song an artist had alone makes their collaboration one artist again", () => {
    scan(
      { title: "boyfriend", artist: "Ariana Grande & Social House", album: "boyfriend" },
      { title: "7 rings", artist: "Ariana Grande", album: "thank u, next" },
    );
    removeTracks(db, splits, ["/Music/thank u, next/7 rings.mp3"]);
    assert.deepEqual(
      selectArtists(db, {}).map((row) => row.name),
      ["Ariana Grande & Social House"],
    );
  });

  test("a scan that brings no new credit builds no splitter and splits only its own credits", () => {
    const count = { builds: 0, splits: 0 };
    splits = creditSplits((known) => {
      count.builds += 1;
      const split = creditSplitter(known);
      return (credit) => {
        count.splits += 1;
        return split(credit);
      };
    });
    scanBatches(ariana.slice(0, 1), ariana.slice(1), [
      { title: "Say So", artist: "Doja Cat", album: "Hot Pink" },
    ]);
    count.builds = 0;
    count.splits = 0;
    // A scan finding "7 rings" again, unchanged: its batch's credits, and no others.
    scanBatches(ariana.slice(0, 1));
    assert.equal(count.builds, 0);
    assert.equal(count.splits, 1);
    // Nothing deleted: the Library's credits are as they were.
    removeTracks(db, splits, []);
    assert.equal(count.splits, 1);
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
      splits,
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
    removeTracks(db, splits, []);
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

  test("song and album rows list every credited artist, primary first (Go to Artist offers them)", () => {
    scan(...ariana, {
      title: "Say So (Remix)",
      artist: "Doja Cat feat. Nicki Minaj",
      album: "Say So",
      albumArtist: "Doja Cat, Nicki Minaj",
    });
    const id = (name: string) => artist(name)?.id ?? -1;
    const songs = selectArtistDetail(db, id("Doja Cat"))?.songs ?? [];
    assert.deepEqual(
      songs.map((song) => [song.title, song.artistIds]),
      [
        ["motive", [id("Ariana Grande"), id("Doja Cat")]],
        ["Say So (Remix)", [id("Doja Cat"), id("Nicki Minaj")]],
      ],
    );
    const albums = selectArtistDetail(db, id("Nicki Minaj"))?.appearsOn ?? [];
    assert.deepEqual(
      albums.map((album) => [album.title, album.albumArtistIds]),
      [["Say So", [id("Doja Cat"), id("Nicki Minaj")]]],
    );
    const single = selectArtistDetail(db, id("Ariana Grande"))?.albums ?? [];
    assert.deepEqual(single.find((album) => album.title === "thank u, next")?.albumArtistIds, [
      id("Ariana Grande"),
    ]);
  });
});
