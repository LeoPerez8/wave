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

test("the follow search says it is searching, that Deezer didn't answer, or that nothing matched", () => {
  const strings = core.catalogueOf("en").followArtistSearch;
  const line = (state: Parameters<typeof core.followSearchLine>[0]) =>
    core.followSearchLine(state, strings);
  assert.equal(line({ query: "  ", pending: true, failed: false, results: 0 }), null);
  assert.equal(
    line({ query: "daft", pending: true, failed: false, results: 1 }),
    "Searching Deezer…",
  );
  // No answer keeps the Library's matches and says so; it is never "No artists found."
  assert.equal(
    line({ query: "daft", pending: false, failed: true, results: 0 }),
    "Couldn't reach Deezer. Library results are still available.",
  );
  assert.equal(
    line({ query: "daft", pending: false, failed: false, results: 0 }),
    "No artists found.",
  );
  assert.equal(line({ query: "daft", pending: false, failed: false, results: 2 }), null);
});

test("a show country is one of ISO 3166's two-letter codes", () => {
  assert.equal(core.SHOW_COUNTRY_CODES.length, 249);
  assert.equal(new Set(core.SHOW_COUNTRY_CODES).size, 249);
  assert.equal(core.isShowCountry("BR"), true);
  assert.equal(core.isShowCountry("br"), false);
  assert.equal(core.isShowCountry("ZZ"), false);
  assert.equal(core.isShowCountry(null), false);
});

test("the desktop's Country row names the computer's region, not a phone's", () => {
  assert.equal(core.catalogueOf("en", "desktop").shows.phoneRegion, "This computer's region");
  assert.equal(core.catalogueOf("pt-BR", "desktop").shows.phoneRegion, "Região deste computador");
  assert.equal(core.catalogueOf("en").shows.phoneRegion, "Phone's region");
});
