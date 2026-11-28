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
      spotifyAlbum: async () => {
        throw new Error("Not an album");
      },
      searchAlbums: async () => null,
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
      spotifyAlbum: async () => {
        throw new Error("Not an album");
      },
      searchAlbums: async () => null,
    },
    new AbortController().signal,
  );
  assert.deepEqual(ending, {
    playlist: { service: "spotify", playlistId: "37i9dQZF1DXcBWIGoYBM5M" },
  });
});

const albumPorts = (overrides: Partial<Parameters<typeof songLinkEnding>[1]> = {}) => ({
  stored: async () => null,
  find: async () => () => null,
  radio: async () => null,
  search: async () => null,
  spotify: async () => {
    throw new Error("An album must not read a track");
  },
  deezer: async () => {
    throw new Error("Not Deezer");
  },
  follow: async () => {
    throw new Error("Not a short link");
  },
  spotifyAlbum: async () => ({
    ok: true as const,
    album: { title: "excapecore.", artists: ["excape."], artworkUrl: null },
  }),
  searchAlbums: async () => [
    { title: "excapecore.", artists: ["excape."], browseId: "MPREb_excapecore" },
  ],
  ...overrides,
});

test("a Spotify album link opens the same album on YT Music", async () => {
  const asked: string[] = [];
  const ending = await songLinkEnding(
    { service: "spotifyAlbum", albumId: "7rZmgT2kEqkCMR6VHcloJM" },
    albumPorts({
      spotifyAlbum: async (id) => {
        asked.push(id);
        return {
          ok: true,
          album: { title: "excapecore.", artists: ["excape."], artworkUrl: null },
        };
      },
    }),
    new AbortController().signal,
  );
  assert.deepEqual(asked, ["7rZmgT2kEqkCMR6VHcloJM"]);
  assert.deepEqual(ending, {
    album: "MPREb_excapecore",
    read: { title: "excapecore.", artists: ["excape."], artworkUrl: null },
  });
});

test("a Spotify short link that lands on an album opens it", async () => {
  const ending = await songLinkEnding(
    { service: "spotifyShort", url: "https://spotify.link/abc" },
    albumPorts({
      follow: async () => ({
        url: "https://open.spotify.com/album/7rZmgT2kEqkCMR6VHcloJM",
        body: "",
      }),
    }),
    new AbortController().signal,
  );
  assert.deepEqual(ending, {
    album: "MPREb_excapecore",
    read: { title: "excapecore.", artists: ["excape."], artworkUrl: null },
  });
});

test("an album Spotify doesn't have says so in album words", async () => {
  const ending = await songLinkEnding(
    { service: "spotifyAlbum", albumId: "7rZmgT2kEqkCMR6VHcloJM" },
    albumPorts({ spotifyAlbum: async () => ({ ok: false, reason: "missing" }) }),
    new AbortController().signal,
  );
  assert.deepEqual(ending, {
    play: "failed",
    failure: { unread: "missing", service: "spotify", album: true },
  });
});
