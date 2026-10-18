import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  planYtLibraryImport,
  readSpotifyAccountPlaylist,
  readSpotifyLibrary,
  spotifyLibraryFailure,
  type SpotifyAccountRequest,
  spotifyLibraryPicker,
  ytLibraryPickerView,
  type SpotifyLibraryPlaylist,
  SPOTIFY_LIKED_SONGS_SOURCE,
  type SpotifyAccountAnswer,
} from "./index.ts";

/** A `libraryV3` entry for a playlist, as the web player's parser reads it. */
const playlistEntry = (id: string, name: string, fields: Record<string, unknown> = {}) => ({
  item: {
    __typename: "PlaylistResponseWrapper",
    _uri: `spotify:playlist:${id}`,
    data: {
      __typename: "Playlist",
      uri: `spotify:playlist:${id}`,
      name,
      revisionId: "AAAA",
      images: { items: [{ sources: [{ url: `https://i.scdn.co/image/${id}` }] }] },
      ownerV2: { data: { username: "owner" } },
      ...fields,
    },
  },
});

const likedEntry = {
  item: {
    __typename: "LibraryPseudoPlaylistResponseWrapper",
    _uri: "spotify:user:owner:collection",
    data: {
      __typename: "PseudoPlaylist",
      uri: "spotify:user:owner:collection",
      name: "Liked Songs",
      count: 1834,
      image: { sources: [{ url: "https://misc.scdn.co/liked-songs.png" }] },
    },
  },
};

const folderEntry = {
  item: {
    __typename: "LibraryFolderResponseWrapper",
    _uri: "spotify:user:owner:folder:abc",
    data: { __typename: "Folder", name: "Old stuff" },
  },
};

const libraryPage = (items: readonly unknown[], totalCount: number, offset: number) => ({
  me: {
    libraryV3: {
      __typename: "LibraryPage",
      items,
      totalCount,
      pagingInfo: { offset, limit: 50 },
    },
  },
});

/** Answers each offset with the page in [pages] that starts there. */
const asking = (pages: Record<number, unknown>) => {
  const asked: number[] = [];
  const ask = async (offset: number): Promise<SpotifyAccountAnswer> => {
    asked.push(offset);
    const data = pages[offset];
    return data === undefined ? { ok: false, reason: "failed" } : { ok: true, data };
  };
  return { ask, asked };
};

describe("readSpotifyLibrary", () => {
  test("lists the account's playlists, created and followed, and Liked Songs, page by page", async () => {
    const { ask, asked } = asking({
      0: libraryPage([likedEntry, playlistEntry("road", "Road trip"), folderEntry], 4, 0),
      3: libraryPage(
        [playlistEntry("chill", "Chill Hits", { ownerV2: { data: { username: "spotify" } } })],
        4,
        3,
      ),
    });
    const read = await readSpotifyLibrary(ask);
    assert.deepEqual(asked, [0, 3]);
    assert.deepEqual(read, {
      ok: true,
      playlists: [
        {
          source: SPOTIFY_LIKED_SONGS_SOURCE,
          title: "Liked Songs",
          artworkUrl: "https://misc.scdn.co/liked-songs.png",
          songCount: 1834,
        },
        {
          source: "spotify:playlist:road",
          title: "Road trip",
          artworkUrl: "https://i.scdn.co/image/road",
          songCount: null,
        },
        {
          source: "spotify:playlist:chill",
          title: "Chill Hits",
          artworkUrl: "https://i.scdn.co/image/chill",
          songCount: null,
        },
      ],
    });
  });

  test("leaves out playlists Spotify no longer has and Your Episodes", async () => {
    const { ask } = asking({
      0: libraryPage(
        [
          playlistEntry("gone", "Gone", { revisionId: null }),
          playlistEntry("blocked", "Blocked", { __typename: "NotFound" }),
          {
            item: {
              __typename: "PlaylistResponseWrapper",
              _uri: "spotify:collection:your-episodes",
              data: {
                __typename: "Playlist",
                uri: "spotify:collection:your-episodes",
                name: "Your Episodes",
                revisionId: "B",
              },
            },
          },
          playlistEntry("kept", "Kept"),
        ],
        4,
        0,
      ),
    });
    const read = await readSpotifyLibrary(ask);
    assert.deepEqual(read.ok ? read.playlists.map((playlist) => playlist.source) : read, [
      "spotify:playlist:kept",
    ]);
  });

  test("a page that fails fails the read with its reason", async () => {
    const read = await readSpotifyLibrary(async () => ({ ok: false, reason: "signedOut" }));
    assert.deepEqual(read, { ok: false, reason: "signedOut" });
  });

  test("an answer that isn't a library page is a failed read", async () => {
    const read = await readSpotifyLibrary(async () => ({
      ok: true,
      data: { me: { libraryV3: { __typename: "LibraryInvalidFilterIdError" } } },
    }));
    assert.deepEqual(read, { ok: false, reason: "failed" });
  });
});

