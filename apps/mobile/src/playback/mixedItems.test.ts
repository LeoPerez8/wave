import assert from "node:assert/strict";
import { test } from "node:test";
import type { YtArtistAlbum } from "@wave/core";
import type { NativeYtSong } from "../native/waveYtMusic.ts";
import { artistSelectionItems, mixedItemKey, mixedTarget } from "./mixedItems.ts";
import { resolveMixedEntries } from "./mixedEntries.ts";
import type { AlbumRow, SongRow } from "../library/LibraryStore.ts";

const release: YtArtistAlbum = {
  kind: "album",
  browseId: "release",
  title: "Album",
  artists: ["Artist"],
  year: 2026,
  artworkUrl: null,
};
const song = (videoId: string): NativeYtSong => ({
  videoId,
  title: videoId,
  artists: ["Artist"],
  album: "Album",
  albumId: "release",
  durationMs: 180000,
  artworkUrl: null,
  explicit: false,
});

test("an action uses a Library release's songs and matches a streamed release only when run", async () => {
  const album: AlbumRow = {
    id: 7,
    title: "Album",
    titleSort: "album",
    albumArtist: "Artist",
    albumArtistId: 1,
    albumArtistIds: [1],
    year: null,
    compilation: false,
    trackCount: 1,
    durationMs: 180000,
    thumbPath: null,
    artworkPath: null,
  };
  const track: SongRow = {
    id: 9,
    path: "/Music/song.m4a",
    title: "Downloaded",
    artist: "Artist",
    album: "Album",
    durationMs: 180000,
    thumbPath: null,
    artworkPath: null,
    titleSort: "downloaded",
    artistSort: "artist",
    albumSort: "album",
    addedAt: 0,
    albumId: 7,
    artistId: 1,
    artistIds: [1],
    discNumber: 1,
    trackNumber: 1,
    year: null,
    genre: null,
    hasLyrics: false,
    explicit: "clean",
  };
  const selected = artistSelectionItems(
    [
      { kind: "albums", releases: [{ album: release, library: album }] },
      { kind: "singles", releases: [{ album: { ...release, browseId: "single" }, library: null }] },
    ],
    [{ source: "stream", song: song("downloaded") }],
  );
  const calls: string[] = [];
  const entries = await resolveMixedEntries(selected, {
    album: async (album) => {
      calls.push(`library:${album.id}`);
      return [track];
    },
    release: async (album) => {
      calls.push(`release:${album.browseId}`);
      return [song("downloaded"), song("online")];
    },
    finder: async () => {
      calls.push("finder");
      return (song) => (song.videoId === "downloaded" ? track : null);
    },
  });
  assert.deepEqual(calls, ["library:7", "release:single", "finder"]);
  assert.deepEqual(entries, [
    { source: "library", track },
    { source: "stream", song: song("online") },
  ]);
});

test("a failed release rejects the whole action instead of returning a partial selection", async () => {
  const selected = artistSelectionItems(
    [{ kind: "albums", releases: [{ album: release, library: null }] }],
    [{ source: "stream", song: song("checked") }],
  );
  await assert.rejects(
    resolveMixedEntries(selected, {
      album: async () => [],
      release: async () => {
        throw new Error("offline");
      },
      finder: async () => () => null,
    }),
    /offline/,
  );
});

test("artist selection describes shelves and songs without reading a release", async () => {
  let reads = 0;
  const single = { ...release, browseId: "single" };
  const selected = artistSelectionItems(
    [
      { kind: "albums", releases: [{ album: release, library: null }] },
      { kind: "singles", releases: [{ album: single, library: null }] },
    ],
    [{ source: "stream", song: song("checked") }],
  );
  assert.deepEqual(selected.map(mixedItemKey), [
    "yt-album-release",
    "yt-album-single",
    "track-yt:checked",
  ]);
  const target = mixedTarget(selected);
  assert.equal(target.kind, "mixed");
  assert.equal(reads, 0);
  const entries = await resolveMixedEntries(selected, {
    album: async () => {
      throw new Error("no Library album was checked");
    },
    release: async (album) => {
      reads++;
      return [song(album.browseId), song("checked")];
    },
    finder: async () => () => null,
  });
  assert.equal(reads, 2);
  assert.deepEqual(
    entries.map((entry) => (entry.source === "stream" ? entry.song.videoId : null)),
    ["release", "checked", "single"],
  );
});
