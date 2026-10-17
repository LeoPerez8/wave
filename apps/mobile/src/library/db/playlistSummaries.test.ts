/// <reference types="node" />
/**
 * Library › Playlists and a playlist's page while one playlist changes (an
 * import filling it, #308): the others' mosaics and totals come from what was
 * worked out before, and every kind of write still shows.
 */
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import type { PlaylistSong, YtAlbumSong } from "@wave/core";
import { eq, sql } from "drizzle-orm";

import {
  addToPlaylist,
  linkPlaylistEntries,
  removePlaylistItems,
  selectPlaylist,
  selectPlaylistCovers,
  selectPlaylistEntries,
  selectPlaylists,
  selectPlaylistTotals,
} from "./playlists.ts";
import { playlistWork, resetPlaylistWork } from "./playlistWork.ts";
import * as schema from "./schema.ts";
import { joinAccount } from "./syncRows.ts";
import {
  addTrack,
  migrateTestDatabase,
  openTestDatabase,
  type TestDatabase,
} from "./testDatabase.ts";

let db: TestDatabase;
const ids: Record<string, number> = {};
let filling: number;
let other: number;

const yt = (videoId: string, fields: Partial<YtAlbumSong> = {}): YtAlbumSong => ({
  videoId,
  title: `Song ${videoId}`,
  artists: ["Radiohead"],
  album: "OK Computer",
  albumId: null,
  durationMs: 100_000,
  artworkUrl: `https://yt/${videoId}`,
  explicit: false,
  ...fields,
});
const stream = (song: YtAlbumSong): PlaylistSong => ({ source: "stream", song });
const library = (title: string): PlaylistSong => ({ source: "library", trackId: ids[title] ?? -1 });

const newPlaylist = (name: string): number =>
  db
    .insert(schema.playlists)
    .values({ name, createdAt: 0, updatedAt: 0, changedAt: 0 })
    .returning()
    .get().id;

/** Each playlist's name, song count, length and first thumbnail, as Library › Playlists lists it. */
const listed = () =>
  selectPlaylists(db).map((row) => [row.name, row.trackCount, row.durationMs, row.thumbPaths[0]]);

const summarized = (): Record<number, number> => Object.fromEntries(playlistWork().summarized);

beforeEach(async () => {
  db = await openTestDatabase();
  ids.Airbag = addTrack(db, { title: "Airbag", durationMs: 200_000, artworkHash: "ok" });
  ids.Bloom = addTrack(db, { title: "Bloom", album: "TKOL", durationMs: 300_000 });
  filling = newPlaylist("Filling");
  other = newPlaylist("Other");
  addToPlaylist(db, other, [stream(yt("o1")), library("Airbag")], 0);
  addToPlaylist(db, filling, [stream(yt("f1"))], 0);
  selectPlaylists(db);
  resetPlaylistWork();
});

