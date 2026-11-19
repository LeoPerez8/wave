import assert from "node:assert/strict";
import { test } from "node:test";
import { tableColumns } from "./tableColumns.ts";

test("song lists show the thumbnail, artist, album, star and time", () => {
  for (const kind of ["songs", "favorites", "playlist", "genre", "artist", "search"] as const)
    assert.deepEqual(tableColumns(kind), {
      picture: "artwork",
      second: "artist",
      third: "album",
      star: true,
    });
});

test("an album's own page shows the track number and no Album column", () => {
  assert.deepEqual(tableColumns("album"), {
    picture: "trackNumber",
    second: "artist",
    third: null,
    star: true,
  });
});

test("the Albums table names each album's artist, with no star column", () => {
  assert.deepEqual(tableColumns("albums"), {
    picture: "artwork",
    second: "songs",
    third: "artist",
    star: false,
  });
});

test("Artists, Genres and Playlists have no Artist or star column", () => {
  for (const kind of ["artists", "genres", "playlists"] as const)
    assert.deepEqual(tableColumns(kind), {
      picture: "artwork",
      second: "songs",
      third: null,
      star: false,
    });
});
