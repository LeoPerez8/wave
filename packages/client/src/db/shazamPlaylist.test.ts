/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  addToShazam,
  createPlaylist,
  deletePlaylist,
  renamePlaylist,
  movePlaylistItem,
  selectPlaylistEntries,
  selectPlaylists,
} from "./playlists.ts";
import { addTrack, openTestDatabase } from "./testDatabase.ts";

test("Add to Shazam creates an ordinary playlist and inserts newer songs at the top", async () => {
  const db = await openTestDatabase();
  const first = addTrack(db, { title: "First", artist: "Artist", album: "Album" });
  const next = addTrack(db, { title: "Next", artist: "Artist", album: "Album" });
  const saved = addToShazam(db, null, { source: "library", trackId: first }, 1000);
  assert.equal(saved.toast, "Added to Shazam");
  assert.equal(selectPlaylists(db)[0]?.name, "Shazam");
  const added = addToShazam(db, saved.syncId, { source: "library", trackId: next }, 2000);
  assert.equal(added.playlistId, saved.playlistId);
  assert.deepEqual(
    selectPlaylistEntries(db, saved.playlistId).map((entry) =>
      entry.source === "library" ? entry.track.title : entry.song.title,
    ),
    ["Next", "First"],
  );
});

test("a duplicate stays in its place, rename keeps the target, and deletion creates a new target", async () => {
  const db = await openTestDatabase();
  const song = {
    title: "First",
    artists: ["Artist"],
    album: null,
    durationMs: null,
    artworkUrl: "https://cover",
  };
  const saved = addToShazam(db, null, { source: "unsearched", song }, 1000);
  addToShazam(
    db,
    saved.syncId,
    { source: "unavailable", song: { ...song, title: "Next", reason: "notFound" } },
    2000,
  );
  renamePlaylist(db, saved.playlistId, "Found songs", 3000);
  const duplicate = addToShazam(
    db,
    saved.syncId,
    { source: "unavailable", song: { ...song, album: "Changed album", reason: "notFound" } },
    4000,
  );
  assert.equal(duplicate.toast, "Already in Shazam");
  assert.equal(duplicate.syncId, saved.syncId);
  assert.deepEqual(
    selectPlaylistEntries(db, saved.playlistId).map((entry) =>
      entry.source === "library" ? entry.track.title : entry.song.title,
    ),
    ["Next", "First"],
  );
  const first = selectPlaylistEntries(db, saved.playlistId)[1]!;
  movePlaylistItem(db, saved.playlistId, first.itemId, 0, 5000);
  assert.equal(selectPlaylistEntries(db, saved.playlistId)[0]?.itemId, first.itemId);
  deletePlaylist(db, saved.playlistId, 6000);
  const recreated = addToShazam(db, saved.syncId, { source: "unsearched", song }, 7000);
  assert.notEqual(recreated.syncId, saved.syncId);
  assert.deepEqual(
    selectPlaylists(db).map((playlist) => playlist.name),
    ["Shazam"],
  );
});

test("a user playlist named Shazam is never taken over", async () => {
  const db = await openTestDatabase();
  const own = createPlaylist(db, "Shazam", [], 1000);
  const trackId = addTrack(db, { title: "Heard", artist: "Artist", album: "Album" });
  const saved = addToShazam(db, null, { source: "library", trackId }, 2000);
  assert.notEqual(saved.playlistId, own.playlistId);
  assert.deepEqual(selectPlaylistEntries(db, own.playlistId), []);
  assert.deepEqual(
    selectPlaylists(db)
      .map((playlist) => playlist.name)
      .toSorted(),
    ["Shazam", "Shazam 2"],
  );
});