describe("spotifyLibraryFailure", () => {
  test("says why the library wasn't read, with Try Again or Sign In Again", () => {
    assert.deepEqual(spotifyLibraryFailure("offline"), {
      line: "You're offline. Try again when you're back online.",
      action: "tryAgain",
    });
    assert.deepEqual(spotifyLibraryFailure("failed"), {
      line: "Couldn't read your Spotify library. No answer online.",
      action: "tryAgain",
    });
    assert.deepEqual(spotifyLibraryFailure("signedOut"), {
      line: "Your Spotify session ended. Sign in again to see your playlists.",
      action: "signIn",
    });
    assert.deepEqual(spotifyLibraryFailure("changed"), {
      line: "Spotify changed something. Try again after updating Wave.",
      action: "tryAgain",
    });
  });
});

const liked: SpotifyLibraryPlaylist = {
  source: SPOTIFY_LIKED_SONGS_SOURCE,
  title: "Liked Songs",
  artworkUrl: "https://misc.scdn.co/liked-songs.png",
  songCount: 1834,
};
const road: SpotifyLibraryPlaylist = {
  source: "spotify:playlist:road",
  title: "Road trip",
  artworkUrl: "https://i.scdn.co/image/road",
  songCount: null,
};
const chill: SpotifyLibraryPlaylist = {
  source: "spotify:playlist:chill",
  title: "Chill Hits",
  artworkUrl: null,
  songCount: null,
};

describe("spotifyLibraryPicker", () => {
  test("lists Liked Songs first, then the playlists in Spotify's order, all ticked", () => {
    const picker = spotifyLibraryPicker([road, liked, chill]);
    assert.deepEqual(picker.rows, [
      {
        playlistId: SPOTIFY_LIKED_SONGS_SOURCE,
        title: "Liked Songs",
        artworkUrl: "https://misc.scdn.co/liked-songs.png",
        line: "1,834 songs",
        imported: false,
        ticked: true,
      },
      {
        playlistId: "spotify:playlist:road",
        title: "Road trip",
        artworkUrl: "https://i.scdn.co/image/road",
        line: null,
        imported: false,
        ticked: true,
      },
      {
        playlistId: "spotify:playlist:chill",
        title: "Chill Hits",
        artworkUrl: null,
        line: null,
        imported: false,
        ticked: true,
      },
    ]);
  });

  test("lists Liked Songs even when the library doesn't", () => {
    const picker = spotifyLibraryPicker([road]);
    assert.deepEqual(
      picker.rows.map((row) => [row.playlistId, row.title, row.line]),
      [
        [SPOTIFY_LIKED_SONGS_SOURCE, "Liked Songs", null],
        ["spotify:playlist:road", "Road trip", null],
      ],
    );
  });

  test("a playlist imported on this phone says Imported and starts unticked", () => {
    const picker = spotifyLibraryPicker([liked, road], new Map([["spotify:playlist:road", 7]]));
    assert.deepEqual(
      picker.rows.map((row) => [row.playlistId, row.imported, row.ticked]),
      [
        [SPOTIFY_LIKED_SONGS_SOURCE, false, true],
        ["spotify:playlist:road", true, false],
      ],
    );
  });

  test("offers no Also add to Favorites", () => {
    assert.deepEqual(ytLibraryPickerView(spotifyLibraryPicker([liked, road])).favorites, {
      on: false,
      enabled: false,
    });
  });
});

describe("planYtLibraryImport, From Spotify", () => {
  test('names Liked Songs "Liked Songs" and reads every playlist whole, starring nothing', () => {
    const items = planYtLibraryImport(spotifyLibraryPicker([liked, road]), [
      { id: 1, name: "Road trip" },
    ]);
    assert.deepEqual(items, [
      {
        playlistId: SPOTIFY_LIKED_SONGS_SOURCE,
        name: "Liked Songs",
        replaces: null,
        uncapped: true,
        favorites: false,
      },
      {
        playlistId: "spotify:playlist:road",
        name: "Road trip 2",
        replaces: null,
        uncapped: true,
        favorites: false,
      },
    ]);
  });

  test("an Imported row ticked again refreshes the playlist it made", () => {
    const picker = spotifyLibraryPicker([liked, road], new Map([["spotify:playlist:road", 4]]));
    const ticked = {
      ...picker,
      rows: picker.rows.filter((row) => row.imported).map((row) => ({ ...row, ticked: true })),
    };
    assert.deepEqual(planYtLibraryImport(ticked, [{ id: 4, name: "My road trip" }]), [
      {
        playlistId: "spotify:playlist:road",
        name: "My road trip",
        replaces: 4,
        uncapped: true,
        favorites: false,
      },
    ]);
  });
});