describe("Library › Playlists while one playlist fills", () => {
  test("an addition works out that playlist's mosaic and totals again, not the others'", () => {
    addToPlaylist(db, filling, [stream(yt("f2")), library("Bloom")], 1);
    assert.deepEqual(listed(), [
      ["Filling", 3, 500_000, "https://yt/f1"],
      ["Other", 2, 300_000, "https://yt/o1"],
    ]);
    assert.deepEqual(summarized(), { [filling]: 1 });
    assert.equal(playlistWork().decoded.get(other), undefined);
  });

  test("nothing changed, nothing is worked out again", () => {
    listed();
    assert.deepEqual(summarized(), {});
  });

  test("the page counts its songs as the list does", () => {
    db.insert(schema.playlistItems)
      .values({ playlistId: filling, ytSong: "not json", orderKey: "a9", addedAt: 0, changedAt: 0 })
      .run();
    addToPlaylist(db, filling, [library("Bloom"), stream(yt("f2", { durationMs: null }))], 1);
    const page = selectPlaylist(db, filling)?.playlist;
    assert.deepEqual([page?.trackCount, page?.durationMs], [3, 400_000]);
    assert.deepEqual(selectPlaylistTotals(db, filling).get(filling), {
      trackCount: 3,
      durationMs: 400_000,
      unavailableCount: 0,
    });
  });

  test("the page and the list share what was worked out", () => {
    addToPlaylist(db, filling, [stream(yt("f2"))], 1);
    const page = selectPlaylist(db, filling)?.playlist;
    assert.deepEqual([page?.trackCount, page?.durationMs], [2, 200_000]);
    listed();
    assert.deepEqual(summarized(), { [filling]: 1 });
  });

  test("a removal shows", () => {
    const [first] = selectPlaylistEntries(db, other);
    removePlaylistItems(db, other, [first?.itemId ?? -1], 1);
    assert.deepEqual(listed()[1], ["Other", 1, 200_000, "/covers/ok.thumb.jpg"]);
  });

  test("a YT Music entry the Library gains shows as that song", () => {
    const lucky = addTrack(db, {
      title: "Song o1",
      artist: "Radiohead",
      album: "Lucky",
      durationMs: 101_000,
      artworkHash: "lucky",
    });
    assert.equal(linkPlaylistEntries(db, 1, [lucky]), 1);
    assert.deepEqual(listed()[1], ["Other", 2, 301_000, "/covers/lucky.thumb.jpg"]);
  });

  test("a Library song's new length and its album's new cover show", () => {
    const solo = newPlaylist("Solo");
    addToPlaylist(db, solo, [library("Airbag")], 0);
    listed();
    resetPlaylistWork();
    db.update(schema.tracks)
      .set({ durationMs: 210_000 })
      .where(eq(schema.tracks.id, ids.Airbag ?? -1))
      .run();
    assert.deepEqual(listed()[2], ["Solo", 1, 210_000, "/covers/ok.thumb.jpg"]);
    db.run(
      sql`INSERT INTO artwork (hash, path, thumb_path, palette) VALUES ('new', '/n', '/n.thumb', '{}')`,
    );
    db.run(sql`UPDATE albums SET artwork_hash = 'new'`);
    assert.deepEqual(listed()[2], ["Solo", 1, 210_000, "/n.thumb"]);
    db.run(sql`UPDATE artwork SET thumb_path = '/n2.thumb'`);
    assert.deepEqual(listed()[2], ["Solo", 1, 210_000, "/n2.thumb"]);
  });

  test("a Library song that leaves takes its entries with it", () => {
    db.delete(schema.tracks)
      .where(eq(schema.tracks.id, ids.Airbag ?? -1))
      .run();
    assert.deepEqual(listed()[1], ["Other", 1, 100_000, "https://yt/o1"]);
  });

  test("entries pulled from the Wave account show", () => {
    db.run(sql`INSERT INTO playlist_items
      (playlist_id, sync_id, yt_song, order_key, added_at, changed_at, phone_id, pushed)
      VALUES (${other}, 'pulled', ${JSON.stringify(yt("p1", { durationMs: 5_000 }))}, 'a9', 0, 7,
        'another phone', 1)`);
    assert.deepEqual(listed()[1], ["Other", 3, 305_000, "https://yt/o1"]);
  });

  test("marking every row to go up again (joining an account) works nothing out again", () => {
    joinAccount(db, "account");
    listed();
    assert.deepEqual(summarized(), {});
  });
});

describe("the filling playlist's page", () => {
  const shown = (id: number) =>
    selectPlaylistEntries(db, id).map((entry) =>
      entry.source === "library" ? entry.track.title : `yt:${entry.song.title}`,
    );

  test("read again, decodes only the entries added since", () => {
    addToPlaylist(db, filling, [stream(yt("f2")), stream(yt("f3"))], 1);
    shown(filling);
    resetPlaylistWork();
    addToPlaylist(db, filling, [stream(yt("f4")), library("Bloom")], 2);
    assert.deepEqual(shown(filling), [
      "yt:Song f1",
      "yt:Song f2",
      "yt:Song f3",
      "yt:Song f4",
      "Bloom",
    ]);
    assert.equal(playlistWork().decoded.get(filling), 1);
  });

  test("shows an entry that became a Library song, and one that went back to YT Music", () => {
    shown(other);
    const lucky = addTrack(db, { title: "Song o1", artist: "Radiohead", durationMs: 101_000 });
    linkPlaylistEntries(db, 1, [lucky]);
    assert.deepEqual(shown(other), ["Song o1", "Airbag"]);
    // As signing out does with a missing song's entry: unstamped.
    db.run(sql`UPDATE playlist_items SET track_id = NULL,
      yt_song = ${JSON.stringify(yt("o1", { title: "Back" }))} WHERE track_id = ${lucky}`);
    assert.deepEqual(shown(other), ["yt:Back", "Airbag"]);
  });

  test("another playlist's page reads its own songs", () => {
    shown(filling);
    assert.deepEqual(shown(other), ["yt:Song o1", "Airbag"]);
    assert.deepEqual(shown(filling), ["yt:Song f1"]);
  });
});

