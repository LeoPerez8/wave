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
  qualityDowngradeOffer,
  qualityDowngradeSearch,
  qualityDowngradeSongs,
  qualityDowngradeVideo,
  qualityUpgradeOffer,
  youTubeCopyKbps,
  qualityUpgradeSongs,
  settledDownloadFailures,
} from "./index.ts";
import type { QualityFile, ReplacedTrack, YtDownloadJournalJob, YtSong } from "./index.ts";

const file = (id: number, patch: Partial<QualityFile> = {}): QualityFile => ({
  id,
  path: `/Music/Song ${id}.m4a`,
  durationMs: 200_000,
  bitrateKbps: 128,
  sizeBytes: 3_200_000,
  ...patch,
});

const none = { noBetterCopy: new Set<number>(), jobs: [] };

const mp3 = (id: number, patch: Partial<QualityFile> = {}): QualityFile =>
  file(id, { path: `/Music/Song ${id}.mp3`, bitrateKbps: 320, sizeBytes: 8_000_000, ...patch });

// MP3 320 over 300 s is 12,000,000 bytes; 128 kbps is 4,800,000, 256 kbps 9,600,000.
const mp3s = (count: number): QualityFile[] =>
  Array.from({ length: count }, (_, index) =>
    file(index + 1, {
      path: `/Music/${index}.mp3`,
      durationMs: 300_000,
      bitrateKbps: 320,
      sizeBytes: 12_000_000,
    }),
  );

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
    const aac = file(2, { path: "/Music/b.aac", bitrateKbps: 249 });
    assert.deepEqual(qualityUpgradeSongs([aac], none), []);
  });

  test("an MP3 or any other file averaging under 256 is offered: the slack is AAC's", () => {
    const songs = [
      file(1, { path: "/Music/a.mp3", bitrateKbps: 250 }),
      file(2, { path: "/Music/b.mp3", bitrateKbps: 255 }),
      file(3, { path: "/Music/c.ogg", bitrateKbps: 251 }),
      file(4, { path: "/Music/d.mp3", bitrateKbps: 256 }),
    ];
    assert.deepEqual(
      qualityUpgradeSongs(songs, none).map((song) => song.id),
      [1, 2, 3],
    );
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

describe("qualityDowngradeSongs", () => {
  test("offers MP3s at 320 kbps, wherever they came from", () => {
    const songs = [mp3(1), mp3(2, { path: "/Music/b.MP3", bitrateKbps: 319 })];
    assert.deepEqual(
      qualityDowngradeSongs(songs, none).map((song) => song.id),
      [1, 2],
    );
  });

  test("never offers lossless files, AAC copies or smaller MP3s", () => {
    const songs = [
      file(1, { path: "/Music/a.flac", bitrateKbps: 900 }),
      file(2, { path: "/Music/b.m4a", bitrateKbps: 256 }),
      file(3, { path: "/Music/c.m4a", bitrateKbps: 320 }),
      mp3(4, { bitrateKbps: 256 }),
      mp3(5, { bitrateKbps: 192 }),
      mp3(6, { bitrateKbps: null }),
    ];
    assert.deepEqual(qualityDowngradeSongs(songs, none), []);
  });

  test("leaves out a song whose length isn't known: YouTube Music's match needs it", () => {
    assert.deepEqual(qualityDowngradeSongs([mp3(1, { durationMs: 0 })], none), []);
  });

  test("never offers a song YouTube Music had no copy of, nor one on its way", () => {
    const songs = [mp3(1), mp3(2), mp3(3), mp3(4)];
    const jobs: YtDownloadJournalJob[] = [
      job("downgrade:2", { phase: "transferring" }),
      job("upgrade:3", { phase: "queued" }),
    ];
    assert.deepEqual(
      qualityDowngradeSongs(songs, { noBetterCopy: new Set([1]), jobs }).map((song) => song.id),
      [3, 4],
    );
  });
});

describe("youTubeCopyKbps", () => {
  test("256 when the owner's latest YouTube download is AAC 256k (Premium)", () => {
    const files = [
      file(1, { videoId: "a", bitrateKbps: 129 }),
      file(2, { videoId: "b", bitrateKbps: 252 }),
      file(3, { path: "/Music/c.mp3", bitrateKbps: 320 }),
    ];
    assert.equal(youTubeCopyKbps(files), 256);
  });

  test("about 128 when the latest one is ~128k, whatever came before", () => {
    const files = [file(1, { videoId: "a", bitrateKbps: 256 }), file(2, { videoId: "b" })];
    assert.equal(youTubeCopyKbps(files), 128);
  });

  test("about 128 with no YouTube download to tell by", () => {
    assert.equal(youTubeCopyKbps([file(1, { bitrateKbps: 256 })]), 128);
    assert.equal(youTubeCopyKbps([file(1, { videoId: "a", bitrateKbps: null })]), 128);
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
    assert.equal(offer?.summary, "About +1.2 GB");
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

  test("on mobile data, a large run says how much it downloads and that the phone isn't on Wi-Fi", () => {
    // 13 songs × 8,000,000 bytes at 320 kbps = 104 MB to download.
    const songs = Array.from({ length: 13 }, (_, index) => file(index + 1));
    const offer = qualityUpgradeOffer(songs, { onMobileData: true });
    assert.equal(
      offer?.alert.message,
      "About +62 MB. It downloads about 104 MB, and the phone isn't on Wi-Fi.",
    );
  });

  test("on mobile data, a small run says nothing about it", () => {
    // 12 songs × 8,000,000 bytes = 96 MB, under the 100 MB a note takes.
    const songs = Array.from({ length: 12 }, (_, index) => file(index + 1));
    assert.equal(qualityUpgradeOffer(songs, { onMobileData: true })?.alert.message, "About +58 MB");
  });

  test("offers nothing when no song qualifies", () => {
    assert.equal(qualityUpgradeOffer([], { onMobileData: true }), null);
  });
});

describe("qualityDowngradeOffer", () => {
  test("asks with the space it frees at about 128k, Replace or Not now", () => {
    const offer = qualityDowngradeOffer(mp3s(125), { onMobileData: false, youTubeKbps: 128 });
    assert.equal(offer?.direction, "downgrade");
    assert.equal(offer?.bytes, 900_000_000);
    assert.equal(offer?.downloadBytes, 600_000_000);
    assert.equal(offer?.trackIds.length, 125);
    assert.deepEqual(offer?.alert, {
      title: "Free about 900 MB by replacing 125 songs with YouTube Music copies?",
      message: "YouTube Music's copies are AAC at about 128 kbps.",
      action: { label: "Replace" },
      dismissLabel: "Not now",
    });
    assert.equal(offer?.row, "Free up space: replace 125 songs");
    assert.equal(offer?.summary, "Frees about 900 MB");
  });

  test("with Premium's 256k it frees less", () => {
    const offer = qualityDowngradeOffer(mp3s(125), { onMobileData: false, youTubeKbps: 256 });
    assert.equal(offer?.bytes, 300_000_000);
    assert.equal(offer?.alert.message, "YouTube Music's copies are AAC at 256 kbps.");
  });

  test("on mobile data, a large run says how much it downloads and that the phone isn't on Wi-Fi", () => {
    // 21 songs × 4,800,000 bytes at 128 kbps = 101 MB to download.
    const offer = qualityDowngradeOffer(mp3s(21), { onMobileData: true, youTubeKbps: 128 });
    assert.equal(
      offer?.alert.message,
      "YouTube Music's copies are AAC at about 128 kbps. It downloads about 101 MB, and the phone isn't on Wi-Fi.",
    );
  });

  test("on mobile data, a small run says nothing about it", () => {
    const offer = qualityDowngradeOffer(mp3s(1), { onMobileData: true, youTubeKbps: 128 });
    assert.equal(
      offer?.alert.title,
      "Free about 7 MB by replacing 1 song with YouTube Music copies?",
    );
    assert.equal(offer?.alert.message, "YouTube Music's copies are AAC at about 128 kbps.");
  });

  test("offers nothing when nothing would be saved", () => {
    const small = file(1, { path: "/Music/a.mp3", bitrateKbps: 320, sizeBytes: 1_000_000 });
    assert.equal(qualityDowngradeOffer([small], { onMobileData: false, youTubeKbps: 128 }), null);
    assert.equal(qualityDowngradeOffer([], { onMobileData: false, youTubeKbps: 128 }), null);
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

const result = (videoId: string, patch: Partial<YtSong> = {}): YtSong => ({
  videoId,
  title: "Song",
  artists: ["Artist", "Guest"],
  album: "Album",
  durationMs: 201_000,
  artworkUrl: null,
  explicit: false,
  ...patch,
});

describe("a downgrade's YouTube Music match", () => {
  const downgrade = qualityReplacementJob("downgrade", track({ path: "/Music/03 Song.mp3" }));

  test("searches for the Track's title and artists", () => {
    assert.equal(downgrade.videoId, "downgrade:7");
    assert.equal(qualityDowngradeSearch(downgrade), "Song Artist Guest");
  });

  test("downloads the first result that is the recording: title, artists and length", () => {
    const results = [
      result("live", { title: "Song (Live)" }),
      result("long", { durationMs: 230_000 }),
      result("cover", { artists: ["Someone Else"] }),
      result("right"),
    ];
    assert.equal(qualityDowngradeVideo(downgrade, results), "right");
  });

  test("no result that is the recording: no copy", () => {
    assert.equal(
      qualityDowngradeVideo(downgrade, [result("live", { title: "Song (Live)" })]),
      null,
    );
    assert.equal(qualityDowngradeVideo(downgrade, []), null);
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
      keepTagsOf: track().path,
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

  test("remembers a song YouTube Music had no copy of for freeing space only", () => {
    assert.deepEqual(
      noBetterCopies([job("downgrade:4", { phase: "failed", reason: "notFound" })]),
      [{ direction: "downgrade", trackId: 4 }],
    );
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

  test("turning it on again cancels the waiting replacements that free space", () => {
    const jobs = [
      job("downgrade:1", { phase: "queued" }),
      job("downgrade:2", { phase: "publishing" }),
      job("upgrade:3", { phase: "queued" }),
    ];
    assert.deepEqual(qualityJobsToCancel(jobs, "downgrade"), ["downgrade:1"]);
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
