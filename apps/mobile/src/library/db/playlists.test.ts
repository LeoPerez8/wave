/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { normalizeTrack, type PlaylistSong, type YtAlbumSong } from "@wave/core";
import { eq, sql } from "drizzle-orm";

import type { IndexedTrack } from "../LibraryStore.ts";
import { creditSplits } from "./credits.ts";
import {
  appendPlaylistSongs,
  linkPlaylistEntries,
  removePlaylistItems,
  replacePlaylistSongs,
  selectPlaylistCovers,
  selectPlaylistEntries,
  selectPlaylistTotals,
  selectTrackPaths,
} from "./playlists.ts";
import { saveBatch } from "./save.ts";
import * as schema from "./schema.ts";
import {
  addTrack,
  migrateTestDatabase,
  openTestDatabase,
  type TestDatabase,
} from "./testDatabase.ts";

let db: TestDatabase;
let playlistId: number;
const ids: Record<string, number> = {};

const yt = (videoId: string, fields: Partial<YtAlbumSong> = {}): YtAlbumSong => ({
  videoId,
  title: `Song ${videoId}`,
  artists: ["Radiohead"],
  album: "OK Computer",
  albumId: "MPREb_ok",
  durationMs: 180_000,
  artworkUrl: `https://lh3.googleusercontent.com/${videoId}`,
  explicit: false,
  ...fields,
});

const library = (title: string): PlaylistSong => ({ source: "library", trackId: ids[title] ?? -1 });
const stream = (song: YtAlbumSong): PlaylistSong => ({ source: "stream", song });

const newPlaylist = (name: string): number =>
  db.insert(schema.playlists).values({ name, createdAt: 0, updatedAt: 0 }).returning().get().id;

beforeEach(async () => {
  db = await openTestDatabase();
  for (const title of ["Airbag", "Bloom", "Creep", "Daydreaming"]) {
    ids[title] = addTrack(db, { title, album: "Mix", artist: "Radiohead" });
  }
  playlistId = newPlaylist("Drive");
  // Out of title order, with a gap in the positions.
  const items: [string, number][] = [
    ["Daydreaming", 0],
    ["Airbag", 1],
    ["Creep", 5],
    ["Airbag", 7],
  ];
  for (const [title, position] of items) {
    db.insert(schema.playlistItems)
      .values({ playlistId, trackId: ids[title] ?? -1, position, addedAt: 0 })
      .run();
  }
});

/** What the playlist lists, a YT Music entry as `yt:<title>`. */
const titlesOf = (id: number, page?: { offset: number; limit: number }) =>
  selectPlaylistEntries(db, id, page).map((entry) =>
    entry.source === "library" ? entry.track.title : `yt:${entry.song.title}`,
  );

const titles = (page?: { offset: number; limit: number }) => titlesOf(playlistId, page);

describe("selectPlaylistEntries", () => {
  test("lists a playlist's songs in playlist order, repeats included", () => {
    assert.deepEqual(titles(), ["Daydreaming", "Airbag", "Creep", "Airbag"]);
  });

  test("each row carries its playlist item", () => {
    const items = selectPlaylistEntries(db, playlistId).map((entry) => entry.itemId);
    assert.equal(new Set(items).size, 4);
  });

  test("a page is a window of that order", () => {
    assert.deepEqual(titles({ offset: 1, limit: 2 }), ["Airbag", "Creep"]);
    assert.deepEqual(titles({ offset: 4, limit: 2 }), []);
  });

  test("songs that left the library drop out", () => {
    db.delete(schema.tracks)
      .where(eq(schema.tracks.id, ids.Creep ?? -1))
      .run();
    assert.deepEqual(titles(), ["Daydreaming", "Airbag", "Airbag"]);
  });

  test("YT Music entries sit among the Library's songs, with what shows them", () => {
    appendPlaylistSongs(db, playlistId, [stream(yt("a", { title: "Lucky" }))], 0);
    const entries = selectPlaylistEntries(db, playlistId);
    assert.deepEqual(entries.at(-1), {
      itemId: entries.at(-1)?.itemId,
      source: "stream",
      song: yt("a", { title: "Lucky" }),
    });
    assert.deepEqual(titles({ offset: 3, limit: 2 }), ["Airbag", "yt:Lucky"]);
  });
});

