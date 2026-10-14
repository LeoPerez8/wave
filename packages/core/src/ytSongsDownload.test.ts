import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  YT_PLAYLIST_DOWNLOAD_ACTION_LABELS,
  ytPlaylistDownload,
  ytPlaylistDownloadButton,
  ytSongsDownload,
} from "./index.ts";
import type { MixedSong, YtDownloadJournalJob, YtSong } from "./index.ts";

const song = (videoId: string, title = `Song ${videoId}`): YtSong => ({
  videoId,
  title,
  artists: ["Artist"],
  album: null,
  durationMs: 200_000,
  artworkUrl: null,
  explicit: false,
});

const job = (videoId: string, patch: Partial<YtDownloadJournalJob> = {}): YtDownloadJournalJob => ({
  id: videoId,
  song: song(videoId),
  phase: "queued",
  ...patch,
});

const nothingInLibrary = (_song: YtSong): boolean => false;

/** A job whose file the Library imported, at [path]. */
const saved = (path: string) =>
  ({ phase: "completed", acknowledged: true, saved: { path } }) as const;

describe("downloading a list of YT Music songs", () => {
  test("songs from different albums are decided as one list: Download, Cancel, then Retry Failed", () => {
    const songs = [{ ...song("a"), album: "One" }, { ...song("b"), album: "Two" }, song("c")];
    const fresh = ytSongsDownload(songs, { inLibrary: nothingInLibrary, jobs: [] });
    assert.deepEqual(fresh.actions, ["download"]);
    assert.deepEqual(
      fresh.toDownload.map(({ song: { videoId } }) => videoId),
      ["a", "b", "c"],
    );

    const going = ytSongsDownload(songs, {
      inLibrary: nothingInLibrary,
      jobs: [job("a"), job("b"), job("c", { phase: "failed", reason: "account" })],
    });
    assert.deepEqual(going.actions, ["cancel"]);
    assert.equal(going.line, "Downloading · 0 of 3");

    const ended = ytSongsDownload(songs, {
      inLibrary: ({ videoId }) => videoId !== "c",
      jobs: [
        job("a", { phase: "completed", acknowledged: true, saved: { path: "/a.mp3" } }),
        job("b", { phase: "completed", acknowledged: true, saved: { path: "/b.mp3" } }),
        job("c", { phase: "failed", reason: "account" }),
      ],
    });
    assert.deepEqual(ended.actions, ["retryFailed"]);
    assert.deepEqual(ended.toCancel, []);
  });
});

type Entry = MixedSong<YtSong, { readonly path: string }>;
const stream = (videoId: string): Entry => ({ source: "stream", song: song(videoId) });
const file = (path: string): Entry => ({ source: "library", track: { path } });

describe("downloading a playlist's YT Music entries", () => {
  test("Download Playlist queues the YT Music entries in playlist order, past its Library songs", () => {
    const playlist = [stream("a"), file("/Music/x.mp3"), stream("b"), stream("c"), stream("d")];
    const view = ytPlaylistDownload(playlist, {
      inLibrary: ({ videoId }) => videoId === "d",
      jobs: [job("c", { phase: "transferring" })],
    });
    assert.deepEqual(view.actions, ["downloadPlaylist", "cancelPlaylistDownload"]);
    assert.deepEqual(
      view.toDownload.map(({ song: { videoId } }) => videoId),
      ["a", "b"],
    );
  });

  test("a song saved this session has taken its entry's place, and still counts in the progress line", () => {
    // "a" landed and its entry became the Library's song; "x" was always the Library's.
    const playlist = [file("/Music/A/a.mp3"), file("/Music/x.mp3"), stream("b"), stream("c")];
    const view = ytPlaylistDownload(playlist, {
      inLibrary: nothingInLibrary,
      jobs: [
        job("a", saved("/Music/A/a.mp3")),
        job("z", saved("/Music/Z/z.mp3")),
        job("b", { phase: "transferring" }),
        job("c"),
      ],
    });
    assert.equal(view.line, "Downloading · 1 of 3");
    assert.deepEqual(view.toCancel, ["b", "c"]);
  });

  test("with no source to download from, every entry fails and the playlist offers Retry Failed", () => {
    const playlist = [stream("a"), file("/Music/x.mp3"), stream("b")];
    const view = ytPlaylistDownload(playlist, {
      inLibrary: nothingInLibrary,
      jobs: [
        job("a", { phase: "failed", reason: "noSource" }),
        job("b", { phase: "failed", reason: "noSource" }),
      ],
    });
    assert.deepEqual(view.actions, ["retryFailed"]);
    assert.deepEqual(
      view.toRetry.map(({ song: { videoId } }) => videoId),
      ["a", "b"],
    );
  });

  test("the playlist menu names each entry", () => {
    assert.deepEqual(YT_PLAYLIST_DOWNLOAD_ACTION_LABELS, {
      downloadPlaylist: "Download Playlist",
      retryFailed: "Retry Failed",
      cancelPlaylistDownload: "Cancel Playlist Download",
    });
  });

  test("the playlist page's button cycles Download, Cancel, Retry Failed, then goes", () => {
    const playlist = [file("/Music/x.mp3"), stream("a"), stream("b")];
    const button = (jobs: YtDownloadJournalJob[], inLibrary = nothingInLibrary) =>
      ytPlaylistDownloadButton(ytPlaylistDownload(playlist, { inLibrary, jobs }));
    assert.deepEqual(button([]), { action: "downloadPlaylist", label: "Download" });
    assert.deepEqual(button([job("a"), job("b")]), {
      action: "cancelPlaylistDownload",
      label: "Cancel",
    });
    assert.deepEqual(
      button(
        [job("a", { phase: "failed", reason: "account" }), job("b", { phase: "failed" })],
        nothingInLibrary,
      ),
      { action: "retryFailed", label: "Retry Failed" },
    );
    // Every entry is the Library's song now.
    assert.equal(
      ytPlaylistDownloadButton(
        ytPlaylistDownload([file("/Music/x.mp3"), file("/Music/a.mp3")], {
          inLibrary: nothingInLibrary,
          jobs: [],
        }),
      ),
      null,
    );
  });
});