describe("selectPlaylistCovers", () => {
  test("a mosaic's later tiles can come from far down a long playlist", () => {
    const long = newPlaylist("Long");
    const same = Array.from({ length: 300 }, (_, i) =>
      stream(yt(`s${i}`, { artworkUrl: i % 2 === 0 ? "https://yt/same" : null })),
    );
    addToPlaylist(
      db,
      long,
      [...same, library("Airbag"), stream(yt("late")), library("Bloom"), stream(yt("later"))],
      0,
    );
    const expected = {
      thumbPaths: [
        "https://yt/same",
        "/covers/ok.thumb.jpg",
        "https://yt/late",
        "https://yt/later",
      ],
      artworkPaths: ["https://yt/same", "/covers/ok.jpg", "https://yt/late", "https://yt/later"],
    };
    assert.deepEqual(selectPlaylistCovers(db, long).get(long), expected);
    assert.deepEqual(selectPlaylistCovers(db).get(long), expected);
  });
});

describe("migration 0022", () => {
  test("playlists from before it are listed, and their edits show after it", async () => {
    db = await openTestDatabase({ through: "0021_playlist_images" });
    ids.Airbag = addTrack(db, { title: "Airbag", durationMs: 200_000 });
    db.run(sql`INSERT INTO playlists (name, sync_id, created_at, updated_at, changed_at, phone_id)
      VALUES ('Old', 'p1', 0, 0, 0, 'phone')`);
    db.run(sql`INSERT INTO playlist_items (playlist_id, sync_id, track_id, order_key, added_at, changed_at, phone_id)
      VALUES (1, 'e1', ${ids.Airbag}, 'a0', 0, 0, 'phone')`);
    await migrateTestDatabase(db);
    assert.deepEqual(listed(), [["Old", 1, 200_000, undefined]]);
    addToPlaylist(db, 1, [stream(yt("n1"))], 1);
    assert.deepEqual(listed(), [["Old", 2, 300_000, "https://yt/n1"]]);
  });
});

describe("selectPlaylistTotals", () => {
  test("counts exactly the stored songs the playlist's list can read", () => {
    const stored = [
      "not json",
      "[1]",
      "null",
      JSON.stringify({ title: "no id", artists: [], album: null, durationMs: 1, artworkUrl: null }),
      JSON.stringify({ ...yt("x"), videoId: "" }),
      JSON.stringify({ ...yt("x"), title: 7 }),
      JSON.stringify({ ...yt("x"), artists: "Radiohead" }),
      JSON.stringify({ ...yt("x"), artists: ["Radiohead", 2] }),
      JSON.stringify({ ...yt("x"), album: 3 }),
      JSON.stringify({ ...yt("x"), album: undefined }),
      JSON.stringify({ ...yt("x"), artworkUrl: false }),
      JSON.stringify({ ...yt("x"), durationMs: "1" }),
      JSON.stringify({ ...yt("x"), durationMs: undefined }),
      JSON.stringify({ ...yt("ok1"), durationMs: 1_000 }),
      JSON.stringify({ ...yt("ok2"), durationMs: null, album: null, artworkUrl: null }),
      JSON.stringify({ ...yt("ok3"), durationMs: 2.5, artists: [], albumId: 4, explicit: "yes" }),
      JSON.stringify({
        videoId: "ok4",
        title: "",
        artists: [],
        album: null,
        durationMs: 1_000,
        artworkUrl: null,
      }),
    ];
    const playlist = newPlaylist("Odd");
    stored.forEach((ytSong, i) => {
      db.insert(schema.playlistItems)
        .values({ playlistId: playlist, ytSong, orderKey: `a${i}`, addedAt: 0, changedAt: 0 })
        .run();
    });
    const readable = selectPlaylistEntries(db, playlist);
    assert.equal(readable.length, 4);
    assert.deepEqual(selectPlaylistTotals(db, playlist).get(playlist), {
      trackCount: 4,
      durationMs: 2_002.5,
      unavailableCount: 0,
    });
  });
});