describe("appendPlaylistSongs", () => {
  test("Library and YT Music songs go at the end, in the order given", () => {
    const result = appendPlaylistSongs(
      db,
      playlistId,
      [
        stream(yt("a", { title: "Lucky" })),
        library("Bloom"),
        stream(yt("b", { title: "Reckoner" })),
      ],
      0,
    );
    assert.deepEqual(result, { added: 3, alreadyIn: 0 });
    assert.deepEqual(titles(), [
      "Daydreaming",
      "Airbag",
      "Creep",
      "Airbag",
      "yt:Lucky",
      "Bloom",
      "yt:Reckoner",
    ]);
  });

  test("songs the playlist already holds are skipped, a YT Music one by its video id", () => {
    appendPlaylistSongs(db, playlistId, [stream(yt("a"))], 0);
    const result = appendPlaylistSongs(db, playlistId, [stream(yt("a")), library("Creep")], 0);
    assert.deepEqual(result, { added: 0, alreadyIn: 2 });
  });
});

describe("removePlaylistItems", () => {
  const items = () => selectPlaylistEntries(db, playlistId);

  test("removes exactly the given entries; a repeat of the song left unchecked stays", () => {
    const [daydreaming, firstAirbag, creep] = items();
    removePlaylistItems(db, playlistId, [firstAirbag?.itemId ?? -1, creep?.itemId ?? -1], 1000);
    assert.deepEqual(titles(), ["Daydreaming", "Airbag"]);
    assert.equal(items()[0]?.itemId, daydreaming?.itemId);
  });

  test("removes YT Music entries as any other", () => {
    appendPlaylistSongs(db, playlistId, [stream(yt("a", { title: "Lucky" }))], 0);
    removePlaylistItems(db, playlistId, [items().at(-1)?.itemId ?? -1], 1000);
    assert.deepEqual(titles(), ["Daydreaming", "Airbag", "Creep", "Airbag"]);
  });

  test("marks the playlist as edited", () => {
    removePlaylistItems(db, playlistId, [items()[0]?.itemId ?? -1], 1000);
    const playlist = db
      .select()
      .from(schema.playlists)
      .where(eq(schema.playlists.id, playlistId))
      .get();
    assert.equal(playlist?.updatedAt, 1000);
  });

  test("leaves other playlists' entries alone", () => {
    const otherId = newPlaylist("Other");
    removePlaylistItems(
      db,
      otherId,
      items().map((entry) => entry.itemId),
      1000,
    );
    assert.equal(items().length, 4);
  });
});

describe("replacePlaylistSongs", () => {
  test("the playlist then holds exactly the given songs, in that order", () => {
    replacePlaylistSongs(
      db,
      playlistId,
      [library("Creep"), stream(yt("a", { title: "Lucky" })), library("Bloom")],
      1000,
    );
    assert.deepEqual(titles(), ["Creep", "yt:Lucky", "Bloom"]);
  });

  test("marks the playlist as edited and keeps it (and its name)", () => {
    replacePlaylistSongs(db, playlistId, [library("Bloom")], 1000);
    const playlist = db
      .select()
      .from(schema.playlists)
      .where(eq(schema.playlists.id, playlistId))
      .get();
    assert.equal(playlist?.name, "Drive");
    assert.equal(playlist?.updatedAt, 1000);
  });
});

