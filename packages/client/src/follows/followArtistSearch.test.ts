import assert from "node:assert/strict";
import { test } from "node:test";
import { askFollowArtists } from "./followArtistSearch.ts";

const answering = (status: number, body: unknown) => {
  const asked: string[] = [];
  const fetch = (async (url: string) => {
    asked.push(url);
    return new Response(JSON.stringify(body), { status });
  }) as unknown as typeof globalThis.fetch;
  return { asked, fetch };
};
const signal = new AbortController().signal;

test("Find artists to follow asks Deezer for the artists by name", async () => {
  const { asked, fetch } = answering(200, {
    data: [{ id: 27, name: "Daft Punk", type: "artist", nb_fan: 5 }],
  });
  assert.deepEqual(await askFollowArtists(fetch, "daft punk", signal), [
    { name: "Daft Punk", deezerId: 27, imageUrl: null, fans: 5 },
  ]);
  assert.deepEqual(asked, ["https://api.deezer.com/search/artist?q=daft%20punk&limit=10"]);
});

test("no answer from Deezer is told apart from an answer with no artists", async () => {
  assert.deepEqual(await askFollowArtists(answering(200, { data: [] }).fetch, "zzz", signal), []);
  assert.equal(await askFollowArtists(answering(503, { data: [] }).fetch, "zzz", signal), null);
  assert.equal(await askFollowArtists(answering(200, { error: {} }).fetch, "zzz", signal), null);
  const offline = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof globalThis.fetch;
  assert.equal(await askFollowArtists(offline, "zzz", signal), null);
});
