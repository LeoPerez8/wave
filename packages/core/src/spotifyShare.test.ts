import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, test } from "node:test";

import {
  readSpotifySharedPlaylist,
  spotifyLibraryHas,
  spotifyShareMatch,
  spotifyShareSong,
} from "./index.ts";

const lucky = { title: "Get Lucky", artists: ["Daft Punk"], album: "RAM", durationMs: 369_000 };

describe("spotifyShareSong", () => {
  test("searches every song by its title, artists, album and length: Wave knows no Spotify ids", () => {
    assert.deepEqual(spotifyShareSong({ source: "library", song: lucky }), {
      id: null,
      search: lucky,
    });
    const stream = { ...lucky, videoId: "v1", artworkUrl: "https://x", explicit: false };
    assert.deepEqual(spotifyShareSong({ source: "stream", song: stream }), {
      id: null,
      search: lucky,
    });
    assert.deepEqual(
      spotifyShareSong({ source: "unsearched", song: { ...lucky, artworkUrl: null } }),
      {
        id: null,
        search: lucky,
      },
    );
  });

  test("searches an entry YouTube Music didn't have: Spotify may", () => {
    const song = { ...lucky, artworkUrl: null, reason: "notFound" as const };
    assert.deepEqual(spotifyShareSong({ source: "unavailable", song }), {
      id: null,
      search: lucky,
    });
  });

  test("leaves out a song with no artist to match it by", () => {
    const local = { ...lucky, artists: [], artworkUrl: null, reason: "localFile" as const };
    assert.deepEqual(spotifyShareSong({ source: "unavailable", song: local }), { id: null });
    assert.deepEqual(
      spotifyShareSong({ source: "library", song: { ...lucky, artists: ["Unknown Artist"] } }),
      { id: null },
    );
  });
});

const sample = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../../../docs/spotify-samples/${name}`, import.meta.url), "utf8"),
  );

const track = (
  uri: string,
  over: { title?: string; artists?: string[]; durationMs?: number; playable?: boolean } = {},
) => ({
  item: {
    __typename: "TrackResponseWrapper",
    data: {
      __typename: "Track",
      uri,
      name: over.title ?? "Get Lucky",
      artists: { items: (over.artists ?? ["Daft Punk"]).map((name) => ({ profile: { name } })) },
      albumOfTrack: { name: "Random Access Memories" },
      duration: { totalMilliseconds: over.durationMs ?? 368_000 },
      playability: { playable: over.playable ?? true },
    },
  },
});

const answer = (...items: unknown[]) => ({ searchV2: { tracksV2: { items } } });

describe("spotifyShareMatch", () => {
  test("reads Spotify's search answer and takes the best match's track", () => {
    const blinding = {
      title: "Blinding Lights",
      artists: ["The Weeknd"],
      album: null,
      durationMs: 200_000,
    };
    const data = (sample("search-tracks.json") as { data: unknown }).data;
    assert.equal(spotifyShareMatch(blinding, data), "spotify:track:0VjIjW4GlUZAMYd2vXMi3b");
  });

  test("takes the first result that is the same recording, by title, artists and length", () => {
    const data = answer(
      track("spotify:track:live", { title: "Get Lucky - Live" }),
      track("spotify:track:other", { artists: ["Pharrell Williams"] }),
      track("spotify:track:long", { durationMs: 610_000 }),
      track("spotify:track:studio"),
    );
    assert.equal(spotifyShareMatch(lucky, data), "spotify:track:studio");
  });

  test("skips a track Spotify won't play, and finds nothing when none matches", () => {
    assert.equal(
      spotifyShareMatch(lucky, answer(track("spotify:track:gone", { playable: false }))),
      null,
    );
    assert.equal(spotifyShareMatch(lucky, answer()), null);
  });

  test("an answer that isn't a search is undefined: no answer at all", () => {
    assert.equal(spotifyShareMatch(lucky, { searchV2: null }), undefined);
    assert.equal(spotifyShareMatch(lucky, null), undefined);
  });
});

const PLAYLIST = "spotify:playlist:37i9dQZF1DXcBWIGoYBM5M";

/** `fetchPlaylist` data for a playlist of [total] items, holding [entries] ([uri, uid]) from this page. */
const playlistPage = (total: number, entries: readonly (readonly [string, string])[]) => ({
  playlistV2: {
    __typename: "Playlist",
    uri: PLAYLIST,
    content: {
      totalCount: total,
      items: entries.map(([uri, uid]) => ({
        uid,
        itemV2: { __typename: "TrackResponseWrapper", data: { __typename: "Track", uri } },
      })),
    },
  },
});

describe("readSpotifySharedPlaylist", () => {
  test("reads every page of the playlist: each entry's track and uid", async () => {
    const offsets: number[] = [];
    const pages = new Map([
      [
        0,
        playlistPage(3, [
          ["spotify:track:a", "u1"],
          ["spotify:track:b", "u2"],
        ]),
      ],
      [2, playlistPage(3, [["spotify:local:::x:1", "u3"]])],
    ]);
    const entries = await readSpotifySharedPlaylist(async (offset) => {
      offsets.push(offset);
      return pages.get(offset);
    });
    assert.deepEqual(entries, [
      { id: "spotify:track:a", entryId: "u1" },
      { id: "spotify:track:b", entryId: "u2" },
      { id: "spotify:local:::x:1", entryId: "u3" },
    ]);
    assert.deepEqual(offsets, [0, 2]);
  });

  test("a playlist Spotify doesn't have, or the account can't edit, is gone", async () => {
    const notFound = (sample("fetch-playlist-not-found.json") as { data: unknown }).data;
    assert.equal(await readSpotifySharedPlaylist(async () => notFound), null);
    const page = playlistPage(0, []);
    const readOnly = {
      playlistV2: { ...page.playlistV2, currentUserCapabilities: { canEditItems: false } },
    };
    assert.equal(await readSpotifySharedPlaylist(async () => readOnly), null);
  });

  test("rejects an answer that isn't a playlist rather than read it as empty", async () => {
    await assert.rejects(readSpotifySharedPlaylist(async () => ({ playlistV2: null })));
  });
});

/** `libraryV3` data for a library of [total] entries, holding [uris] from this page. */
const libraryPage = (total: number, uris: readonly string[]) => ({
  me: {
    libraryV3: {
      totalCount: total,
      items: uris.map((uri) => ({
        item: {
          __typename: "PlaylistResponseWrapper",
          _uri: uri,
          data: { __typename: "Playlist", uri },
        },
      })),
    },
  },
});

describe("spotifyLibraryHas", () => {
  test("pages through the account's library until it finds the playlist", async () => {
    const offsets: number[] = [];
    const pages = new Map([
      [0, libraryPage(4, ["spotify:playlist:a", "spotify:playlist:b"])],
      [2, libraryPage(4, [PLAYLIST, "spotify:playlist:c"])],
    ]);
    const has = await spotifyLibraryHas(PLAYLIST, async (offset) => {
      offsets.push(offset);
      return pages.get(offset);
    });
    assert.equal(has, true);
    assert.deepEqual(offsets, [0, 2]);
  });

  test("a playlist not in the library was deleted", async () => {
    assert.equal(
      await spotifyLibraryHas(PLAYLIST, async () => libraryPage(1, ["spotify:playlist:a"])),
      false,
    );
  });

  test("rejects an answer that isn't the library", async () => {
    await assert.rejects(spotifyLibraryHas(PLAYLIST, async () => ({ me: null })));
  });
});
