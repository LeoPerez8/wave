import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import * as core from "./index.ts";

test("Deezer artist search keeps follow IDs and usable photos from a saved response", () => {
  const reply = JSON.parse(
    readFileSync(new URL("./fixtures/deezer/follow-artists.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(core.deezerFollowArtists(reply), [
    {
      name: "Daft Punk",
      deezerId: 27,
      imageUrl: "https://cdn-images.dzcdn.net/images/artist/daft/250x250.jpg",
      fans: 5900000,
    },
    { name: "Daft Punk Tribute", deezerId: 954, imageUrl: null, fans: 42 },
    { name: "No Picture", deezerId: 123, imageUrl: null, fans: 0 },
  ]);
});

test("Library matches stay first and replace Deezer duplicates, even outside the local query matches", () => {
  const library = [
    { id: 1, name: "The Beyoncé", thumbPath: "local.jpg" },
    { id: 2, name: "Daft Punk", thumbPath: null },
  ];
  const online = [
    { name: "Beyonce", deezerId: 10, imageUrl: "https://photo", fans: 100 },
    { name: "Daft Punk", deezerId: 27, imageUrl: null, fans: 50 },
    { name: "Phoenix", deezerId: 3, imageUrl: null, fans: 1000 },
    { name: "PHOENIX", deezerId: 4, imageUrl: null, fans: 1 },
  ];
  assert.deepEqual(core.mergeFollowArtistSearch(library, [library[1]!], online), [
    { key: "daft punk", name: "Daft Punk", library: library[1], deezerId: 27, imageUrl: null },
    { key: "beyonce", name: "The Beyoncé", library: library[0], deezerId: 10, imageUrl: null },
    { key: "phoenix", name: "Phoenix", library: null, deezerId: 3, imageUrl: null },
  ]);
});

test("Deezer errors differ from no matches and malformed artists cannot be followed", () => {
  assert.equal(core.deezerFollowArtists({ error: { message: "Quota" } }), null);
  assert.deepEqual(core.deezerFollowArtists({ data: [] }), []);
  assert.deepEqual(
    core.deezerFollowArtists({
      data: [
        { id: -1, name: "Invalid" },
        { id: "2", name: "Invalid" },
        { id: 3, name: " " },
        { id: 4, name: "Album", type: "album" },
      ],
    }),
    [],
  );
});
