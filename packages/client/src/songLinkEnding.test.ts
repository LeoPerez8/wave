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

const pagePorts = (
  overrides: Partial<NonNullable<Parameters<typeof songLinkEnding>[1]["pages"]>> = {},
) => ({
  albumPlaylist: async () => {
    throw new Error("Not an album playlist");
  },
  artistPage: async () => {
    throw new Error("Not a channel");
  },
  spotifyArtist: async () => {
    throw new Error("Not a Spotify artist");
  },
  deezerArtist: async () => {
    throw new Error("Not a Deezer artist");
  },
  searchArtists: async () => null,
  ...overrides,
});

const radiohead = { name: "Radiohead", browseId: "UCq19-LqvG35A-30oyAiPiqA", audience: 9 };

test("a YT Music album link opens its page, with nothing asked", async () => {
  const ending = await songLinkEnding(
    { service: "ytAlbum", browseId: "MPREb_06zfD9zt7QK" },
    albumPorts({ pages: pagePorts() }),
    new AbortController().signal,
  );
  assert.deepEqual(ending, { album: "MPREb_06zfD9zt7QK", read: null });
});

test("a YT Music album playlist opens the album its songs name", async () => {
  const asked: string[] = [];
  const ending = await songLinkEnding(
    { service: "ytAlbumPlaylist", playlistId: "OLAK5uy_pink" },
    albumPorts({
      pages: pagePorts({
        albumPlaylist: async (id) => {
          asked.push(id);
          return {
            ok: true,
            playlist: {
              title: "Pink Moon",
              author: "Nick Drake",
              artworkUrl: null,
              songs: [{ albumId: "MPREb_06zfD9zt7QK" }],
            },
          };
        },
      }),
    }),
    new AbortController().signal,
  );
  assert.deepEqual(asked, ["OLAK5uy_pink"]);
  assert.deepEqual(ending, {
    album: "MPREb_06zfD9zt7QK",
    read: { title: "Pink Moon", artists: ["Nick Drake"], artworkUrl: null },
  });
});

test("a channel link opens the artist YT Music reads it as", async () => {
  const ending = await songLinkEnding(
    { service: "ytArtist", channelId: "UCiryJZISyBldwm9ocAE-QfQ" },
    albumPorts({
      pages: pagePorts({ artistPage: async () => ({ ok: true, name: "Nick Drake" }) }),
    }),
    new AbortController().signal,
  );
  assert.deepEqual(ending, { artist: "UCiryJZISyBldwm9ocAE-QfQ", name: "Nick Drake" });
});

test("a Spotify artist link searches YT Music for the name Spotify gives", async () => {
  const searched: string[] = [];
  const ending = await songLinkEnding(
    { service: "spotifyArtist", artistId: "4Z8W4fKeB5YxbusRsdQVPb" },
    albumPorts({
      pages: pagePorts({
        spotifyArtist: async () => ({ ok: true, name: "Radiohead" }),
        searchArtists: async (query) => {
          searched.push(query);
          return [radiohead];
        },
      }),
    }),
    new AbortController().signal,
  );
  assert.deepEqual(searched, ["Radiohead"]);
  assert.deepEqual(ending, { artist: radiohead.browseId, name: "Radiohead" });
});

test("a Deezer short link that lands on an artist opens the matching artist", async () => {
  const ending = await songLinkEnding(
    { service: "deezerShort", url: "https://link.deezer.com/s/abc" },
    albumPorts({
      follow: async () => ({ url: "https://www.deezer.com/br/artist/399", body: "" }),
      pages: pagePorts({
        deezerArtist: async () => ({ ok: true, name: "Radiohead" }),
        searchArtists: async () => [radiohead],
      }),
    }),
    new AbortController().signal,
  );
  assert.deepEqual(ending, { artist: radiohead.browseId, name: "Radiohead" });
});

test("an artist Deezer doesn't have says so in artist words", async () => {
  const ending = await songLinkEnding(
    { service: "deezerArtist", artistId: "399" },
    albumPorts({
      pages: pagePorts({ deezerArtist: async () => ({ ok: false, reason: "missing" }) }),
    }),
    new AbortController().signal,
  );
  assert.deepEqual(ending, {
    play: "failed",
    failure: { unread: "missing", service: "deezer", artist: true },
  });
});

test("an artist link where the platform reads no pages can't be opened", async () => {
  const ending = await songLinkEnding(
    { service: "spotifyArtist", artistId: "4Z8W4fKeB5YxbusRsdQVPb" },
    albumPorts(),
    new AbortController().signal,
  );
  assert.deepEqual(ending, { play: "failed", failure: "cantOpen" });
});
