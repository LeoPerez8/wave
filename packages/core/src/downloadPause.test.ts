import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  NO_DOWNLOAD_PAUSE,
  cancelAllDownloadsAlert,
  cancelGroupDownloadsAlert,
  downloadGroupControls,
  downloadGroupPaused,
  downloadsToCancelAll,
  downloadsToCancelInGroup,
  pauseDownloadGroup,
  requestResumesGroup,
  resumeDownloadGroup,
  downloadHeld,
  downloadRequested,
  requestRunsWhilePaused,
  pauseAllDownloads,
  resumeAllDownloads,
} from "./index.ts";
import type { YtDownloadJournalJob, YtSong } from "./index.ts";

const song = (videoId: string): YtSong => ({
  videoId,
  title: `Song ${videoId}`,
  artists: ["Artist"],
  album: null,
  durationMs: null,
  artworkUrl: null,
  explicit: false,
});

const job = (videoId: string, patch: Partial<YtDownloadJournalJob> = {}): YtDownloadJournalJob => ({
  id: videoId,
  song: song(videoId),
  phase: "queued",
  ...patch,
});

describe("Pause in Settings › Downloads and the notification", () => {
  test("nothing is held until Pause", () => {
    assert.equal(downloadHeld(NO_DOWNLOAD_PAUSE, job("a")), false);
  });

  test("Pause holds every song waiting or downloading", () => {
    const paused = pauseAllDownloads(NO_DOWNLOAD_PAUSE);
    for (const phase of ["queued", "preparing", "prepared", "transferring"] as const)
      assert.equal(downloadHeld(paused, job("a", { phase })), true, phase);
  });

  test("a song already downloaded finishes saving", () => {
    const paused = pauseAllDownloads(NO_DOWNLOAD_PAUSE);
    for (const phase of ["sourceReady", "tagging", "awaitingPublication", "publishing"] as const)
      assert.equal(downloadHeld(paused, job("a", { phase })), false, phase);
    assert.equal(downloadHeld(paused, job("a", { phase: "completed" })), false);
    assert.equal(downloadHeld(paused, job("a", { phase: "failed" })), false);
  });

  test("Resume holds nothing again", () => {
    const resumed = resumeAllDownloads(pauseAllDownloads(NO_DOWNLOAD_PAUSE));
    assert.equal(downloadHeld(resumed, job("a")), false);
    assert.deepEqual(resumed, NO_DOWNLOAD_PAUSE);
  });
});

describe("A new request while paused", () => {
  const paused = pauseAllDownloads(NO_DOWNLOAD_PAUSE);

  test("a song, a list's Download and a star download their songs, and the rest stays paused", () => {
    for (const request of ["song", "list", "star"] as const) {
      assert.equal(requestRunsWhilePaused(request), true, request);
      const pause = downloadRequested(paused, ["a"], request);
      assert.equal(downloadHeld(pause, job("a")), false, request);
      assert.equal(downloadHeld(pause, job("b")), true, request);
    }
  });

  test("Retry, quality replacements and Wave's own requeues stay paused", () => {
    for (const request of ["retry", "quality", "background"] as const) {
      assert.equal(requestRunsWhilePaused(request), false, request);
      assert.equal(
        downloadHeld(downloadRequested(paused, ["a"], request), job("a")),
        true,
        request,
      );
    }
  });

  test("asking while not paused changes nothing", () => {
    assert.deepEqual(downloadRequested(NO_DOWNLOAD_PAUSE, ["a"], "song"), NO_DOWNLOAD_PAUSE);
  });

  test("Pause again holds the songs asked for in between", () => {
    const again = pauseAllDownloads(downloadRequested(paused, ["a"], "song"));
    assert.equal(downloadHeld(again, job("a", { phase: "transferring" })), true);
  });

  test("Resume forgets them", () => {
    assert.deepEqual(
      resumeAllDownloads(downloadRequested(paused, ["a"], "song")),
      NO_DOWNLOAD_PAUSE,
    );
  });
});

