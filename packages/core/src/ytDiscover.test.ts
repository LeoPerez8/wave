import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { discoverSongs, discoverTrackId, ytAlbumSongs } from "./index.ts";
import type { YtSong } from "./index.ts";

const song = (videoId: string, title = videoId): YtSong => ({
  videoId,
  title,
  artists: ["Artist"],
  album: null,
  durationMs: 200_000,
  artworkUrl: null,
  explicit: false,
});

describe("YT Music songs next to the Library's", () => {
  const mine = { id: 7, title: "Mine", artist: "Artist", durationMs: 200_000 };
  const find = (s: YtSong) => (s.title === "Mine" ? mine : null);

  test("a song the Library has plays its file; the others stream", () => {
    assert.deepEqual(discoverSongs([song("a"), song("m", "Mine")], find), [
      { source: "stream", song: song("a") },
      { source: "library", song: song("m", "Mine"), track: mine },
    ]);
  });

  test("a song queues as the Library track it is, or as a YT Music song", () => {
    assert.equal(discoverTrackId({ source: "library", track: mine }), "7");
    assert.equal(discoverTrackId({ source: "stream", song: song("a") }), "yt:a");
  });
});

describe("ytAlbumSongs", () => {
  test("an album page's tracks are songs on that album, with its cover", () => {
    const songs = ytAlbumSongs("MPREb_1", {
      title: "Random Access Memories",
      artists: ["Daft Punk"],
      year: 2013,
      artworkUrl: "https://lh3.googleusercontent.com/cover=w544-h544",
      tracks: [
        {
          videoId: "v1",
          title: "Give Life Back to Music",
          artists: ["Daft Punk"],
          trackNumber: 1,
          durationMs: 274_000,
          explicit: false,
        },
        {
          videoId: "v8",
          title: "Get Lucky",
          artists: ["Daft Punk", "Pharrell Williams"],
          trackNumber: 8,
          durationMs: null,
          explicit: true,
        },
      ],
    });
    assert.deepEqual(songs, [
      {
        videoId: "v1",
        title: "Give Life Back to Music",
        artists: ["Daft Punk"],
        album: "Random Access Memories",
        albumId: "MPREb_1",
        durationMs: 274_000,
        artworkUrl: "https://lh3.googleusercontent.com/cover=w544-h544",
        explicit: false,
      },
      {
        videoId: "v8",
        title: "Get Lucky",
        artists: ["Daft Punk", "Pharrell Williams"],
        album: "Random Access Memories",
        albumId: "MPREb_1",
        durationMs: null,
        artworkUrl: "https://lh3.googleusercontent.com/cover=w544-h544",
        explicit: true,
      },
    ]);
  });
});
