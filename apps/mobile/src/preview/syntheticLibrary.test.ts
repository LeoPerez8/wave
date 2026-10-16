/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { LONG_TITLE_TRACK_ID, SYNTHETIC_ALBUMS, SYNTHETIC_TRACKS } from "./syntheticLibrary.ts";

const ids = (keep: (track: (typeof SYNTHETIC_TRACKS)[number]) => boolean) =>
  SYNTHETIC_TRACKS.filter(keep).map(({ track }) => track.id);

describe("The synthetic library's long-titled song", () => {
  test("leaves the other songs playing, missing and favorite as they were before it", () => {
    // As the Design preview drew them before the long-titled song was added.
    assert.deepEqual(
      ids((track) => track.state === "playing"),
      ["album-41-3"],
    );
    assert.deepEqual(
      ids((track) => track.state === "missing"),
      ["album-27-7"],
    );
    const favorites = ids((track) => track.favorite);
    assert.equal(favorites.length, 52);
    assert.deepEqual(favorites.slice(0, 5), [
      "album-8-7",
      "album-2-1",
      "album-24-10",
      "album-25-6",
      "album-27-1",
    ]);
  });

  test("is a plain song: not playing, not missing, not a favorite", () => {
    const long = SYNTHETIC_TRACKS.find(({ track }) => track.id === LONG_TITLE_TRACK_ID);
    assert.equal(long?.state, undefined);
    assert.equal(long?.favorite, false);
  });

  test("counts in its album's songs, as every song does", () => {
    // Every song's id starts with its album's.
    assert.ok(SYNTHETIC_ALBUMS.some((album) => LONG_TITLE_TRACK_ID.startsWith(`${album.id}-`)));
    for (const album of SYNTHETIC_ALBUMS) {
      const songs = SYNTHETIC_TRACKS.filter(({ track }) => track.id.startsWith(`${album.id}-`));
      assert.equal(album.trackCount, songs.length, album.id);
    }
    assert.equal(SYNTHETIC_TRACKS.length, 465);
  });
});
