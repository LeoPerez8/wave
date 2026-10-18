import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  FAVORITES_DOWNLOAD_ORIGIN,
  downloadingList,
  readStarDownloads,
  readSyncedStars,
  starAskedAfter,
  starredDownload,
  starredHere,
  syncedStarDownloads,
  unstarredDownload,
  writeStarDownloads,
  writeSyncedStars,
  ytSongStarred,
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

describe("syncedStarDownloads", () => {
  /** The Library after a pull: tracks 1, 2 and 3 are missing songs; 4 and 5 have files. */
  const missing = [3, 1, 2];

  test("signing in on a phone with no files downloads every starred missing song", () => {
    const { download } = syncedStarDownloads({ starred: new Set([1, 3, 4]), missing }, new Set());
    assert.deepEqual(download, [3, 1]);
  });

  test("a star this phone has seen asks once: a download cancelled or cleared since isn't asked for again", () => {
    const first = syncedStarDownloads({ starred: new Set([1, 3]), missing }, new Set());
    const later = syncedStarDownloads({ starred: new Set([1, 2, 3]), missing }, first.seen);
    assert.deepEqual(later.download, [2]);
  });

  test("a star taken off (on any phone) takes back its download; starred again, it asks again", () => {
    const starred = syncedStarDownloads({ starred: new Set([1, 3]), missing }, new Set());
    const unstarred = syncedStarDownloads({ starred: new Set([3]), missing }, starred.seen);
    assert.deepEqual(unstarred.cancel, [1]);
    assert.deepEqual(unstarred.download, []);
    const again = syncedStarDownloads({ starred: new Set([1, 3]), missing }, unstarred.seen);
    assert.deepEqual(again.download, [1]);
    assert.deepEqual(again.cancel, []);
  });

  test("a song whose file arrived, or that left the Library, is seen no more", () => {
    const starred = syncedStarDownloads({ starred: new Set([1, 3]), missing }, new Set());
    const after = syncedStarDownloads({ starred: new Set([1, 3]), missing: [2] }, starred.seen);
    assert.deepEqual([...after.seen], []);
  });
});

describe("starredHere", () => {
  const missing = [3, 1, 2];

  test("a missing song starred here has asked already: the next sync doesn't ask again", () => {
    const seen = starredHere(new Set(), [1], true);
    const { download } = syncedStarDownloads({ starred: new Set([1]), missing }, seen);
    assert.deepEqual(download, []);
  });

  test("starred here, then unstarred on another phone before the file arrives: the sync takes the download back", () => {
    const seen = starredHere(new Set([3]), [1], true);
    const { cancel } = syncedStarDownloads({ starred: new Set([3]), missing }, seen);
    assert.deepEqual(cancel, [1]);
  });

  test("unstarred here, the unstar took the download back already: the sync has nothing to cancel", () => {
    const seen = starredHere(new Set([1, 3]), [1], false);
    const { cancel } = syncedStarDownloads({ starred: new Set([3]), missing }, seen);
    assert.deepEqual(cancel, []);
  });
});

describe("starAskedAfter", () => {
  test("the downloads a star queued are the star's", () => {
    const asked = starAskedAfter(new Set(["a"]), { kind: "starred", queued: ["b", "missing:4"] });
    assert.deepEqual([...asked].toSorted(), ["a", "b", "missing:4"]);
  });

  test("the owner asking for a download takes it from the star: unstarring then keeps it", () => {
    const starred = starAskedAfter(new Set(), { kind: "starred", queued: ["b"] });
    const owned = starAskedAfter(starred, { kind: "ownerAsked", ids: ["b"] });
    assert.deepEqual([...owned], []);
    assert.equal(unstarredDownload(waiting, { starAsked: owned.has("b") }), "keep");
  });

  test("unstarring lets go of the songs' downloads, whether cancelled or kept", () => {
    const asked = starAskedAfter(new Set(["a", "b"]), { kind: "unstarred", ids: ["b", "c"] });
    assert.deepEqual([...asked], ["a"]);
  });

  test("a change that touches nothing gives back the same set", () => {
    const asked = new Set(["a"]);
    assert.equal(starAskedAfter(asked, { kind: "ownerAsked", ids: ["b"] }), asked);
    assert.equal(starAskedAfter(asked, { kind: "starred", queued: [] }), asked);
  });
});

describe("ytSongStarred", () => {
  test("a YT Music song is starred as its pending favorite", () => {
    assert.equal(ytSongStarred("v1", null, new Set(), new Set(["v1"])), true);
    assert.equal(ytSongStarred("v1", null, new Set([7]), new Set()), false);
  });

  test("once the Library has it, the Library song's star counts", () => {
    assert.equal(ytSongStarred("v1", { id: 7 }, new Set([7]), new Set()), true);
    assert.equal(ytSongStarred("v1", { id: 7 }, new Set(), new Set()), false);
  });

  test("while the arriving file settles its pending favorite, the star stays lit", () => {
    assert.equal(ytSongStarred("v1", { id: 7 }, new Set(), new Set(["v1"])), true);
  });
});

describe("readSyncedStars / writeSyncedStars", () => {
  test("the starred missing songs seen are kept by track id", () => {
    assert.deepEqual([...readSyncedStars(writeSyncedStars(new Set([3, 1])))], [3, 1]);
  });

  test("none kept stores nothing, and what can't be read counts as none", () => {
    assert.equal(writeSyncedStars(new Set()), null);
    assert.deepEqual([...readSyncedStars(null)], []);
    assert.deepEqual([...readSyncedStars("{oops")], []);
    assert.deepEqual([...readSyncedStars('[3, "1", null, 2.5]')], [3]);
  });
});