/** A track as the web player's queries give it: `fetchPlaylist` says `trackDuration`, `fetchLibraryTracks` `duration`. */
const track = (name: string, artist: string, lengthKey: string) => ({
  __typename: "Track",
  name,
  artists: { items: [{ profile: { name: artist } }] },
  albumOfTrack: {
    name: `${name} (album)`,
    coverArt: { sources: [{ url: `https://i.scdn.co/${name}` }] },
  },
  ...Object.fromEntries([[lengthKey, { totalMilliseconds: 200_000 }]]),
});

const playlistData = (names: readonly string[], total: number) => ({
  playlistV2: {
    __typename: "Playlist",
    name: "Road trip",
    images: { items: [{ sources: [{ url: "https://i.scdn.co/image/road" }] }] },
    content: {
      totalCount: total,
      items: names.map((name, index) => ({
        uid: `uid${index}`,
        itemV2: { data: track(name, "Band", "trackDuration") },
      })),
    },
  },
});

const likedItem = (name: string): unknown => ({
  addedAt: { isoString: "2026-01-01T00:00:00Z" },
  track: { _uri: `spotify:track:${name}`, data: track(name, "Singer", "duration") },
});

const likedData = (items: readonly unknown[], total: number) => ({
  me: { library: { tracks: { totalCount: total, items } } },
});

const song = (title: string, artist: string) => ({
  title,
  artists: [artist],
  album: `${title} (album)`,
  durationMs: 200_000,
  artworkUrl: `https://i.scdn.co/${title}`,
});

describe("readSpotifyAccountPlaylist", () => {
  test("reads a playlist whole as the account, page by page", async () => {
    const asked: SpotifyAccountRequest[] = [];
    const read = await readSpotifyAccountPlaylist("spotify:playlist:road", async (request) => {
      asked.push(request);
      return {
        ok: true,
        data: request.offset === 0 ? playlistData(["A", "B"], 3) : playlistData(["C"], 3),
      };
    });
    assert.deepEqual(asked, [
      { kind: "playlist", uri: "spotify:playlist:road", offset: 0 },
      { kind: "playlist", uri: "spotify:playlist:road", offset: 2 },
    ]);
    assert.deepEqual(read, {
      ok: true,
      playlist: {
        title: "Road trip",
        artworkUrl: "https://i.scdn.co/image/road",
        songs: [song("A", "Band"), song("B", "Band"), song("C", "Band")],
        truncated: false,
        total: 3,
      },
    });
  });

  test("reads Liked Songs as a playlist named Liked Songs", async () => {
    const asked: SpotifyAccountRequest[] = [];
    const read = await readSpotifyAccountPlaylist(SPOTIFY_LIKED_SONGS_SOURCE, async (request) => {
      asked.push(request);
      return {
        ok: true,
        data: likedData([likedItem(request.offset === 0 ? "X" : "Y")], 2),
      };
    });
    assert.deepEqual(asked, [
      { kind: "likedSongs", offset: 0 },
      { kind: "likedSongs", offset: 1 },
    ]);
    assert.deepEqual(read, {
      ok: true,
      playlist: {
        title: "Liked Songs",
        artworkUrl: null,
        songs: [song("X", "Singer"), song("Y", "Singer")],
        truncated: false,
        total: 2,
      },
    });
  });

  test("a liked song Spotify no longer has counts but isn't listed", async () => {
    const gone = { track: { _uri: "spotify:track:gone", data: { __typename: "NotFound" } } };
    const read = await readSpotifyAccountPlaylist(SPOTIFY_LIKED_SONGS_SOURCE, async () => ({
      ok: true,
      data: likedData([likedItem("X"), gone], 2),
    }));
    assert.deepEqual(read.ok && [read.playlist.songs.length, read.playlist.total], [1, 2]);
  });

  test("a playlist Spotify no longer has is missing", async () => {
    const read = await readSpotifyAccountPlaylist("spotify:playlist:gone", async () => ({
      ok: true,
      data: { playlistV2: { __typename: "NotFound" } },
    }));
    assert.deepEqual(read, { ok: false, reason: "missing" });
  });

  test("a page that fails fails the read with its reason", async () => {
    const read = await readSpotifyAccountPlaylist("spotify:playlist:road", async () => ({
      ok: false,
      reason: "offline",
    }));
    assert.deepEqual(read, { ok: false, reason: "offline" });
  });
});