describe("linkPlaylistEntries", () => {
  test("an entry the Library gains becomes that song in the same place, in every playlist", () => {
    const otherId = newPlaylist("Other");
    const lucky = yt("a", { title: "Lucky", durationMs: 259_000 });
    appendPlaylistSongs(db, playlistId, [stream(lucky), library("Bloom")], 0);
    appendPlaylistSongs(db, otherId, [stream(lucky)], 0);
    const before = selectPlaylistEntries(db, playlistId).map((entry) => entry.itemId);

    const luckyId = addTrack(db, { title: "Lucky", artist: "Radiohead", durationMs: 260_000 });
    assert.equal(linkPlaylistEntries(db, [luckyId]), 2);

    assert.deepEqual(titles(), ["Daydreaming", "Airbag", "Creep", "Airbag", "Lucky", "Bloom"]);
    assert.deepEqual(
      selectPlaylistEntries(db, playlistId).map((entry) => entry.itemId),
      before,
    );
    assert.deepEqual(titlesOf(otherId), ["Lucky"]);
  });

  test("a song that isn't the same recording leaves the entry streamed", () => {
    appendPlaylistSongs(db, playlistId, [stream(yt("a", { title: "Lucky" }))], 0);
    const live = addTrack(db, { title: "Lucky", artist: "Radiohead", durationMs: 320_000 });
    assert.equal(linkPlaylistEntries(db, [live]), 0);
    assert.equal(titles().at(-1), "yt:Lucky");
  });

  test("a scanned or downloaded batch links the entries it brings in", () => {
    appendPlaylistSongs(db, playlistId, [stream(yt("a", { title: "Lucky" }))], 0);
    saveBatch(db, creditSplits(), [indexedTrack("Lucky", "Radiohead", 180_000)], [], [], 0);
    assert.equal(titles().at(-1), "Lucky");
  });

  test("a scan's batches can leave linking to its end, which links against the whole Library", () => {
    appendPlaylistSongs(db, playlistId, [stream(yt("a", { title: "Lucky" }))], 0);
    saveBatch(db, creditSplits(), [indexedTrack("Lucky", "Radiohead", 180_000)], [], [], 0, {
      linkEntries: false,
    });
    assert.equal(titles().at(-1), "yt:Lucky");
    assert.equal(linkPlaylistEntries(db), 1);
    assert.equal(titles().at(-1), "Lucky");
  });

  test("an entry whose song its playlist already holds from the Library is dropped, not doubled", () => {
    const luckyId = addTrack(db, { title: "Lucky", artist: "Radiohead", durationMs: 180_000 });
    ids.Lucky = luckyId;
    appendPlaylistSongs(db, playlistId, [library("Lucky"), stream(yt("a", { title: "Lucky" }))], 0);
    linkPlaylistEntries(db, [luckyId]);
    assert.deepEqual(titles(), ["Daydreaming", "Airbag", "Creep", "Airbag", "Lucky"]);
  });

  test("of two entries of a playlist that become one Library song, the later is dropped", () => {
    const otherId = newPlaylist("Other");
    const uploads = [yt("a", { title: "Lucky" }), yt("b", { title: "Lucky", durationMs: 181_000 })];
    appendPlaylistSongs(
      db,
      playlistId,
      [stream(uploads[0]!), library("Bloom"), stream(uploads[1]!)],
      0,
    );
    appendPlaylistSongs(db, otherId, [stream(uploads[1]!)], 0);
    const luckyId = addTrack(db, { title: "Lucky", artist: "Radiohead", durationMs: 180_000 });
    linkPlaylistEntries(db, [luckyId]);
    assert.deepEqual(titles(), ["Daydreaming", "Airbag", "Creep", "Airbag", "Lucky", "Bloom"]);
    assert.deepEqual(titlesOf(otherId), ["Lucky"]);
  });

  test("deleting the Library song then takes its entries out, as for any Library song", () => {
    appendPlaylistSongs(db, playlistId, [stream(yt("a", { title: "Lucky" }))], 0);
    const luckyId = addTrack(db, { title: "Lucky", artist: "Radiohead" });
    linkPlaylistEntries(db, [luckyId]);
    db.delete(schema.tracks).where(eq(schema.tracks.id, luckyId)).run();
    assert.deepEqual(titles(), ["Daydreaming", "Airbag", "Creep", "Airbag"]);
  });
});

describe("a Library file leaving", () => {
  test("takes its entries out of playlists; YT Music entries stay", () => {
    appendPlaylistSongs(db, playlistId, [stream(yt("a", { title: "Lucky" }))], 0);
    db.delete(schema.tracks)
      .where(eq(schema.tracks.id, ids.Airbag ?? -1))
      .run();
    assert.deepEqual(titles(), ["Daydreaming", "Creep", "yt:Lucky"]);
  });
});

describe("selectPlaylistCovers", () => {
  test("a playlist's mosaic takes the covers of what it holds, YT Music's included", () => {
    const id = newPlaylist("Covers");
    const covered = (title: string, hash: string) =>
      addTrack(db, { title, album: title, artist: "Radiohead", artworkHash: hash });
    ids.One = covered("One", "h1");
    ids.Two = covered("Two", "h2");
    appendPlaylistSongs(
      db,
      id,
      [
        library("One"),
        stream(yt("a")),
        library("Two"),
        stream(yt("b", { artworkUrl: null })),
        stream(yt("c")),
      ],
      0,
    );
    assert.deepEqual(selectPlaylistCovers(db, id).get(id), {
      thumbPaths: [
        "/covers/h1.thumb.jpg",
        "https://lh3.googleusercontent.com/a",
        "/covers/h2.thumb.jpg",
        "https://lh3.googleusercontent.com/c",
      ],
      artworkPaths: [
        "/covers/h1.jpg",
        "https://lh3.googleusercontent.com/a",
        "/covers/h2.jpg",
        "https://lh3.googleusercontent.com/c",
      ],
    });
  });

  test("a cover repeated, or an unreadable entry, takes no tile; each playlist gets its own", () => {
    const id = newPlaylist("Repeats");
    const other = newPlaylist("Other");
    for (const [title, hash] of [
      ["One", "h1"],
      ["Two", "h2"],
      ["Three", "h3"],
    ] as const) {
      ids[title] = addTrack(db, { title, album: title, artist: "Radiohead", artworkHash: hash });
    }
    appendPlaylistSongs(db, id, [library("One")], 0);
    db.insert(schema.playlistItems)
      .values({ playlistId: id, ytSong: "not json", position: 1, addedAt: 0 })
      .run();
    // The same cover again, under other songs: one tile.
    db.insert(schema.playlistItems)
      .values({ playlistId: id, trackId: ids.One ?? -1, position: 2, addedAt: 0 })
      .run();
    appendPlaylistSongs(
      db,
      id,
      [stream(yt("a")), stream(yt("a2", { artworkUrl: yt("a").artworkUrl }))],
      0,
    );
    appendPlaylistSongs(db, id, [library("Two"), library("Three")], 0);
    appendPlaylistSongs(db, other, [library("Three")], 0);

    const covers = selectPlaylistCovers(db);
    assert.deepEqual(covers.get(id)?.thumbPaths, [
      "/covers/h1.thumb.jpg",
      "https://lh3.googleusercontent.com/a",
      "/covers/h2.thumb.jpg",
      "/covers/h3.thumb.jpg",
    ]);
    assert.deepEqual(covers.get(other), {
      thumbPaths: ["/covers/h3.thumb.jpg"],
      artworkPaths: ["/covers/h3.jpg"],
    });
  });
});

