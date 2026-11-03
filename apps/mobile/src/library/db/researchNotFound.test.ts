import assert from "node:assert/strict";
import { test } from "node:test";
import {
  readPlaylistEntrySong,
  type PlaylistSong,
  type UnsearchedSong,
  type YtAlbumSong,
} from "@wave/core";

import {
  createPlaylist,
  deletePlaylist,
  removePlaylistItems,
  selectPlaylistGraveyard,
  selectPlaylist,
  selectPlaylistEntries,
  selectUnsearchedEntries,
  settleUnsearchedEntries,
} from "./playlists.ts";
import { markPushed, selectUnpushed } from "./syncRows.ts";
import {
  closeTestDatabase,
  migrateTestDatabase,
  openTestDatabase,
  reopenTestDatabase,
} from "./testDatabase.ts";

const skyfall: UnsearchedSong = {
  title: "Skyfall",
  artists: ["Adele"],
  album: "Skyfall",
  durationMs: 286_000,
  artworkUrl: "https://example.com/skyfall.jpg",
};
const notFound: PlaylistSong = {
  source: "unavailable",
  song: { ...skyfall, reason: "notFound" },
};

test("the video fallback upgrade retries old not-found entries in place, through the background fill", async () => {
  const db = await openTestDatabase({ through: "0053_playlist_graveyard" });
  try {
    const localFile: PlaylistSong = {
      source: "unavailable",
      song: { ...skyfall, title: "Local recording", artists: [], reason: "localFile" },
    };
    const { playlistId } = createPlaylist(db, "Imported", [localFile, notFound], 100);
    const before = selectPlaylistEntries(db, playlistId);

    await migrateTestDatabase(db);

    assert.deepEqual(selectPlaylistEntries(db, playlistId), [
      before[0],
      { ...before[1], source: "unsearched", song: skyfall },
    ]);
    assert.equal(selectPlaylist(db, playlistId)?.playlist.unavailableCount, 1);
    assert.deepEqual(selectUnsearchedEntries(db), [{ playlistId, songs: [skyfall] }]);

    const video: PlaylistSong<YtAlbumSong> = {
      source: "stream",
      song: {
        ...skyfall,
        videoId: "official-skyfall",
        albumId: null,
        explicit: false,
        videoType: "MUSIC_VIDEO_TYPE_OMV",
        durationMs: 300_000,
      },
    };
    settleUnsearchedEntries(db, skyfall, video, 200);
    assert.deepEqual(selectPlaylistEntries(db, playlistId)[1], {
      itemId: before[1]!.itemId,
      addedAt: 100,
      ...video,
    });
    assert.deepEqual(selectUnsearchedEntries(db), []);
  } finally {
    closeTestDatabase(db);
  }
});

test("a second miss and entries added after the upgrade stay unavailable on later starts", async () => {
  let db = await openTestDatabase({ through: "0053_playlist_graveyard" });
  try {
    const { playlistId } = createPlaylist(db, "Imported", [notFound], 100);
    await migrateTestDatabase(db);
    settleUnsearchedEntries(db, skyfall, notFound, Date.now() + 1_000);
    const later = createPlaylist(db, "New import", [notFound], Date.now() + 2_000);
    const missed = selectPlaylistEntries(db, playlistId);
    const addedLater = selectPlaylistEntries(db, later.playlistId);

    db = await reopenTestDatabase(db);
    await migrateTestDatabase(db);
    db = await reopenTestDatabase(db);

    assert.deepEqual(selectPlaylistEntries(db, playlistId), missed);
    assert.equal(missed[0]?.source, "unavailable");
    assert.deepEqual(selectPlaylistEntries(db, later.playlistId), addedLater);
    assert.deepEqual(selectUnsearchedEntries(db), []);
  } finally {
    closeTestDatabase(db);
  }
});

test("the reset syncs as a new change while removed entries and deleted playlists stay untouched", async () => {
  const db = await openTestDatabase({ through: "0053_playlist_graveyard" });
  try {
    const { playlistId } = createPlaylist(db, "Imported", [notFound], 100);
    const removed = createPlaylist(db, "Removed", [notFound], 100);
    const gone = createPlaylist(db, "Deleted", [notFound], 100);
    const itemId = selectPlaylistEntries(db, removed.playlistId)[0]!.itemId;
    removePlaylistItems(db, removed.playlistId, [itemId], 200);
    deletePlaylist(db, gone.playlistId, 200);
    const graveyard = selectPlaylistGraveyard(db, removed.playlistId);
    const before = selectUnpushed(db, 100, () => null);
    markPushed(db, [...before.marks.values()].flat());
    assert.deepEqual(selectUnpushed(db, 100, () => null).rows.playlistEntries, []);

    await migrateTestDatabase(db);

    const changes = selectUnpushed(db, 100, () => null).rows.playlistEntries;
    assert.equal(changes.length, 1);
    const changed = changes[0]!;
    const previous = before.rows.playlistEntries.find((entry) => entry.id === changed.id)!;
    assert.equal(changed.deleted, false);
    assert.equal(previous.deleted, false);
    assert.ok(changed.changedAt > previous.changedAt);
    assert.equal(changed.addedAt, 100);
    assert.equal(changed.orderKey, previous.orderKey);
    assert.deepEqual(readPlaylistEntrySong(changed.ytSong!), {
      source: "unsearched",
      song: skyfall,
    });
    assert.deepEqual(selectUnsearchedEntries(db), [{ playlistId, songs: [skyfall] }]);
    assert.deepEqual(selectPlaylistGraveyard(db, removed.playlistId), graveyard);
  } finally {
    closeTestDatabase(db);
  }
});
