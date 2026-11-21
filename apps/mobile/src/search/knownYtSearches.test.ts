import assert from "node:assert/strict";
import test from "node:test";
import { keepYtSearch, keptYtSearch } from "./knownYtSearches.ts";

const answer = {
  songs: [],
  artists: [],
  albums: [],
  videos: undefined,
  playlists: [],
};

test("a query YT Music answered this session is answered again from memory", () => {
  assert.equal(keptYtSearch("Daft Punk", "all"), undefined);
  keepYtSearch("Daft Punk", "all", answer);
  assert.deepEqual(keptYtSearch("Daft Punk", "all"), answer);
});

test("DJ's artists-and-albums search doesn't stand in for Search's whole answer", () => {
  keepYtSearch("Air", "artistsAlbums", answer);
  assert.equal(keptYtSearch("Air", "all"), undefined);
  assert.deepEqual(keptYtSearch("Air", "artistsAlbums"), answer);
});

test("Add Songs' songs-only search doesn't stand in for Search's whole answer", () => {
  keepYtSearch("Justice", "songs", answer);
  assert.equal(keptYtSearch("Justice", "all"), undefined);
  assert.equal(keptYtSearch("Justice", "artistsAlbums"), undefined);
  assert.deepEqual(keptYtSearch("Justice", "songs"), answer);
});
