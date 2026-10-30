import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  YT_DOWNLOAD_BUTTON_LABELS,
  YT_PLAYLIST_DOWNLOAD_ACTION_LABELS,
  ytPlaylistDownload,
  ytPlaylistDownloadButton,
  ytSongsDownload,
  ytDownloadButtonLabels,
} from "./index.ts";
import type { PlaylistItem, YtDownloadJournalJob, YtSong } from "./index.ts";

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

  test("songs fall back to YouTube Music one by one; Retry Failed asks only for those both sources failed", () => {
    const songs = [song("a"), song("b"), song("c"), song("d")];
    const view = ytSongsDownload(songs, {
      inLibrary: ({ videoId }) => videoId === "a",
      jobs: [
        // Soulseek delivered "a"; "b" carries on from YouTube Music after Soulseek failed.
        job("a", { source: "soulseek", ...saved("/a.mp3") }),
        job("b", { source: "youtube", phase: "transferring", received: 10, total: 100 }),
        job("c", { source: "youtube", phase: "failed", reason: "ytUnavailable" }),
        job("d", { source: "soulseek", phase: "failed", reason: "offline" }),
      ],
    });
    assert.deepEqual(view.actions, ["cancel"]);
    assert.deepEqual(
      view.toRetry.map(({ song: { videoId } }) => videoId),
      ["c", "d"],
    );
  });
});

