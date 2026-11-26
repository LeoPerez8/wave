import assert from "node:assert/strict";
import { test } from "node:test";
import { lookUpDeezerArtistGenre } from "./index.ts";

test("a genre lookup resolves the artist by name and samples their release genres", async () => {
  const urls: string[] = [];
  const replies = [
    {
      data: [
        { id: 10, name: "The Rock Band", nb_fan: 10 },
        { id: 20, name: "Cover Band", nb_fan: 999 },
      ],
    },
    { data: [{ id: 100 }, { id: 200 }, { id: 300 }, { id: 400 }] },
    { id: 100, genres: { data: [{ name: "Rock" }] } },
    { id: 200, genres: { data: [{ name: "Hard Rock" }] } },
    { id: 300, genres: { data: [{ name: "Pop" }] } },
  ];
  const profile = await lookUpDeezerArtistGenre("The Rock Band", async (url) => {
    urls.push(url);
    return replies.shift();
  });
  assert.deepEqual(
    profile,
    new Map([
      ["rock", 2 / 3],
      ["pop", 1 / 3],
    ]),
  );
  assert.equal(new URL(urls[0]!).searchParams.get("q"), "The Rock Band");
  assert.deepEqual(
    urls.slice(1).map((url) => new URL(url).pathname),
    ["/artist/10/albums", "/album/100", "/album/200", "/album/300"],
  );
});

test("an empty artist search is a cacheable miss, while a quota reply fails", async () => {
  assert.equal(await lookUpDeezerArtistGenre("Unknown", async () => ({ data: [] })), null);
  await assert.rejects(
    lookUpDeezerArtistGenre("Unknown", async () => ({ error: { code: 4 } })),
    /Invalid Deezer artist response/,
  );
});
