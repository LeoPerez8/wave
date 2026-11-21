import assert from "node:assert/strict";
import test from "node:test";
import {
  djArtistTile,
  djAlbumTile,
  djGenreTile,
  djRestoredGrid,
  readDjGridMemory,
  storedDjGridMemory,
} from "./index.ts";

test("keeps the ordered DJ grid, including tile names and images", () => {
  const tiles = [
    djArtistTile("SZA", 7)!,
    djAlbumTile({ title: "SOS", artist: "SZA", cover: "file://sos.jpg" })!,
    djGenreTile("Rock")!,
  ];
  const stored = storedDjGridMemory(tiles);
  assert.deepEqual(readDjGridMemory(stored), tiles);
});

test("restores the remembered selection without changing a kept grid or opening rows", () => {
  const tiles = [djArtistTile("SZA")!, djGenreTile("Rock")!];
  const state = djRestoredGrid(tiles, [tiles[1]!]);
  assert.deepEqual(state.tiles, tiles);
  assert.deepEqual(state.selected, [tiles[1]!.key]);
  assert.equal(
    state.rows.some((row) => row.waiting > 0),
    false,
  );
});

test("an absent or unreadable kept grid means it has not been built yet", () => {
  assert.equal(readDjGridMemory(null), null);
  assert.equal(readDjGridMemory("not json"), null);
  assert.equal(readDjGridMemory('{"version":1,"tiles":[]}'), null);
});
