import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { geniusCandidates, pickGeniusSong } from "./index.ts";
const search = JSON.parse(
  readFileSync(new URL("./fixtures/genius/search.json", import.meta.url), "utf8"),
);
test("Genius matches Fix Song's normalized title and artist, rejecting a cover", () => {
  const hits = geniusCandidates(search);
  assert.ok(hits);
  assert.deepEqual(
    pickGeniusSong(
      {
        title: "The Imagine (Live)",
        artist: "Jóhn Lennon feat. Guest",
        album: null,
        durationMs: 0,
      },
      hits,
    ),
    {
      id: 10356,
      title: "Imagine",
      artist: "John Lennon",
      url: "https://genius.com/John-lennon-imagine-lyrics",
    },
  );
  assert.equal(
    pickGeniusSong({ title: "Other", artist: "John Lennon", album: null, durationMs: 0 }, hits),
    null,
  );
});

test("Genius reads plain descriptions, distinguishes absent text from failed replies", async () => {
  const { geniusDescription } = await import("./index.ts");
  const reply = JSON.parse(
    readFileSync(new URL("./fixtures/genius/song.json", import.meta.url), "utf8"),
  );
  assert.deepEqual(geniusDescription(reply, 10356), {
    text: "A song about imagining a peaceful world.\n\nThis is synthetic fixture text.",
  });
  reply.response.song.description = { plain: "?" };
  assert.deepEqual(geniusDescription(reply, 10356), { text: null });
  assert.equal(geniusDescription(reply, 9), null);
  assert.equal(geniusDescription({ meta: { status: 429 } }, 10356), null);
  assert.equal(geniusCandidates({ meta: { status: 401 } }), null);
  assert.deepEqual(geniusCandidates({ meta: { status: 200 }, response: { hits: [] } }), []);
});

test("saved Genius misses expire at one week while matches survive offline", async () => {
  const { savedGenius, storedGenius, GENIUS_MISS_MS } = await import("./index.ts");
  const song = { title: "Imagine", artist: "John Lennon", album: null, durationMs: 0 };
  const miss = storedGenius(song, {
    checkedAt: 100,
    match: null,
    description: null,
    referents: null,
    translations: {},
  });
  assert.deepEqual(savedGenius(miss, 100 + GENIUS_MISS_MS - 1, song), {
    checkedAt: 100,
    match: null,
    description: null,
    referents: null,
    translations: {},
  });
  assert.equal(savedGenius(miss, 100 + GENIUS_MISS_MS, song), null);
  assert.equal(savedGenius("bad", 100, song), null);
  assert.equal(savedGenius(null, 100, song), null);
  assert.equal(
    savedGenius(
      JSON.stringify({
        version: 1,
        asked: { title: "Imagine", artist: "John Lennon" },
        checkedAt: 100,
        match: { id: -1 },
        description: "bad",
      }),
      100,
      song,
    ),
    null,
  );
  const match = pickGeniusSong(song, geniusCandidates(search)!);
  const found = {
    checkedAt: 100,
    match,
    description: "About",
    referents: null,
    translations: {},
  };
  assert.deepEqual(savedGenius(storedGenius(song, found), 100 + GENIUS_MISS_MS, song), found);
});

const underPressure = (artist: string) => ({
  title: "Under Pressure",
  artist,
  album: null,
  durationMs: 0,
});

test("Genius matches a shared credit by its full artist names or its primary artist", () => {
  const hits = geniusCandidates(search)!;
  assert.equal(pickGeniusSong(underPressure("Queen & David Bowie"), hits)?.id, 2);
  assert.equal(pickGeniusSong(underPressure("Queen"), hits)?.id, 2);
  assert.equal(pickGeniusSong(underPressure("David Bowie"), hits), null);
});

test("a song's saved Genius answer stands only for the title and artist it was asked for", async () => {
  const { savedGenius, storedGenius } = await import("./index.ts");
  const song = { title: "Imagine", artist: "John Lennon", album: null, durationMs: 0 };
  const stored = storedGenius(song, {
    checkedAt: 100,
    match: null,
    description: null,
    referents: null,
    translations: {},
  });
  assert.equal(savedGenius(stored, 100, song)?.checkedAt, 100);
  assert.equal(savedGenius(stored, 100, { ...song, title: "Jealous Guy" }), null);
  assert.equal(savedGenius(stored, 100, { ...song, artist: "Yoko Ono" }), null);
});