describe("Cancel All", () => {
  test("removes every song waiting or downloading, and leaves the downloaded and failed ones", () => {
    const jobs = [
      job("waiting"),
      job("starting", { phase: "preparing" }),
      job("downloading", { phase: "transferring" }),
      job("downloaded", { phase: "tagging" }),
      job("saving", { phase: "publishing" }),
      job("done", { phase: "completed", acknowledged: true }),
      job("failed", { phase: "failed", reason: "failed" }),
      job("notImported", { phase: "completed", importFailure: "failed" }),
    ];
    assert.deepEqual(downloadsToCancelAll(jobs), ["waiting", "starting", "downloading"]);
  });

  test("Downloads asks first, saying how many", () => {
    assert.deepEqual(cancelAllDownloadsAlert(12), {
      title: "Cancel 12 downloads?",
      message: "Songs already downloaded stay, and failed songs stay in the failed list.",
      action: { label: "Cancel All", destructive: true },
      dismissLabel: "Keep Downloading",
    });
    assert.equal(cancelAllDownloadsAlert(1).title, "Cancel 1 download?");
    assert.equal(cancelAllDownloadsAlert(1_234, "pt-BR").title, "Cancelar 1.234 downloads?");
    assert.equal(cancelAllDownloadsAlert(1, "pt-BR").title, "Cancelar 1 download?");
  });
});

const from = (kind: "playlist" | "album", id: string) => ({ kind, id, name: `${kind} ${id}` });
const mine = (videoId: string, patch: Partial<YtDownloadJournalJob> = {}) =>
  job(videoId, { origin: from("playlist", "1"), ...patch });
const theirs = (videoId: string, patch: Partial<YtDownloadJournalJob> = {}) =>
  job(videoId, { origin: from("album", "2"), ...patch });

