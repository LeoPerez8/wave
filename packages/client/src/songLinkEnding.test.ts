import assert from "node:assert/strict";
import { test } from "node:test";
import { songLinkEnding } from "./songLinkEnding.ts";

test("a linked video already in the Library plays its file without a network lookup", async () => {
  const track = { id: 7, title: "Pink Moon", path: "/music/pink.flac" };
  const ending = await songLinkEnding(
    { service: "ytMusic", videoId: "abcdefghijk" },
    {
      stored: async () => track,
      find: async () => () => null,
      radio: async () => {
        throw new Error("Must not request a stored song");
      },
      search: async () => null,
      spotify: async () => {
        throw new Error("Not Spotify");
      },
      deezer: async () => {
        throw new Error("Not Deezer");
      },
      follow: async () => {
        throw new Error("Not a short link");
      },
    },
    new AbortController().signal,
  );
  assert.equal("play" in ending && ending.play, "magicQueue");
  assert.equal("from" in ending && ending.from, "library");
  assert.equal("track" in ending && ending.track, track);
});

test("a Spotify short playlist link opens its import instead of looking for a song", async () => {
  const ending = await songLinkEnding(
    { service: "spotifyShort", url: "https://spotify.link/abc" },
    {
      stored: async () => null,
      find: async () => () => null,
      radio: async () => null,
      search: async () => null,
      spotify: async () => {
        throw new Error("A playlist must not read a track");
      },
      deezer: async () => {
        throw new Error("Not Deezer");
      },
      follow: async () => ({
        url: "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
        body: "",
      }),
    },
    new AbortController().signal,
  );
  assert.deepEqual(ending, {
    playlist: { service: "spotify", playlistId: "37i9dQZF1DXcBWIGoYBM5M" },
  });
});
