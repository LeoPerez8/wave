import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  YT_ALBUM_DOWNLOAD_ACTION_LABELS,
  ytAlbumDownload,
  ytAlbumDownloadButton,
} from "./index.ts";
import type { YtDownloadJournalJob, YtSong } from "./index.ts";

const song = (videoId: string, title = `Song ${videoId}`): YtSong => ({
  videoId,
  title,
  artists: ["Artist"],
  album: "Album",
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

const album = [song("a"), song("b"), song("c"), song("d")];

const nothingInLibrary = (_song: YtSong): boolean => false;
/** The Library has only these songs of the album. */
const only =
  (...videoIds: string[]) =>
  ({ videoId }: YtSong): boolean =>
    videoIds.includes(videoId);
/** The Library has every song of the album but this one. */
const allBut =
  (missing: string) =>
  ({ videoId }: YtSong): boolean =>
    videoId !== missing;

const queued = (view: ReturnType<typeof ytAlbumDownload>) =>
  view.toDownload.map(({ song: { videoId }, sharedJob }) => [videoId, sharedJob]);
const retried = (view: ReturnType<typeof ytAlbumDownload>) =>
  view.toRetry.map(({ song: { videoId }, sharedJob }) => [videoId, sharedJob]);

/** The album page's button for [album], given the journal's [jobs]. */
const button = (jobs: YtDownloadJournalJob[], inLibrary = nothingInLibrary) =>
  ytAlbumDownloadButton(ytAlbumDownload(album, { inLibrary, jobs }));

describe("downloading a YT Music album", () => {
  test("an album the Library has none of offers Download Album, queueing every song in order", () => {
    const view = ytAlbumDownload(album, { inLibrary: nothingInLibrary, jobs: [] });
    assert.deepEqual(view.actions, ["downloadAlbum"]);
    assert.deepEqual(queued(view), [
      ["a", null],
      ["b", null],
      ["c", null],
      ["d", null],
    ]);
    assert.equal(view.line, null);
  });

  test("songs the Library already has are left out of the queue", () => {
    const view = ytAlbumDownload(album, {
      inLibrary: only("b", "d"),
      jobs: [],
    });
    assert.deepEqual(queued(view), [
      ["a", null],
      ["c", null],
    ]);
  });

  test("songs already queued or downloading keep their job instead of joining the queue again", () => {
    const view = ytAlbumDownload(album, {
      inLibrary: nothingInLibrary,
      jobs: [
        job("b"),
        job("x", { phase: "transferring", aliases: [song("d")] }),
        job("e", { phase: "tagging" }),
      ],
    });
    assert.deepEqual(queued(view), [
      ["a", null],
      ["c", null],
    ]);
  });

  test("a song that is the same recording as one already on its way shares that job", () => {
    // Search found the same recording under another video id and it's downloading.
    const elsewhere = { ...song("z", "Song c"), album: null };
    const view = ytAlbumDownload(album, {
      inLibrary: nothingInLibrary,
      jobs: [{ id: "z", song: elsewhere, phase: "transferring" }],
    });
    assert.deepEqual(queued(view), [
      ["a", null],
      ["b", null],
      ["c", "z"],
      ["d", null],
    ]);
  });

  test("the same recording twice on the album shares the job the first one starts", () => {
    const twice = [song("a"), song("b", "Song a"), song("c")];
    const view = ytAlbumDownload(twice, { inLibrary: nothingInLibrary, jobs: [] });
    assert.deepEqual(queued(view), [
      ["a", null],
      ["b", "a"],
      ["c", null],
    ]);
  });

  test("while its songs are on their way the album counts the ones saved and offers Cancel Album Download", () => {
    const jobs: YtDownloadJournalJob[] = [
      job("a", { phase: "completed", acknowledged: true, saved: { path: "/Music/a.mp3" } }),
      job("b", { phase: "tagging" }),
      job("c", { phase: "transferring", received: 10, total: 100 }),
      job("d"),
    ];
    const view = ytAlbumDownload([...album, song("e")], {
      inLibrary: only("a", "e"),
      jobs,
    });
    assert.equal(view.line, "Downloading · 1 of 4");
    assert.deepEqual(view.actions, ["cancelAlbumDownload"]);
    // Too late for "b": it's being saved.
    assert.deepEqual(view.toCancel, ["c", "d"]);
  });

  test("a song shared with a job under another video id counts and cancels as the album's", () => {
    const view = ytAlbumDownload(album, {
      inLibrary: allBut("c"),
      jobs: [{ id: "z", song: song("z", "Song c"), aliases: [song("c")], phase: "preparing" }],
    });
    assert.equal(view.line, "Downloading · 0 of 1");
    assert.deepEqual(view.toCancel, ["c"]);
  });

  test("once the batch ends, the songs that failed are retried together with Retry Failed", () => {
    const done = { phase: "completed", acknowledged: true, saved: { path: "/x.mp3" } } as const;
    const view = ytAlbumDownload(album, {
      inLibrary: only("a", "d"),
      jobs: [
        job("a", done),
        job("b", { phase: "failed", reason: "unavailable" }),
        job("c", { phase: "failed", reason: "offline" }),
        job("d", done),
      ],
    });
    assert.deepEqual(view.actions, ["retryFailed"]);
    assert.deepEqual(retried(view), [
      ["b", null],
      ["c", null],
    ]);
    assert.deepEqual(view.toDownload, []);
    assert.equal(view.line, null);
  });

  test("Retry Failed waits for the batch to end; a failed song keeps its own Retry meanwhile", () => {
    const view = ytAlbumDownload(album, {
      inLibrary: only("a", "d"),
      jobs: [job("b", { phase: "failed", reason: "unavailable" }), job("c")],
    });
    assert.deepEqual(view.actions, ["cancelAlbumDownload"]);
    assert.deepEqual(view.toCancel, ["c"]);
  });

  test("a song downloaded this session and since deleted from the Library can be downloaded again", () => {
    const view = ytAlbumDownload(album, {
      inLibrary: allBut("b"),
      jobs: [job("b", { phase: "completed", acknowledged: true, saved: { path: "/b.mp3" } })],
    });
    assert.deepEqual(view.actions, ["downloadAlbum"]);
    assert.deepEqual(queued(view), [["b", null]]);
  });

  test("a cancelled song leaves the batch and can be downloaded again; one the Library couldn't import failed", () => {
    const view = ytAlbumDownload(album, {
      inLibrary: only("c", "d"),
      jobs: [
        job("a", { phase: "cancelled" }),
        job("b", { phase: "completed", saved: { path: "/b.mp3" }, importFailure: "noFolder" }),
      ],
    });
    assert.deepEqual(view.actions, ["downloadAlbum", "retryFailed"]);
    assert.deepEqual(queued(view), [["a", null]]);
    assert.deepEqual(retried(view), [["b", null]]);
  });

  test("a failed song retried shares the job of the same recording already on its way", () => {
    const elsewhere = { ...song("z", "Song b"), album: null };
    const view = ytAlbumDownload(album, {
      inLibrary: only("a", "d"),
      jobs: [
        job("b", { phase: "failed", reason: "unavailable" }),
        job("c", { phase: "failed", reason: "offline" }),
        { id: "z", song: elsewhere, phase: "completed" },
      ],
    });
    assert.deepEqual(retried(view), [
      ["b", "z"],
      ["c", null],
    ]);
  });

  test("the same recording failing twice on the album is retried as one job", () => {
    const twice = [song("a"), song("b", "Song a")];
    const view = ytAlbumDownload(twice, {
      inLibrary: nothingInLibrary,
      jobs: [
        job("a", { phase: "failed", reason: "unavailable" }),
        job("b", { phase: "failed", reason: "unavailable" }),
      ],
    });
    assert.deepEqual(retried(view), [
      ["a", null],
      ["b", "a"],
    ]);
  });

  test("an album the Library has every song of no longer offers Download Album", () => {
    const view = ytAlbumDownload(album, { inLibrary: () => true, jobs: [] });
    assert.deepEqual(view.actions, []);
    assert.deepEqual(view.toDownload, []);
  });

  test("the menu names each album entry", () => {
    assert.deepEqual(YT_ALBUM_DOWNLOAD_ACTION_LABELS, {
      downloadAlbum: "Download Album",
      retryFailed: "Retry Failed",
      cancelAlbumDownload: "Cancel Album Download",
    });
  });

  test("the album page's button beside Play and Shuffle is the album's first entry, named short", () => {
    assert.deepEqual(button([]), { action: "downloadAlbum", label: "Download" });
    assert.deepEqual(button([job("a")], allBut("a")), {
      action: "cancelAlbumDownload",
      label: "Cancel",
    });
    assert.deepEqual(button([job("a", { phase: "failed" })], allBut("a")), {
      action: "retryFailed",
      label: "Retry Failed",
    });
  });

  test("with every song in the Library, the album page's button says Downloaded", () => {
    assert.deepEqual(
      button([], () => true),
      { action: "downloaded", label: "Downloaded" },
    );
  });

  test("an album with nothing to offer that isn't all in the Library has no button", () => {
    // The last song is being saved: nothing to cancel, nothing downloaded yet.
    assert.equal(button([job("a", { phase: "publishing" })], allBut("a")), null);
    assert.equal(
      ytAlbumDownloadButton(ytAlbumDownload([], { inLibrary: () => true, jobs: [] })),
      null,
    );
  });
});