describe("selectPlaylistTotals", () => {
  test("counts and times every entry, YT Music's included", () => {
    appendPlaylistSongs(db, playlistId, [stream(yt("a", { durationMs: 60_000 }))], 0);
    appendPlaylistSongs(db, playlistId, [stream(yt("b", { durationMs: null }))], 0);
    const empty = newPlaylist("Empty");
    const totals = selectPlaylistTotals(db);
    assert.deepEqual(totals.get(playlistId), { trackCount: 6, durationMs: 4 * 180_000 + 60_000 });
    assert.equal(totals.get(empty), undefined);
  });

  test("leaves out an unreadable YT Music entry, as the playlist's list does", () => {
    appendPlaylistSongs(db, playlistId, [stream(yt("a", { durationMs: 60_000 }))], 0);
    for (const [position, ytSong] of [
      [10, "not json"],
      [11, JSON.stringify({ videoId: "b", durationMs: 90_000 })],
    ] as const) {
      db.insert(schema.playlistItems).values({ playlistId, ytSong, position, addedAt: 0 }).run();
    }
    const entries = selectPlaylistEntries(db, playlistId);
    assert.deepEqual(selectPlaylistTotals(db).get(playlistId), {
      trackCount: entries.length,
      durationMs: 4 * 180_000 + 60_000,
    });
  });
});

describe("selectTrackPaths", () => {
  test("lists every track's file with its id, for matching playlist files by path", () => {
    assert.deepEqual(
      selectTrackPaths(db).toSorted((a, b) => a.id - b.id),
      ["Airbag", "Bloom", "Creep", "Daydreaming"].map((title) => ({
        id: ids[title],
        path: `/Music/Mix/${title}.mp3`,
      })),
    );
  });
});

describe("migration 0016", () => {
  test("playlists from before YT Music entries come through unchanged", async () => {
    const old = await openTestDatabase({ through: "0015_tag_credits" });
    const a = addTrack(old, { title: "Airbag", album: "Mix", artist: "Radiohead" });
    const b = addTrack(old, { title: "Bloom", album: "Mix", artist: "Radiohead" });
    const id = old.get<{ id: number }>(
      sql`INSERT INTO playlists (name, created_at, updated_at) VALUES ('Old', 0, 0) RETURNING id`,
    ).id;
    for (const [trackId, position] of [
      [b, 0],
      [a, 3],
      [b, 4],
    ] as const) {
      old.run(
        sql`INSERT INTO playlist_items (playlist_id, track_id, position, added_at) VALUES (${id}, ${trackId}, ${position}, 0)`,
      );
    }
    const itemIds = old
      .all<{ id: number }>(sql`SELECT id FROM playlist_items ORDER BY position`)
      .map((row) => row.id);

    await migrateTestDatabase(old);

    const entries = selectPlaylistEntries(old, id);
    assert.deepEqual(
      entries.map((entry) => (entry.source === "library" ? entry.track.title : "yt")),
      ["Bloom", "Airbag", "Bloom"],
    );
    assert.deepEqual(
      entries.map((entry) => entry.itemId),
      itemIds,
    );
    // New entries keep counting on from the old ones.
    appendPlaylistSongs(old, id, [{ source: "stream", song: yt("a") }], 0);
    const last = selectPlaylistEntries(old, id).at(-1)?.itemId ?? 0;
    assert.ok(last > Math.max(...itemIds));
  });
});

/** A track as the scanner reports it, for saving a batch. */
const indexedTrack = (title: string, artist: string, durationMs: number): IndexedTrack => ({
  ...normalizeTrack({ path: `/Music/New/${title}.mp3`, title, artist, album: "New", durationMs }),
  sizeBytes: 1_000,
  modifiedAt: 0,
  sampleRate: null,
  bitrateKbps: null,
  artworkHash: null,
  hasLyrics: false,
});
