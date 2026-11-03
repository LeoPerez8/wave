import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_SYNC_TABLES, readPullPage } from "@wave/core";
import {
  createPlaylist,
  appendPlaylistSongs,
  forgetGraveyardItems,
  replacePlaylistSongs,
  removePlaylistItems,
  restoreGraveyardItem,
  selectPlaylistEntries,
  selectPlaylistGraveyard,
} from "./playlists.ts";
import { applyPulledPage, selectUnpushed } from "./syncRows.ts";
import { addTrack, openTestDatabase } from "./testDatabase.ts";

test("a new phone receives removed songs and later receives their Graveyard restore", async () => {
  const phone = await openTestDatabase();
  const other = await openTestDatabase();
  const { playlistId } = createPlaylist(
    phone,
    "Drive",
    [
      {
        source: "unavailable",
        song: {
          title: "Lost",
          artists: ["Radiohead"],
          album: null,
          durationMs: null,
          artworkUrl: null,
          reason: "notFound",
        },
      },
    ],
    100,
  );
  const entry = selectPlaylistEntries(phone, playlistId)[0]!;
  removePlaylistItems(phone, playlistId, [entry.itemId], 200);
  const send = (now: number) => {
    const changes = selectUnpushed(phone, 100, () => null).rows;
    const page = readPullPage(
      JSON.stringify({ ...EMPTY_SYNC_TABLES, ...changes, cursor: String(now), more: false }),
    );
    assert.ok(page);
    applyPulledPage(other, page, new Map(), now);
  };
  send(300);
  assert.equal(selectPlaylistEntries(other, 1).length, 0);
  assert.deepEqual(
    selectPlaylistGraveyard(other, 1).map((e) => [e.source, e.removedAt]),
    [["unavailable", 200]],
  );
  restoreGraveyardItem(phone, playlistId, entry.itemId, 400);
  send(500);
  assert.deepEqual(selectPlaylistGraveyard(other, 1), []);
  assert.equal(selectPlaylistEntries(other, 1).length, 1);
});

const listed = (title: string) => ({
  source: "unavailable" as const,
  song: {
    title,
    artists: ["Radiohead"],
    album: null,
    durationMs: null,
    artworkUrl: null,
    reason: "notFound" as const,
  },
});

test("Restore brings a removed song back between its surviving neighbours", async () => {
  const db = await openTestDatabase();
  const { playlistId } = createPlaylist(db, "Drive", [listed("A"), listed("B"), listed("C")], 100);
  const itemId = selectPlaylistEntries(db, playlistId)[1]!.itemId;
  removePlaylistItems(db, playlistId, [itemId], 200);
  restoreGraveyardItem(db, playlistId, itemId, 300);
  assert.deepEqual(
    selectPlaylistEntries(db, playlistId).map((e) => e.source === "unavailable" && e.song.title),
    ["A", "B", "C"],
  );
  assert.deepEqual(selectPlaylistGraveyard(db, playlistId), []);
});

test("Restore appends when the old playlist positions have gone", async () => {
  const db = await openTestDatabase();
  const { playlistId } = createPlaylist(db, "Drive", [listed("A"), listed("B"), listed("C")], 100);
  const itemId = selectPlaylistEntries(db, playlistId)[1]!.itemId;
  removePlaylistItems(db, playlistId, [itemId], 200);
  replacePlaylistSongs(db, playlistId, [listed("D"), listed("E"), listed("F"), listed("G")], 300);
  restoreGraveyardItem(db, playlistId, itemId, 400);
  assert.deepEqual(
    selectPlaylistEntries(db, playlistId).map((e) => e.source === "unavailable" && e.song.title),
    ["D", "E", "F", "G", "B"],
  );
});

