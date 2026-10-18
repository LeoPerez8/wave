import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  FAVORITES_DOWNLOAD_ORIGIN,
  downloadingList,
  readStarDownloads,
  starredDownload,
  unstarredDownload,
  writeStarDownloads,
  type YtDownloadJournalJob,
  type YtDownloadStatus,
} from "./index.ts";

const waiting: YtDownloadStatus = { kind: "queued" };
const transferring: YtDownloadStatus = {
  kind: "downloading",
  received: 1_000,
  total: 4_000,
  phase: "transferring",
};
const saving: YtDownloadStatus = { kind: "saving" };
const failed: YtDownloadStatus = { kind: "failed", reason: "offline" };
const done: YtDownloadStatus = { kind: "done", path: "/music/Daft Punk/Touch.m4a" };

describe("starredDownload", () => {
  test("starring a song never asked for queues its download, which only the star asked for", () => {
    assert.equal(starredDownload(null), "queue");
  });

  test("a song already waiting, downloading or saving just gets the star", () => {
    assert.equal(starredDownload(waiting), "keep");
    assert.equal(starredDownload(transferring), "keep");
    assert.equal(starredDownload(saving), "keep");
  });

  test("a failed download is asked for again, keeping where it was asked from", () => {
    assert.equal(starredDownload(failed), "retry");
  });

  test("a song downloaded before and gone from the Library since downloads again", () => {
    assert.equal(starredDownload(done), "queue");
  });
});

describe("unstarredDownload", () => {
  test("unstarring before the file arrives cancels a download only the star asked for", () => {
    assert.equal(unstarredDownload(waiting, { starAsked: true }), "cancel");
    assert.equal(unstarredDownload(transferring, { starAsked: true }), "cancel");
  });

  test("a download the owner asked for separately carries on", () => {
    assert.equal(unstarredDownload(waiting, { starAsked: false }), "keep");
    assert.equal(unstarredDownload(transferring, { starAsked: false }), "keep");
  });

  test("a failure only the star asked for leaves the failed list with it", () => {
    assert.equal(unstarredDownload(failed, { starAsked: true }), "cancel");
    assert.equal(unstarredDownload(failed, { starAsked: false }), "keep");
  });

  test("a song already saving to the Library is too late to cancel", () => {
    assert.equal(unstarredDownload(saving, { starAsked: true }), "keep");
  });

  test("with no download on its way there's nothing to cancel", () => {
    assert.equal(unstarredDownload(null, { starAsked: true }), "keep");
    assert.equal(unstarredDownload(done, { starAsked: true }), "keep");
  });
});

describe("readStarDownloads / writeStarDownloads", () => {
  test("the downloads only a star asked for are kept by job id", () => {
    const kept = writeStarDownloads(new Set(["touch", "missing:7"]));
    assert.deepEqual([...readStarDownloads(kept)], ["touch", "missing:7"]);
  });

  test("none kept stores nothing", () => {
    assert.equal(writeStarDownloads(new Set()), null);
    assert.deepEqual([...readStarDownloads(null)], []);
  });

  test("what can't be read counts as none, and stray entries are left out", () => {
    assert.deepEqual([...readStarDownloads("{oops")], []);
    assert.deepEqual([...readStarDownloads('{"touch":true}')], []);
    assert.deepEqual([...readStarDownloads('["touch", 7, null]')], ["touch"]);
  });
});

describe("FAVORITES_DOWNLOAD_ORIGIN", () => {
  test("songs a star queued wait under Favorites in Downloading", () => {
    const job = (id: string): YtDownloadJournalJob => ({
      id,
      song: {
        videoId: id,
        title: id,
        artists: ["Daft Punk"],
        album: null,
        durationMs: null,
        artworkUrl: null,
        explicit: false,
      },
      phase: "queued",
      origin: FAVORITES_DOWNLOAD_ORIGIN,
    });
    const { groups } = downloadingList([job("touch"), job("crush")]);
    assert.deepEqual(
      groups.map((group) => [group.name, group.line]),
      [["Favorites", "2 songs left"]],
    );
  });
});