type Entry = PlaylistItem<YtSong, { readonly path: string | null }>;
const stream = (videoId: string): Entry => ({ source: "stream", song: song(videoId) });
const file = (path: string | null): Entry => ({ source: "library", track: { path } });
const unavailable = (title: string): Entry => ({
  source: "unavailable",
  song: {
    title,
    artists: ["Artist"],
    album: null,
    durationMs: null,
    artworkUrl: null,
    reason: "notFound",
  },
});

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

  test("a playlist of thousands of YT Music entries is decided at once, before and after Download", () => {
    // Different recordings: titles and artists vary, as an imported playlist's do.
    const recording = (videoId: string, i: number, title: string): YtSong => ({
      ...song(videoId, `${title} ${i} (Remastered 2011)`),
      artists: [`Artist ${i % 400} feat. Guest ${i % 7}`],
      durationMs: 180_000 + i * 50,
    });
    const songs = Array.from({ length: 2000 }, (_, i) => recording(`v${i}`, i, "Song"));
    const playlist = songs.map((one): Entry => ({ source: "stream", song: one }));
    const queued = (one: YtSong): YtDownloadJournalJob => ({
      id: one.videoId,
      song: one,
      phase: "queued",
    });
    // Another list's downloads on their way, one of them the first entry's recording.
    const journal = [
      ...Array.from({ length: 2000 }, (_, i) => queued(recording(`o${i}`, i, "Other"))),
      queued(recording("alt0", 0, "Song")),
    ];

    const started = performance.now();
    const before = ytPlaylistDownload(playlist, { inLibrary: nothingInLibrary, jobs: journal });
    const after = ytPlaylistDownload(playlist, {
      inLibrary: nothingInLibrary,
      jobs: [...journal, ...songs.map(queued)],
    });
    // Generous for CI; the playlist screen decides its Download button with it on every open.
    assert.ok(performance.now() - started < 2000);

    assert.equal(before.toDownload.length, 2000);
    assert.deepEqual(
      before.toDownload.flatMap(({ song: { videoId }, sharedJob }) =>
        sharedJob === null ? [] : [[videoId, sharedJob]],
      ),
      [["v0", "alt0"]],
    );
    assert.equal(after.toDownload.length, 0);
    assert.equal(after.toCancel.length, 2000);
  });

  test("unavailable entries have nothing to download: a playlist of them and its Library songs offers no download", () => {
    const playlist = [unavailable("Within"), stream("a"), unavailable("Untitled")];
    const view = ytPlaylistDownload(playlist, {
      inLibrary: nothingInLibrary,
      jobs: [job("a", { phase: "failed", reason: "offline" })],
    });
    assert.deepEqual(view.actions, ["retryFailed"]);
    assert.deepEqual(
      view.toRetry.map(({ song: { videoId } }) => videoId),
      ["a"],
    );
    const none = ytPlaylistDownload([file("/Music/x.mp3"), unavailable("Within")], {
      inLibrary: nothingInLibrary,
      jobs: [],
    });
    assert.deepEqual(none.actions, []);
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

  test("a page knows every label its button can say, to measure them ahead", () => {
    assert.deepEqual(YT_DOWNLOAD_BUTTON_LABELS, [
      "Download",
      "Retry Failed",
      "Cancel",
      "Downloaded",
    ]);
  });

  test("the playlist page's button cycles Download, Cancel, Retry Failed, then Downloaded", () => {
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
    // Every entry is the Library's song now, the downloads' songs in place of theirs.
    assert.deepEqual(
      ytPlaylistDownloadButton(
        ytPlaylistDownload([file("/Music/x.mp3"), file("/Music/a.mp3"), file("/Music/b.mp3")], {
          inLibrary: nothingInLibrary,
          jobs: [job("a", saved("/Music/a.mp3")), job("b", saved("/Music/b.mp3"))],
        }),
      ),
      { action: "downloaded", label: "Downloaded" },
    );
  });

  test("a playlist of the Library's songs only, with nothing it downloaded, has no button", () => {
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

  test("a playlist whose YT Music entries the Library has says Downloaded", () => {
    assert.deepEqual(
      ytPlaylistDownloadButton(
        ytPlaylistDownload([file("/Music/x.mp3"), stream("a")], {
          inLibrary: () => true,
          jobs: [],
        }),
      ),
      { action: "downloaded", label: "Downloaded" },
    );
  });

  test("a playlist with a song this phone has no file for isn't Downloaded", () => {
    assert.equal(everyStreamInLibraryButton([stream("a"), file(null)]), null);
    assert.equal(everyStreamInLibraryButton([stream("a"), unavailable("Gone")]), null);
    assert.equal(everyStreamInLibraryButton([]), null);
  });
});

/** The playlist page's button for [entries] when the Library has every YT Music song. */
function everyStreamInLibraryButton(entries: Entry[]) {
  return ytPlaylistDownloadButton(ytPlaylistDownload(entries, { inLibrary: () => true, jobs: [] }));
}

const listed = (title: string) => ({
  title,
  artists: ["Daft Punk"],
  album: "Random Access Memories",
  durationMs: 498_000,
  artworkUrl: "https://i.scdn.co/image/ram",
});
const unsearched = (title: string): Entry => ({ source: "unsearched", song: listed(title) });
/** The jobs unsearched songs' downloads go by: what Spotify listed of each. */
const touchJob = 'unsearched:["Touch",["Daft Punk"],"Random Access Memories",498000]';
const motherboardJob = 'unsearched:["Motherboard",["Daft Punk"],"Random Access Memories",498000]';

describe("downloading a playlist's unsearched entries", () => {
  test("Download Playlist queues unsearched entries in playlist order, as songs with what Spotify listed", () => {
    const playlist = [
      stream("a"),
      unsearched("Touch"),
      file("/Music/x.mp3"),
      unsearched("Motherboard"),
    ];
    const view = ytPlaylistDownload(playlist, { inLibrary: nothingInLibrary, jobs: [] });
    assert.deepEqual(view.actions, ["downloadPlaylist"]);
    assert.deepEqual(
      view.toDownload.map(({ song: { videoId } }) => videoId),
      ["a", touchJob, motherboardJob],
    );
    assert.deepEqual(view.toDownload[1]?.song, {
      videoId: touchJob,
      ...listed("Touch"),
      explicit: false,
      albumId: null,
    });
  });

  test("not found, the entry is unavailable and its row failed: Retry Failed asks again only for failed rows", () => {
    const touch = { ...listed("Touch"), reason: "notFound" as const };
    const playlist: Entry[] = [
      { source: "unavailable", song: touch },
      // Unavailable since its import: never asked for, nothing to download.
      unavailable("Within"),
      stream("a"),
      unsearched("Motherboard"),
    ];
    const view = ytPlaylistDownload(playlist, {
      inLibrary: ({ videoId }) => videoId === "a",
      jobs: [
        job(touchJob, { phase: "failed", reason: "notFound" }),
        job("a", saved("/Music/a.mp3")),
        job(motherboardJob, { phase: "failed", reason: "offline" }),
      ],
    });
    assert.deepEqual(view.actions, ["retryFailed"]);
    assert.deepEqual(
      view.toRetry.map(({ song: { videoId } }) => videoId),
      [touchJob, motherboardJob],
    );
    assert.deepEqual(view.toDownload, []);
  });

  test("an unsearched entry on its way counts in the progress line as any song asked for", () => {
    const playlist = [unsearched("Touch"), unsearched("Motherboard"), stream("a")];
    const view = ytPlaylistDownload(playlist, {
      inLibrary: nothingInLibrary,
      jobs: [job(touchJob, { phase: "preparing" }), job(motherboardJob), job("a", saved("/a"))],
    });
    assert.equal(view.line, "Downloading · 1 of 3");
    assert.deepEqual(view.toCancel, [touchJob, motherboardJob]);
  });

  test("found, the entry is the YT Music song its download shares: it isn't asked for twice", () => {
    // The search found "touch": the entry is that YT Music song now, on the unsearched job.
    const playlist = [stream("touch"), unsearched("Motherboard")];
    const view = ytPlaylistDownload(playlist, {
      inLibrary: nothingInLibrary,
      jobs: [job(touchJob, { phase: "transferring", aliases: [song("touch")] })],
    });
    assert.deepEqual(
      view.toDownload.map(({ song: { videoId } }) => videoId),
      [motherboardJob],
    );
    // Cancel ends the job, not only the YT Music song's place on it.
    assert.deepEqual(view.toCancel, ["touch", touchJob]);
    assert.equal(view.line, "Downloading · 0 of 1");
  });
});

describe("a list's download in Portuguese", () => {
  test("the progress line, the page button and the labels to measure read in Portuguese", () => {
    const songs = [song("a"), song("b"), song("c")];
    const going = ytSongsDownload(songs, {
      inLibrary: nothingInLibrary,
      jobs: [job("a"), job("b"), job("c")],
      language: "pt-BR",
    });
    assert.equal(going.line, "Baixando · 0 de 3");
    const playlist = [file("/Music/x.mp3"), stream("a")];
    assert.deepEqual(
      ytPlaylistDownloadButton(
        ytPlaylistDownload(playlist, { inLibrary: nothingInLibrary, jobs: [] }),
        "pt-BR",
      ),
      { action: "downloadPlaylist", label: "Baixar" },
    );
    assert.deepEqual(ytDownloadButtonLabels("pt-BR"), [
      "Baixar",
      "Tentar Falhas Novamente",
      "Cancelar",
      "Baixado",
    ]);
  });
});
