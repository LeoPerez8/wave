import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  QUALITY_ORIGINS,
  downloadingList,
  failedDownloads,
  formatStorageSize,
  noBetterCopies,
  qualityJobsToCancel,
  qualityReplacementJob,
  qualityReplacementTags,
  qualityReplacementTarget,
  qualityUpgradeOffer,
  qualityUpgradeSongs,
  settledDownloadFailures,
} from "./index.ts";
import type { QualityFile, ReplacedTrack, YtDownloadJournalJob } from "./index.ts";

const file = (id: number, patch: Partial<QualityFile> = {}): QualityFile => ({
  id,
  path: `/Music/Song ${id}.m4a`,
  durationMs: 200_000,
  bitrateKbps: 128,
  sizeBytes: 3_200_000,
  ...patch,
});

const none = { noBetterCopy: new Set<number>(), jobs: [] };

describe("qualityUpgradeSongs", () => {
  test("offers a 128k YouTube download and keeps an AAC 256k one", () => {
    const youtube = file(1, { bitrateKbps: 129 });
    const premium = file(2, { bitrateKbps: 256 });
    assert.deepEqual(qualityUpgradeSongs([youtube, premium], none), [youtube]);
  });

  test("offers MP3s at 192k or less, whoever put them there", () => {
    const songs = [
      file(1, { path: "/Music/a.mp3", bitrateKbps: 192 }),
      file(2, { path: "/Music/b.mp3", bitrateKbps: 160 }),
      file(3, { path: "/Music/c.mp3", bitrateKbps: 224 }),
    ];
    assert.deepEqual(
      qualityUpgradeSongs(songs, none).map((song) => song.id),
      [1, 2, 3],
    );
  });

  test("keeps MP3 320, lossless files and files whose bitrate isn't known", () => {
    const songs = [
      file(1, { path: "/Music/a.mp3", bitrateKbps: 320 }),
      file(2, { path: "/Music/b.flac", bitrateKbps: 120 }),
      file(3, { path: "/Music/c.WAV", bitrateKbps: 64 }),
      file(4, { bitrateKbps: null }),
      file(5, { bitrateKbps: 0 }),
    ];
    assert.deepEqual(qualityUpgradeSongs(songs, none), []);
  });

  test("an AAC 256k file whose header averages a little under 256 still stays", () => {
    assert.deepEqual(qualityUpgradeSongs([file(1, { bitrateKbps: 251 })], none), []);
  });

  test("never offers a song recorded as having no better copy", () => {
    const songs = [file(1), file(2)];
    assert.deepEqual(
      qualityUpgradeSongs(songs, { noBetterCopy: new Set([1]), jobs: [] }).map((song) => song.id),
      [2],
    );
  });

  test("leaves out songs whose upgrade is already on its way, but not a failed one", () => {
    const songs = [file(1), file(2), file(3)];
    const jobs: YtDownloadJournalJob[] = [
      job("upgrade:1", { phase: "queued" }),
      job("upgrade:2", { phase: "failed", reason: "offline" }),
    ];
    assert.deepEqual(
      qualityUpgradeSongs(songs, { noBetterCopy: new Set(), jobs }).map((song) => song.id),
      [2, 3],
    );
  });
});

describe("qualityUpgradeOffer", () => {
  // 320 kbps is 40,000 bytes a second: a 200 s song is 8,000,000 bytes.
  test("estimates the difference to 320 kbps over the songs' lengths", () => {
    const offer = qualityUpgradeOffer([file(1, { sizeBytes: 3_200_000 })], { onMobileData: false });
    assert.equal(offer?.bytes, 4_800_000);
    assert.equal(offer?.downloadBytes, 8_000_000);
    assert.deepEqual(offer?.trackIds, [1]);
  });

  test("asks with the count and the estimate, Replace or Not now", () => {
    const songs = Array.from({ length: 342 }, (_, index) =>
      // 342 × (12,000,000 − 8,500,000) = 1,197,000,000 bytes.
      file(index + 1, { durationMs: 300_000, sizeBytes: 8_500_000 }),
    );
    const offer = qualityUpgradeOffer(songs, { onMobileData: false });
    assert.deepEqual(offer?.alert, {
      title: "Replace 342 songs with best quality?",
      message: "About +1.2 GB",
      action: { label: "Replace" },
      dismissLabel: "Not now",
    });
    assert.equal(offer?.row, "Replace 342 songs with best quality");
  });

  test("says one song, and a few MB", () => {
    const offer = qualityUpgradeOffer([file(1)], { onMobileData: false });
    assert.equal(offer?.alert.title, "Replace 1 song with best quality?");
    assert.equal(offer?.alert.message, "About +5 MB");
    assert.equal(offer?.row, "Replace 1 song with best quality");
  });

  test("works the size out from the bitrate when the file's size isn't known", () => {
    // 128 kbps over 200 s is 3,200,000 bytes.
    const offer = qualityUpgradeOffer([file(1, { sizeBytes: 0 })], { onMobileData: false });
    assert.equal(offer?.bytes, 4_800_000);
  });

  test("on mobile data, says how much it downloads and that the phone isn't on Wi-Fi", () => {
    const offer = qualityUpgradeOffer([file(1)], { onMobileData: true });
    assert.equal(
      offer?.alert.message,
      "About +5 MB. It downloads about 8 MB, and the phone isn't on Wi-Fi.",
    );
  });

  test("offers nothing when no song qualifies", () => {
    assert.equal(qualityUpgradeOffer([], { onMobileData: true }), null);
  });
});

