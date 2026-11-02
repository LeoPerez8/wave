import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createPlaylistPickerSearch,
  keepAddToPlaylistOrder,
  sortKey,
  sortPlaylists,
  sortPlaylistsForAdd,
  type PlaylistSort,
} from "./index.ts";

const playlist = (
  id: number,
  name: string,
  createdAt: number,
  lastEntryAddedAt: number | null,
) => ({
  id,
  name,
  sort: sortKey(name),
  createdAt,
  lastEntryAddedAt,
});

test("an open card keeps its ranks through additions and renames, with live names and counts", () => {
  const rows = [
    { ...playlist(1, "Ambient", 10, 20), trackCount: 1 },
    { ...playlist(2, "Road Trip", 5, 30), trackCount: 2 },
  ];
  const opened = keepAddToPlaylistOrder(rows, []);
  assert.deepEqual(
    opened.map((row) => row.id),
    [2, 1],
  );
  const updated = [
    { ...rows[0]!, name: "Z Ambient", lastEntryAddedAt: 100, trackCount: 3 },
    rows[1]!,
  ];
  const shown = keepAddToPlaylistOrder(updated, opened);
  assert.deepEqual(
    shown.map((row) => [row.id, row.name, row.trackCount]),
    [
      [2, "Road Trip", 2],
      [1, "Z Ambient", 3],
    ],
  );
  assert.equal(shown[1], updated[0]);
  assert.deepEqual(
    keepAddToPlaylistOrder(updated, []).map((row) => row.id),
    [1, 2],
  );
});

test("new playlists go first, deleted ones leave, and search keeps the card's ranks", () => {
  const rows = [playlist(1, "Morning", 0, 10), playlist(2, "Morning drive", 0, 20)];
  const opened = keepAddToPlaylistOrder(rows, []);
  const withNew = keepAddToPlaylistOrder(
    [...rows, playlist(3, "Morning synced", 0, 1), playlist(4, "Morning new", 30, null)],
    opened,
  );
  assert.deepEqual(
    withNew.map((row) => row.id),
    [4, 3, 2, 1],
  );
  const afterRemoval = keepAddToPlaylistOrder(
    withNew.filter((row) => row.id !== 2),
    withNew,
  );
  assert.deepEqual(
    afterRemoval.map((row) => row.id),
    [4, 3, 1],
  );
  assert.deepEqual(
    createPlaylistPickerSearch(afterRemoval)
      .show("morning")
      .playlists.map((row) => row.id),
    [4, 3, 1],
  );
  const returned = keepAddToPlaylistOrder(rows, afterRemoval);
  assert.deepEqual(
    returned.map((row) => row.id),
    [2, 1],
  );
});

test("Add to Playlist puts the playlist with the newest remaining addition first", () => {
  const rows = [playlist(1, "Ambient", 10, 20), playlist(2, "Road Trip", 5, 30)];
  assert.deepEqual(
    sortPlaylistsForAdd(rows).map((row) => row.name),
    ["Road Trip", "Ambient"],
  );
  assert.deepEqual(
    rows.map((row) => row.name),
    ["Ambient", "Road Trip"],
  );
});

test("empty playlists use creation, date ties use Library name order, and zero is an entry date", () => {
  const rows = [
    playlist(1, "Road Trip", 90, 0),
    playlist(2, "The Chill", 5, 20),
    playlist(3, "ambient", 10, 20),
    playlist(4, "New", 30, null),
  ];
  assert.deepEqual(
    sortPlaylistsForAdd(rows).map((row) => row.name),
    ["New", "ambient", "The Chill", "Road Trip"],
  );
});

test("the card's order leaves every Library sort and its source rows unchanged", () => {
  const rows = [
    playlist(1, "Ambient", 10, 40),
    playlist(2, "Chill", 30, 0),
    playlist(3, "Road Trip", 20, 50),
  ];
  const expected: Record<PlaylistSort, number[]> = {
    name: [1, 2, 3],
    added: [2, 3, 1],
    played: [2, 1, 3],
    custom: [3, 1, 2],
  };
  sortPlaylistsForAdd(rows);
  for (const sort of ["name", "added", "played", "custom"] as const) {
    assert.deepEqual(
      sortPlaylists(rows, {
        sort,
        order: [3, 1, 2],
        lastPlayed: new Map([[2, 60]]),
      }).map((row) => row.id),
      expected[sort],
    );
  }
});