describe("Pause on one playlist's or album's downloads", () => {
  const paused = pauseDownloadGroup(NO_DOWNLOAD_PAUSE, "playlist:1", []);

  test("holds only that group's songs, and the others go on", () => {
    assert.equal(downloadHeld(paused, mine("a")), true);
    assert.equal(downloadHeld(paused, mine("b", { phase: "transferring" })), true);
    assert.equal(downloadHeld(paused, theirs("c")), false);
    assert.equal(downloadHeld(paused, job("d")), false);
    assert.equal(downloadGroupPaused(paused, "playlist:1"), true);
    assert.equal(downloadGroupPaused(paused, "album:2"), false);
  });

  test("Songs, the songs asked for on their own, pause as a group too", () => {
    const songs = pauseDownloadGroup(NO_DOWNLOAD_PAUSE, "songs", []);
    assert.equal(downloadHeld(songs, job("a")), true);
    assert.equal(downloadHeld(songs, mine("b")), false);
  });

  test("a song already downloaded finishes saving", () => {
    assert.equal(downloadHeld(paused, mine("a", { phase: "tagging" })), false);
  });

  test("Resume on the group restarts it", () => {
    const resumed = resumeDownloadGroup(paused, "playlist:1");
    assert.equal(downloadHeld(resumed, mine("a")), false);
    assert.deepEqual(resumed, NO_DOWNLOAD_PAUSE);
  });

  test("the global Resume resumes every paused group", () => {
    const both = pauseDownloadGroup(paused, "album:2", []);
    assert.deepEqual(resumeAllDownloads(both), NO_DOWNLOAD_PAUSE);
    assert.equal(downloadHeld(resumeAllDownloads(both), theirs("c")), false);
  });

  test("the global Pause keeps the paused groups paused", () => {
    const all = pauseAllDownloads(paused);
    assert.equal(downloadGroupPaused(all, "playlist:1"), true);
    assert.equal(downloadHeld(all, theirs("c")), true);
  });

  test("Download Playlist again resumes that playlist, and only it", () => {
    const both = pauseDownloadGroup(paused, "album:2", []);
    const asked = downloadRequested(both, ["a"], "list", from("playlist", "1"));
    assert.equal(downloadGroupPaused(asked, "playlist:1"), false);
    assert.equal(downloadHeld(asked, mine("x")), false);
    assert.equal(downloadHeld(asked, theirs("c")), true);
  });

  test("a list asked for with no origin (Download All) resumes Songs, as the journal does", () => {
    const songs = pauseDownloadGroup(paused, "songs", []);
    const asked = downloadRequested(songs, ["a"], "list", null);
    assert.equal(downloadGroupPaused(asked, "songs"), false);
    assert.equal(downloadHeld(asked, job("b")), false);
    assert.equal(downloadGroupPaused(asked, "playlist:1"), true);
  });

  test("a song asked for on its own downloads, and the rest of its group stays paused", () => {
    const asked = downloadRequested(paused, ["a"], "song");
    assert.equal(downloadHeld(asked, mine("a")), false);
    assert.equal(downloadHeld(asked, mine("b")), true);
    assert.equal(downloadGroupPaused(asked, "playlist:1"), true);
  });

  test("Retry in a paused group stays paused", () => {
    const asked = downloadRequested(paused, ["a"], "retry", from("playlist", "1"));
    assert.equal(downloadHeld(asked, mine("a")), true);
    assert.equal(requestResumesGroup("retry"), false);
    assert.equal(requestResumesGroup("list"), true);
  });

  test("pausing the group again holds its songs asked for in between", () => {
    const asked = downloadRequested(paused, ["a"], "song");
    const again = pauseDownloadGroup(resumeDownloadGroup(asked, "playlist:1"), "playlist:1", [
      mine("a"),
    ]);
    assert.equal(downloadHeld(again, mine("a")), true);
  });

  test("Cancel takes the group's waiting and downloading songs, and leaves the rest", () => {
    const jobs = [
      mine("waiting"),
      mine("downloading", { phase: "transferring" }),
      mine("saving", { phase: "publishing" }),
      mine("done", { phase: "completed", acknowledged: true }),
      mine("failed", { phase: "failed", reason: "failed" }),
      theirs("other"),
      job("alone"),
    ];
    assert.deepEqual(downloadsToCancelInGroup(jobs, "playlist:1"), ["waiting", "downloading"]);
    assert.deepEqual(downloadsToCancelInGroup(jobs, "songs"), ["alone"]);
  });

  test("Cancel asks first, saying how many", () => {
    assert.deepEqual(cancelGroupDownloadsAlert(3), {
      title: "Cancel 3 downloads?",
      message: "Songs already downloaded stay.",
      action: { label: "Cancel Downloads", destructive: true },
      dismissLabel: "Keep Downloading",
    });
    assert.equal(cancelGroupDownloadsAlert(1, "pt-BR").title, "Cancelar 1 download?");
  });
});

describe("A group's controls", () => {
  test("none while nothing of the group is waiting or downloading", () => {
    assert.equal(
      downloadGroupControls(NO_DOWNLOAD_PAUSE, [mine("a", { phase: "completed" })], "playlist:1"),
      null,
    );
  });

  test("Pause and Cancel while its songs are on their way", () => {
    assert.deepEqual(
      downloadGroupControls(NO_DOWNLOAD_PAUSE, [mine("a"), theirs("b")], "playlist:1"),
      { paused: false, toCancel: ["a"] },
    );
  });

  test("Resume once it's paused, or the global Pause holds it", () => {
    const paused = pauseDownloadGroup(NO_DOWNLOAD_PAUSE, "playlist:1", []);
    assert.deepEqual(downloadGroupControls(paused, [mine("a")], "playlist:1"), {
      paused: true,
      toCancel: ["a"],
    });
    assert.equal(
      downloadGroupControls(pauseAllDownloads(NO_DOWNLOAD_PAUSE), [mine("a")], "playlist:1")
        ?.paused,
      true,
    );
  });
});