describe("formatStorageSize", () => {
  test("whole MB under a GB, one decimal from a GB", () => {
    assert.equal(formatStorageSize(900_000_000), "900 MB");
    assert.equal(formatStorageSize(999_700_000), "1 GB");
    assert.equal(formatStorageSize(1_250_000_000), "1.3 GB");
    assert.equal(formatStorageSize(12_000_000_000), "12 GB");
    assert.equal(formatStorageSize(300_000), "1 MB");
  });
});

const track = (patch: Partial<ReplacedTrack> = {}): ReplacedTrack => ({
  id: 7,
  path: "/Music/Artist/Album/03 Song.m4a",
  title: "Song",
  artist: "Artist feat. Guest",
  artists: ["Artist", "Guest"],
  album: "Album",
  albumArtist: "Artist",
  year: 2019,
  trackNumber: 3,
  discNumber: 1,
  genre: "Pop",
  durationMs: 200_000,
  videoId: "abc",
  explicit: "explicit",
  artworkPath: "/data/artwork/hash.jpg",
  ...patch,
});

describe("qualityReplacementJob", () => {
  test("a job named after the Track it replaces, shaped as a song for the journal", () => {
    assert.deepEqual(qualityReplacementJob("upgrade", track()), {
      videoId: "upgrade:7",
      title: "Song",
      artists: ["Artist", "Guest"],
      album: "Album",
      durationMs: 200_000,
      artworkUrl: null,
      explicit: false,
    });
  });

  test("a song without an album or a length searches without them", () => {
    const song = qualityReplacementJob("upgrade", track({ album: "Unknown Album", durationMs: 0 }));
    assert.equal(song.album, null);
    assert.equal(song.durationMs, null);
  });

  test("its runs wait in Settings › Downloads under Quality upgrade", () => {
    const jobs: YtDownloadJournalJob[] = [
      job("upgrade:1", { origin: QUALITY_ORIGINS.upgrade }),
      job("upgrade:2", { origin: QUALITY_ORIGINS.upgrade }),
    ];
    assert.deepEqual(
      downloadingList(jobs).groups.map((group) => [group.name, group.line]),
      [["Quality upgrade", "2 songs left"]],
    );
  });
});

describe("qualityReplacementTarget", () => {
  test("an MP3 replacing an M4A goes beside it under the same name", () => {
    assert.deepEqual(qualityReplacementTarget("/Music/A/03 Song.m4a", "soulseek"), {
      targetPath: "/Music/A/03 Song.mp3",
      replaces: null,
    });
  });

  test("an MP3 replacing an MP3 takes its place", () => {
    assert.deepEqual(qualityReplacementTarget("/Music/A/03 Song.MP3", "soulseek"), {
      targetPath: "/Music/A/03 Song.MP3",
      replaces: "/Music/A/03 Song.MP3",
    });
  });

  test("YouTube Music's copy is an M4A", () => {
    assert.deepEqual(qualityReplacementTarget("/Music/A/Song.mp3", "youtube"), {
      targetPath: "/Music/A/Song.m4a",
      replaces: null,
    });
  });
});

