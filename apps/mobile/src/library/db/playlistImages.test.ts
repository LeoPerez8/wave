/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { EMPTY_SYNC_TABLES, type PlaylistSong } from "@wave/core";
import { eq } from "drizzle-orm";

import { creditSplits } from "./credits.ts";
import {
  removePlaylistImage,
  setPlaylistImage,
  takeDeletedPlaylistImages,
} from "./playlistImages.ts";
import {
  appendPlaylistSongs,
  deletePlaylist,
  renamePlaylist,
  selectPlaylist,
  selectPlaylists,
} from "./playlists.ts";
import { removeTracks } from "./save.ts";
import * as schema from "./schema.ts";
import { selectChangesSince } from "./sync.ts";
import { applyPulledPage, selectUnpushed } from "./syncRows.ts";
import { addTrack, openTestDatabase, type TestDatabase } from "./testDatabase.ts";

let db: TestDatabase;
let playlistId: number;

const image = (name: string) => ({
  path: `/files/artwork/playlists/${name}.jpg`,
  thumbPath: `/files/artwork/playlists/${name}_thumb.jpg`,
});

/** Two albums: the first one's cover stands alone (Core's `playlistMosaic`). */
const MOSAIC = { thumbPaths: ["/covers/h1.thumb.jpg"], artworkPaths: ["/covers/h1.jpg"] };

/** What Library › Playlists shows for the playlist. */
const listed = () => {
  const row = selectPlaylists(db).find((playlist) => playlist.id === playlistId);
  return (
    row && { thumbPaths: row.thumbPaths, artworkPaths: row.artworkPaths, hasImage: row.hasImage }
  );
};

/** What the playlist's page shows. */
const opened = () => {
  const row = selectPlaylist(db, playlistId)?.playlist;
  return (
    row && { thumbPaths: row.thumbPaths, artworkPaths: row.artworkPaths, hasImage: row.hasImage }
  );
};

beforeEach(async () => {
  db = await openTestDatabase();
  playlistId = db
    .insert(schema.playlists)
    .values({ name: "Drive", createdAt: 0, updatedAt: 0, changedAt: 0, pushed: true })
    .returning()
    .get().id;
  const songs: PlaylistSong[] = ["One", "Two"].map((title, i) => ({
    source: "library",
    trackId: addTrack(db, { title, album: "Mix", artist: "Radiohead", artworkHash: `h${i + 1}` }),
  }));
  appendPlaylistSongs(db, playlistId, songs, 0);
});

describe("a playlist's own image", () => {
  test("without one, the playlist shows its mosaic", () => {
    assert.deepEqual(listed(), { ...MOSAIC, hasImage: false });
  });

  test("shows instead of the mosaic, in lists and on the playlist's page", () => {
    assert.deepEqual(setPlaylistImage(db, playlistId, image("a")), []);
    const shown = {
      thumbPaths: [image("a").thumbPath],
      artworkPaths: [image("a").path],
      hasImage: true,
    };
    assert.deepEqual(listed(), shown);
    assert.deepEqual(opened(), shown);
  });

  test("changing it hands back the old image's files, to delete", () => {
    setPlaylistImage(db, playlistId, image("a"));
    assert.deepEqual(setPlaylistImage(db, playlistId, image("b")), [
      image("a").path,
      image("a").thumbPath,
    ]);
    assert.deepEqual(listed()?.thumbPaths, [image("b").thumbPath]);
  });

  test("removing it brings the mosaic back and hands back its files", () => {
    setPlaylistImage(db, playlistId, image("a"));
    assert.deepEqual(removePlaylistImage(db, playlistId), [image("a").path, image("a").thumbPath]);
    assert.deepEqual(listed(), { ...MOSAIC, hasImage: false });
    assert.deepEqual(removePlaylistImage(db, playlistId), []);
  });

  test("given to a playlist that's gone, the new files come straight back", () => {
    deletePlaylist(db, playlistId, 1_000);
    assert.deepEqual(setPlaylistImage(db, playlistId, image("a")), [
      image("a").path,
      image("a").thumbPath,
    ]);
    assert.deepEqual(setPlaylistImage(db, 9_999, image("b")), [
      image("b").path,
      image("b").thumbPath,
    ]);
  });

  test("a deleted playlist's image files are handed back once, for deleting", () => {
    setPlaylistImage(db, playlistId, image("a"));
    assert.deepEqual(takeDeletedPlaylistImages(db), []);
    deletePlaylist(db, playlistId, 1_000);
    assert.deepEqual(takeDeletedPlaylistImages(db), [image("a").path, image("a").thumbPath]);
    assert.deepEqual(takeDeletedPlaylistImages(db), []);
  });

  test("a playlist deleted on another phone gives its image up too", () => {
    setPlaylistImage(db, playlistId, image("a"));
    const syncId = db
      .select({ syncId: schema.playlists.syncId })
      .from(schema.playlists)
      .where(eq(schema.playlists.id, playlistId))
      .get()?.syncId;
    applyPulledPage(
      db,
      {
        ...EMPTY_SYNC_TABLES,
        playlists: [{ id: syncId ?? "", changedAt: 5_000, phoneId: "other", deleted: true }],
        cursor: "c1",
        more: false,
      },
      new Map(),
      5_000,
    );
    assert.deepEqual(takeDeletedPlaylistImages(db), [image("a").path, image("a").thumbPath]);
  });

  test("stays on this phone: setting or removing it isn't a change the Wave account gets", () => {
    setPlaylistImage(db, playlistId, image("a"));
    removePlaylistImage(db, playlistId);
    setPlaylistImage(db, playlistId, image("b"));
    assert.deepEqual(selectChangesSince(db, 0).playlists, []);
    assert.deepEqual(selectUnpushed(db, 100, () => null).rows.playlists, []);
  });

  test("survives a rename, and a rescan that takes every song away", () => {
    setPlaylistImage(db, playlistId, image("a"));
    renamePlaylist(db, playlistId, "Night Drive", 1_000);
    const paths = db.select({ path: schema.tracks.path }).from(schema.tracks).all();
    removeTracks(
      db,
      creditSplits(),
      paths.flatMap(({ path }) => (path === null ? [] : [path])),
    );
    assert.deepEqual(listed(), {
      thumbPaths: [image("a").thumbPath],
      artworkPaths: [image("a").path],
      hasImage: true,
    });
  });
});
