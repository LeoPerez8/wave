import assert from "node:assert/strict";
import { test } from "node:test";
import { EMPTY_SYNC_TABLES, readPullPage } from "@wave/core";
import {
  createPlaylist,
  removePlaylistItems,
  restorePlaylistItems,
  selectPlaylistEntries,
  selectPlaylistGraveyard,
} from "./playlists.ts";
import { applyPulledPage, selectUnpushed } from "./syncRows.ts";
import { openTestDatabase } from "./testDatabase.ts";

test("a new phone receives removed songs and later receives their undo", async () => {
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
  const removal = removePlaylistItems(phone, playlistId, [entry.itemId], 200);
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
  restorePlaylistItems(phone, removal, 400);
  send(500);
  assert.deepEqual(selectPlaylistGraveyard(other, 1), []);
  assert.equal(selectPlaylistEntries(other, 1).length, 1);
});