describe("qualityReplacementTags", () => {
  test("the new file keeps the old one's tags, artwork and lyrics", () => {
    assert.deepEqual(qualityReplacementTags(track(), { embedded: "Plain words", sidecar: null }), {
      title: "Song",
      artist: "Artist feat. Guest",
      album: "Album",
      albumArtist: "Artist",
      year: 2019,
      trackNumber: 3,
      discNumber: 1,
      genre: "Pop",
      lyrics: "Plain words",
      artworkUrl: "/data/artwork/hash.jpg",
      advisory: 1,
    });
  });

  test("synced lyrics in a sidecar win, as the Lyrics view picks them", () => {
    const tags = qualityReplacementTags(track(), {
      embedded: "Plain words",
      sidecar: "[00:01.00]Synced words",
    });
    assert.equal(tags.lyrics, "[00:01.00]Synced words");
  });

  test("an unsynced sidecar stands in only for no lyrics in the tags", () => {
    assert.equal(
      qualityReplacementTags(track(), { embedded: "  ", sidecar: "Sidecar words" }).lyrics,
      "Sidecar words",
    );
    assert.equal(qualityReplacementTags(track(), { embedded: null, sidecar: null }).lyrics, null);
  });

  test("an album-less song gets no album tag, and a never-checked one no advisory", () => {
    const tags = qualityReplacementTags(
      track({ album: "Unknown Album", explicit: "unknown", artworkPath: null }),
      { embedded: null, sidecar: null },
    );
    assert.equal(tags.album, null);
    assert.equal(tags.advisory, null);
    assert.equal(tags.artworkUrl, null);
  });
});

describe("noBetterCopies", () => {
  test("remembers a song Soulseek has no 320 copy of, and one that failed after retries", () => {
    const jobs = [
      job("upgrade:1", { phase: "failed", reason: "notFound" }),
      job("upgrade:2", { phase: "failed", reason: "timedOut" }),
      job("upgrade:3", { phase: "completed", importFailure: "failed" }),
    ];
    assert.deepEqual(noBetterCopies(jobs), [
      { direction: "upgrade", trackId: 1 },
      { direction: "upgrade", trackId: 2 },
      { direction: "upgrade", trackId: 3 },
    ]);
  });

  test("forgets nothing for the phone's own trouble, a cancel, or another job", () => {
    const jobs = [
      job("upgrade:1", { phase: "failed", reason: "offline" }),
      job("upgrade:2", { phase: "failed", reason: "storage" }),
      job("upgrade:3", { phase: "failed", reason: "noSource" }),
      job("upgrade:4", { phase: "failed", reason: "account" }),
      job("upgrade:5", { phase: "cancelled" }),
      job("upgrade:6", { phase: "queued" }),
      job("missing:7", { phase: "failed", reason: "unavailable" }),
      job("videoId", { phase: "failed", reason: "unavailable" }),
    ];
    assert.deepEqual(noBetterCopies(jobs), []);
  });
});

describe("qualityJobsToCancel", () => {
  test("turning the switch back cancels the waiting upgrades, not those saving or other jobs", () => {
    const jobs = [
      job("upgrade:1", { phase: "queued" }),
      job("upgrade:2", { phase: "transferring" }),
      job("upgrade:3", { phase: "publishing" }),
      job("upgrade:4", { phase: "failed", reason: "timedOut" }),
      job("downgrade:5", { phase: "queued" }),
      job("song", { phase: "queued" }),
    ];
    assert.deepEqual(qualityJobsToCancel(jobs, "upgrade"), ["upgrade:1", "upgrade:2"]);
  });
});

describe("a replacement's failure in Settings › Downloads", () => {
  const input = { inLibrary: () => true, missingTrackIds: new Set<number>() };

  test("one that failed after retries is listed, to retry as a replacement", () => {
    const failed = failedDownloads(
      [job("upgrade:2", { phase: "failed", reason: "timedOut" })],
      input,
    );
    assert.deepEqual(
      failed.map((each) => each.retry),
      [{ kind: "quality", direction: "upgrade", trackId: 2 }],
    );
  });

  test("no better copy isn't a failure: the song keeps its file, and the journal forgets the job", () => {
    const jobs = [job("upgrade:1", { phase: "failed", reason: "notFound" })];
    assert.deepEqual(failedDownloads(jobs, input), []);
    assert.deepEqual(settledDownloadFailures(jobs, input), ["upgrade:1"]);
  });

  test("every peer failing is a failure after retries, listed", () => {
    const jobs = [job("upgrade:1", { phase: "failed", reason: "unavailable" })];
    assert.deepEqual(
      failedDownloads(jobs, input).map((each) => each.id),
      ["upgrade:1"],
    );
    assert.deepEqual(settledDownloadFailures(jobs, input), []);
  });
});

function job(id: string, patch: Partial<YtDownloadJournalJob> = {}): YtDownloadJournalJob {
  return {
    id,
    song: {
      videoId: id,
      title: "Song",
      artists: ["Artist"],
      album: null,
      durationMs: 200_000,
      artworkUrl: null,
      explicit: false,
    },
    phase: "queued",
    ...patch,
  };
}
