import assert from "node:assert/strict";
import { test } from "node:test";
import { createLookups } from "./lookups.ts";

const song = {
  title: "Águas de Março",
  artist: "Elis Regina",
  album: "Elis & Tom",
  durationMs: 212_000,
};

const answering = (pages: Record<string, unknown>) => {
  const asked: string[] = [];
  const fetch = (async (url: string) => {
    asked.push(url);
    const host = new URL(url).hostname;
    const path = new URL(url).pathname;
    const body = pages[`${host}${path}`];
    return body === undefined
      ? new Response("no", { status: 500 })
      : new Response(JSON.stringify(body), { status: 200 });
  }) as typeof globalThis.fetch;
  return { fetch, asked };
};

test("a song's lyrics come from LRCLIB and its genre, year and number from Deezer", async () => {
  const { fetch } = answering({
    "lrclib.net/api/search": [
      {
        trackName: "Águas de Março",
        artistName: "Elis Regina",
        albumName: "Elis & Tom",
        duration: 212,
        syncedLyrics: "[00:01.00] É pau",
      },
    ],
    "api.deezer.com/search/track": {
      data: [
        {
          id: 7,
          title: "Águas de Março",
          duration: 212,
          explicit_lyrics: false,
          artist: { name: "Elis Regina" },
          album: { id: 70, title: "Elis & Tom" },
        },
      ],
    },
    "api.deezer.com/album/70": {
      id: 70,
      genres: { data: [{ name: "MPB" }] },
      release_date: "1974-01-01",
    },
    "api.deezer.com/album/70/tracks": { data: [{ id: 7, track_position: 1, disk_number: 1 }] },
  });
  const found = await createLookups(fetch).lookUp(song);
  assert.equal(found?.lyrics?.text, "[00:01.00] É pau");
  assert.equal(found?.lyrics?.synced, true);
  assert.equal(found?.genre, "MPB");
  assert.equal(found?.year, 1974);
  assert.equal(found?.trackNumber, 1);
  assert.equal(found?.explicit, "clean");
});

test("a song that has everything asks nothing, and no service answering is null", async () => {
  const { fetch, asked } = answering({});
  const lookups = createLookups(fetch);
  const has = {
    hasLyrics: true,
    genre: "MPB",
    trackNumber: 1,
    year: 1974,
    explicit: "clean" as const,
  };
  assert.equal((await lookups.lookUp(song, has))?.lyrics ?? null, null);
  assert.deepEqual(asked, []);
  assert.equal(await lookups.lookUp(song), null);
});