test("forgetting a song never reveals an older removal or changes the playlist, and syncs", async () => {
  const db = await openTestDatabase();
  const other = await openTestDatabase();
  const { playlistId } = createPlaylist(db, "Drive", [listed("A"), listed("B")], 100);
  const first = selectPlaylistEntries(db, playlistId)[0]!;
  removePlaylistItems(db, playlistId, [first.itemId], 200);
  appendPlaylistSongs(db, playlistId, [listed("A")], 300);
  const again = selectPlaylistEntries(db, playlistId)[1]!;
  removePlaylistItems(db, playlistId, [again.itemId], 400);
  const before = selectPlaylistEntries(db, playlistId);
  const removedPage = readPullPage(
    JSON.stringify({
      ...EMPTY_SYNC_TABLES,
      ...selectUnpushed(db, 100, () => null).rows,
      cursor: "450",
      more: false,
    }),
  );
  assert.ok(removedPage);
  applyPulledPage(other, removedPage, new Map(), 450);
  assert.equal(selectPlaylistGraveyard(other, 1).length, 1);
  forgetGraveyardItems(db, playlistId, again.itemId, 500);
  assert.deepEqual(selectPlaylistEntries(db, playlistId), before);
  assert.deepEqual(selectPlaylistGraveyard(db, playlistId), []);
  const page = readPullPage(
    JSON.stringify({
      ...EMPTY_SYNC_TABLES,
      ...selectUnpushed(db, 100, () => null).rows,
      cursor: "600",
      more: false,
    }),
  );
  assert.ok(page);
  applyPulledPage(other, page, new Map(), 600);
  assert.deepEqual(selectPlaylistGraveyard(other, 1), []);
  assert.equal(selectPlaylistEntries(other, 1).length, 1);
});

test("Empty Graveyard forgets all removals without changing either playlist", async () => {
  const db = await openTestDatabase();
  const { playlistId } = createPlaylist(db, "Drive", [listed("A"), listed("B"), listed("C")], 100);
  const { playlistId: otherId } = createPlaylist(db, "Other", [listed("D")], 100);
  removePlaylistItems(
    db,
    playlistId,
    selectPlaylistEntries(db, playlistId)
      .slice(0, 2)
      .map((e) => e.itemId),
    200,
  );
  removePlaylistItems(
    db,
    otherId,
    selectPlaylistEntries(db, otherId).map((e) => e.itemId),
    200,
  );
  const before = selectPlaylistEntries(db, playlistId);
  forgetGraveyardItems(db, playlistId, undefined, 300);
  assert.deepEqual(selectPlaylistGraveyard(db, playlistId), []);
  assert.deepEqual(selectPlaylistEntries(db, playlistId), before);
  assert.equal(selectPlaylistGraveyard(db, otherId).length, 1);
});

test("forgetting a later imported removal also forgets its earlier Library recording", async () => {
  const db = await openTestDatabase();
  const trackId = addTrack(db, { title: "A", artist: "Radiohead" });
  const { playlistId } = createPlaylist(db, "Drive", [{ source: "library", trackId }], 100);
  removePlaylistItems(
    db,
    playlistId,
    selectPlaylistEntries(db, playlistId).map((e) => e.itemId),
    200,
  );
  appendPlaylistSongs(db, playlistId, [listed("A")], 300);
  removePlaylistItems(
    db,
    playlistId,
    selectPlaylistEntries(db, playlistId).map((e) => e.itemId),
    400,
  );
  const entry = selectPlaylistGraveyard(db, playlistId)[0]!;
  forgetGraveyardItems(db, playlistId, entry.itemId, 500);
  assert.deepEqual(selectPlaylistGraveyard(db, playlistId), []);
});

test("Restore appends when both old neighbours are removed even if other songs survive", async () => {
  const db = await openTestDatabase();
  const { playlistId } = createPlaylist(
    db,
    "Drive",
    [listed("A"), listed("B"), listed("C"), listed("D")],
    100,
  );
  const [a, b, c] = selectPlaylistEntries(db, playlistId);
  removePlaylistItems(db, playlistId, [b!.itemId], 200);
  removePlaylistItems(db, playlistId, [a!.itemId, c!.itemId], 300);
  restoreGraveyardItem(db, playlistId, b!.itemId, 400);
  assert.deepEqual(
    selectPlaylistEntries(db, playlistId).map((e) => e.source === "unavailable" && e.song.title),
    ["D", "B"],
  );
});
