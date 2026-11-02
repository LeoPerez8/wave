import assert from "node:assert/strict";
import { test } from "node:test";

import { sortKey, sortPlaylists, sortPlaylistsForAdd, type PlaylistSort } from "./index.ts";

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
