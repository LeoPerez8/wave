/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import { EMPTY_SYNC_TABLES, type PlaylistSong } from "@wave/core";
import { eq } from "drizzle-orm";

import { creditSplits } from "./credits.ts";
import {
  removePlaylistImage,
  selectPlaylistImageOriginal,
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

/** Image [name], framed out of original photo [original] (each pick saves a new one). */
const image = (name: string, original = name, framing = `{"framing":"${name}"}`) => ({
  path: `/files/artwork/playlists/${name}.jpg`,
  thumbPath: `/files/artwork/playlists/${name}_thumb.jpg`,
  originalPath: `/files/artwork/playlists/${original}_photo.jpg`,
  framing,
});

/** Every file of image [name]: the image, its thumbnail and its original. */
const filesOf = (name: string) => [
  image(name).path,
  image(name).thumbPath,
  image(name).originalPath,
];

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
    assert.deepEqual(setPlaylistImage(db, playlistId, image("b")), filesOf("a"));
    assert.deepEqual(listed()?.thumbPaths, [image("b").thumbPath]);
  });

  test("removing it brings the mosaic back and hands back its files", () => {
    setPlaylistImage(db, playlistId, image("a"));
    assert.deepEqual(removePlaylistImage(db, playlistId), filesOf("a"));
    assert.deepEqual(listed(), { ...MOSAIC, hasImage: false });
    assert.deepEqual(removePlaylistImage(db, playlistId), []);
  });

  test("keeps the original photo and its framing, for Adjust Image", () => {
    assert.equal(selectPlaylistImageOriginal(db, playlistId), null);
    setPlaylistImage(db, playlistId, image("a"));
    assert.deepEqual(selectPlaylistImageOriginal(db, playlistId), {
      originalPath: image("a").originalPath,
      framing: image("a").framing,
    });
  });

  test("reframing from the same original hands back the old framing's files, not the original", () => {
    setPlaylistImage(db, playlistId, image("a"));
    assert.deepEqual(setPlaylistImage(db, playlistId, image("a2", "a", "{}")), [
      image("a").path,
      image("a").thumbPath,
    ]);
    assert.deepEqual(selectPlaylistImageOriginal(db, playlistId), {
      originalPath: image("a").originalPath,
      framing: "{}",
    });
    assert.deepEqual(listed()?.thumbPaths, [image("a2").thumbPath]);
  });

  test("an image saved before originals were kept is its own original", () => {
    db.update(schema.playlists)
      .set({ imagePath: image("old").path, imageThumbPath: image("old").thumbPath })
      .where(eq(schema.playlists.id, playlistId))
      .run();
    assert.deepEqual(selectPlaylistImageOriginal(db, playlistId), {
      originalPath: image("old").path,
      framing: null,
    });
    // Reframed from it, the old image stays on as the original.
    const reframed = { ...image("new"), originalPath: image("old").path };
    assert.deepEqual(setPlaylistImage(db, playlistId, reframed), [image("old").thumbPath]);
    assert.deepEqual(removePlaylistImage(db, playlistId), [
      image("new").path,
      image("new").thumbPath,
      image("old").path,
    ]);
  });

  test("given to a playlist that's gone, the new files come straight back", () => {
    deletePlaylist(db, playlistId, 1_000);
    assert.deepEqual(setPlaylistImage(db, playlistId, image("a")), filesOf("a"));
    assert.deepEqual(setPlaylistImage(db, 9_999, image("b")), filesOf("b"));
  });

  test("a deleted playlist's image files are handed back once, for deleting", () => {
    setPlaylistImage(db, playlistId, image("a"));
    assert.deepEqual(takeDeletedPlaylistImages(db), []);
    deletePlaylist(db, playlistId, 1_000);
    assert.deepEqual(takeDeletedPlaylistImages(db), filesOf("a"));
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
    assert.deepEqual(takeDeletedPlaylistImages(db), filesOf("a"));
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
