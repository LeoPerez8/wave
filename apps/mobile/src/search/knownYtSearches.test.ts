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
  assert.equal(keptYtSearch("Daft Punk", false), undefined);
  keepYtSearch("Daft Punk", false, answer);
  assert.deepEqual(keptYtSearch("Daft Punk", false), answer);
});

test("DJ's artists-and-albums search doesn't stand in for Search's whole answer", () => {
  keepYtSearch("Air", true, answer);
  assert.equal(keptYtSearch("Air", false), undefined);
  assert.deepEqual(keptYtSearch("Air", true), answer);
});
