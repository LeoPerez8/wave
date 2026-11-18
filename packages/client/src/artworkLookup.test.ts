import assert from "node:assert/strict";
import { test } from "node:test";
import { findArtistPhoto, findSongCover, missingSongCover } from "./artworkLookup.ts";

const answers = (body: unknown) => (async () => Response.json(body)) as typeof globalThis.fetch;
const signal = new AbortController().signal;

test("a missing song with a video id reads its album cover when the video has no cover", async () => {
  const video = { videoId: "abcdefghijk", artworkUrl: null };
  const cover = "https://lh3.googleusercontent.com/album";
  const asked: string[] = [];
  const found = await missingSongCover(
    video,
    async (id) => {
      asked.push(id);
      return { albumId: "MPRE_album" };
    },
    async (id) => {
      asked.push(id);
      return { artworkUrl: cover };
    },
  );
  assert.equal(found, cover);
  assert.deepEqual(asked, ["abcdefghijk", "MPRE_album"]);
});

test("a cover supplied by a matched video takes no album request", async () => {
  const cover = "https://lh3.googleusercontent.com/search-result";
  const unexpected = async () => assert.fail("should use the cover already found");
  assert.equal(
    await missingSongCover({ videoId: "abcdefghijk", artworkUrl: cover }, unexpected, unexpected),
    cover,
  );
});

test("a song takes its own album's cover, never another album's", async () => {
  const song = { title: "Road", artist: "Nick Drake", album: "Pink Moon", durationMs: 120000 };
  const fetch = answers({
    data: [
      {
        id: 1,
        title: "Road",
        artist: { name: "Nick Drake" },
        album: {
          id: 10,
          title: "Compilation",
          cover_medium: "https://cdn-images.dzcdn.net/wrong.jpg",
        },
      },
      {
        id: 2,
        title: "Road",
        artist: { name: "Nick Drake" },
        album: {
          id: 20,
          title: "Pink Moon",
          cover_medium: "https://cdn-images.dzcdn.net/thumb.jpg",
          cover_xl: "https://cdn-images.dzcdn.net/large.jpg",
        },
      },
    ],
  });
  assert.deepEqual(await findSongCover(song, signal, fetch), {
    thumbUrl: "https://cdn-images.dzcdn.net/thumb.jpg",
    largeUrl: "https://cdn-images.dzcdn.net/large.jpg",
  });
  assert.equal(await findSongCover({ ...song, album: "Another album" }, signal, fetch), null);
});

test("a song without an album tag takes the cover of the album its match is on", async () => {
  const fetch = answers({
    data: [
      {
        id: 1,
        title: "Road",
        artist: { name: "Nick Drake" },
        album: { id: 10, title: "Pink Moon", cover_big: "https://cdn-images.dzcdn.net/big.jpg" },
      },
    ],
  });
  const song = { title: "Road", artist: "Nick Drake", album: null, durationMs: 0 };
  assert.deepEqual(await findSongCover(song, signal, fetch), {
    thumbUrl: "https://cdn-images.dzcdn.net/big.jpg",
    largeUrl: "https://cdn-images.dzcdn.net/big.jpg",
  });
});

test("a cover outside Deezer's image host is refused", async () => {
  const fetch = answers({
    data: [
      {
        id: 1,
        title: "Road",
        artist: { name: "Nick Drake" },
        album: { id: 10, title: "Pink Moon", cover_xl: "https://example.com/cover.jpg" },
      },
    ],
  });
  const song = { title: "Road", artist: "Nick Drake", album: "Pink Moon", durationMs: 0 };
  assert.equal(await findSongCover(song, signal, fetch), null);
});

test("an artist takes the photo of the most followed namesake, and an error is no answer", async () => {
  const fetch = answers({
    data: [
      { name: "Nick Drake", nb_fan: 3, picture_medium: "https://cdn-images.dzcdn.net/small.jpg" },
      {
        name: "Nick Drake",
        nb_fan: 900,
        picture_medium: "https://cdn-images.dzcdn.net/thumb.jpg",
        picture_xl: "https://cdn-images.dzcdn.net/large.jpg",
      },
    ],
  });
  assert.deepEqual(await findArtistPhoto("Nick Drake", "Nick Drake", signal, fetch), {
    thumbUrl: "https://cdn-images.dzcdn.net/thumb.jpg",
    largeUrl: "https://cdn-images.dzcdn.net/large.jpg",
  });
  await assert.rejects(
    findArtistPhoto("Nick Drake", "Nick Drake", signal, answers({ error: { code: 4 } })),
  );
});
