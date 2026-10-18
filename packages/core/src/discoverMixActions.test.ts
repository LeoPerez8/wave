import assert from "node:assert/strict";
import { test } from "node:test";

import { discoverMixActions, discoverMixPlaylist, ytAlbumDownload } from "./index.ts";
import type { YtAlbumSong, YtDownloadJournalJob } from "./index.ts";

const song = (videoId: string): YtAlbumSong => ({
  videoId,
  title: `Song ${videoId}`,
  artists: ["Portishead"],
  album: "Dummy",
  albumId: "MPREb_dummy",
  durationMs: 200_000,
  artworkUrl: "https://example.com/dummy.jpg",
  explicit: false,
});

test("a mix menu queues and saves its songs, and follows the album download through cancel and retry", () => {
  const songs = [song("b"), song("a")];
  const menu = (jobs: readonly YtDownloadJournalJob[]) =>
    discoverMixActions(ytAlbumDownload(songs, { inLibrary: () => false, jobs }));
  assert.deepEqual(menu([]), [
    { action: "playNext", label: "Play Next" },
    { action: "addToQueue", label: "Add to Queue" },
    { action: "saveAsPlaylist", label: "Save as Playlist" },
    { action: "downloadAlbum", label: "Download Mix" },
  ]);
  assert.deepEqual(
    menu(songs.map((entry) => ({ id: entry.videoId, song: entry, phase: "queued" }))).at(-1),
    { action: "cancelAlbumDownload", label: "Cancel Download" },
  );
  assert.deepEqual(
    menu(
      songs.map((entry) => ({
        id: entry.videoId,
        song: entry,
        phase: "failed",
        reason: "offline",
      })),
    ).at(-1),
    { action: "retryFailed", label: "Retry Failed" },
  );
  assert.deepEqual(
    discoverMixActions(ytAlbumDownload(songs, { inLibrary: () => true, jobs: [] })),
    [
      { action: "playNext", label: "Play Next" },
      { action: "addToQueue", label: "Add to Queue" },
      { action: "saveAsPlaylist", label: "Save as Playlist" },
    ],
  );
});

test("a mix name is kept within the imported playlist name limit", () => {
  const playlist = discoverMixPlaylist({
    id: "artist:x",
    seed: { kind: "artist", name: "x".repeat(120) },
    songs: [{ source: "stream", song: song("a") }],
  });
  assert.equal(playlist.name, "x".repeat(100));
});

test("Save as Playlist keeps the mix's name and song order as independent YT Music entries", () => {
  const songs = [song("b"), song("a")];
  const seed = { kind: "artist" as const, name: "Portishead" };
  const playlist = discoverMixPlaylist({
    id: "artist:portishead",
    seed,
    songs: songs.map((entry) => ({ source: "stream", song: entry })),
  });
  // The next build replaces the mix's songs and seed; the saved copy stays as it was.
  songs.splice(0, songs.length, song("c"));
  seed.name = "Massive Attack";
  assert.deepEqual(playlist, {
    name: "Portishead mix",
    songs: [
      { source: "stream", song: song("b") },
      { source: "stream", song: song("a") },
    ],
  });
});
