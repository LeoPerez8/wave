import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  MISSING_SONGS_DOWNLOAD_ACTION_LABELS,
  UNKNOWN_ALBUM,
  missingSongJob,
  missingSongJobId,
  missingSongLookup,
  missingSongSearch,
  missingSongTags,
  missingSongsDownload,
  recordingKey,
  missingSongVideo,
} from "./index.ts";
import type { MissingSongJob, MissingTrack, YtDownloadJournalJob, YtSong } from "./index.ts";

const track = (patch: Partial<MissingTrack> = {}): MissingTrack => ({
  id: 7,
  title: "Halo",
  artist: "Beyoncé",
  artists: ["Beyoncé"],
  album: "I Am... Sasha Fierce",
  albumArtist: "Beyoncé",
  year: 2008,
  trackNumber: 3,
  discNumber: 1,
  genre: "Pop",
  durationMs: 261_000,
  videoId: null,
  ...patch,
});

describe("missingSongJob", () => {
  test("a missing song's download job is named after its Track, never after a video", () => {
    assert.equal(missingSongJobId(7), "missing:7");
    assert.equal(missingSongJob(track()).videoId, "missing:7");
    assert.equal(missingSongJob(track({ videoId: "abc" })).videoId, "missing:7");
  });

  test("the job carries the song as its Track has it: title, artists, album and length", () => {
    const job = missingSongJob(track({ artists: ["Beyoncé", "Jay-Z"] }));
    assert.equal(job.title, "Halo");
    assert.deepEqual(job.artists, ["Beyoncé", "Jay-Z"]);
    assert.equal(job.album, "I Am... Sasha Fierce");
    assert.equal(job.durationMs, 261_000);
    assert.equal(job.missing.trackId, 7);
  });

  test("no album and no length are unknown, as a YT Music song says them", () => {
    const job = missingSongJob(track({ album: UNKNOWN_ALBUM, durationMs: 0 }));
    assert.equal(job.album, null);
    assert.equal(job.durationMs, null);
  });
});

const result = (videoId: string, patch: Partial<YtSong> = {}): YtSong => ({
  videoId,
  title: "Halo",
  artists: ["Beyoncé"],
  album: "I Am... Sasha Fierce",
  durationMs: 261_000,
  artworkUrl: `https://i.ytimg.com/${videoId}`,
  explicit: false,
  ...patch,
});

describe("missingSongVideo", () => {
  test("a missing song with a video id downloads that video, with nothing searched", () => {
    const job = missingSongJob(track({ videoId: "abc" }));
    assert.equal(missingSongSearch(job), null);
    assert.deepEqual(missingSongVideo(job, null), { videoId: "abc", artworkUrl: null });
  });

  test("any other is searched on YouTube Music by its title and artists", () => {
    const job = missingSongJob(track({ artists: ["Beyoncé", "Jay-Z"] }));
    assert.equal(missingSongSearch(job), "Halo Beyoncé Jay-Z");
  });

  test("the first result that is the recording is downloaded, with its cover", () => {
    const job = missingSongJob(track());
    const found = missingSongVideo(job, [
      result("cover", { artists: ["Someone Else"] }),
      result("song"),
      result("again"),
    ]);
    assert.deepEqual(found, { videoId: "song", artworkUrl: "https://i.ytimg.com/song" });
  });

  test("another edition, or a length more than 3 seconds off, isn't the song", () => {
    const job = missingSongJob(track());
    assert.equal(missingSongVideo(job, [result("live", { title: "Halo (Live)" })]), null);
    assert.equal(missingSongVideo(job, [result("long", { durationMs: 265_000 })]), null);
    assert.deepEqual(
      missingSongVideo(job, [result("close", { durationMs: 263_000 })])?.videoId,
      "close",
    );
  });

  test("with nothing found, or no search made, there's no video", () => {
    const job = missingSongJob(track());
    assert.equal(missingSongVideo(job, []), null);
    assert.equal(missingSongVideo(job, null), null);
  });
});

describe("missingSongTags", () => {
  const found = {
    genre: "R&B",
    trackNumber: 9,
    discNumber: 2,
    year: 2009,
    lyrics: { synced: true, text: "[00:01.00] Remember" },
  };

  test("the file is tagged as the Track is, so it's the same recording for the Wave account", () => {
    const missing = track();
    const tags = missingSongTags(missingSongJob(missing), found, null);
    assert.equal(tags.title, "Halo");
    assert.equal(tags.artist, "Beyoncé");
    assert.equal(tags.album, "I Am... Sasha Fierce");
    assert.equal(tags.albumArtist, "Beyoncé");
    assert.deepEqual(
      [tags.year, tags.trackNumber, tags.discNumber, tags.genre],
      [2008, 3, 1, "Pop"],
    );
    assert.equal(recordingKey(tags), recordingKey(missing));
  });

  test("what the Track lacks comes from the lookup: lyrics, and a genre, year or number it has no tag for", () => {
    const tags = missingSongTags(
      missingSongJob(track({ genre: null, year: null, trackNumber: null, discNumber: null })),
      found,
      null,
    );
    assert.deepEqual(
      [tags.year, tags.trackNumber, tags.discNumber, tags.genre],
      [2009, 9, 2, "R&B"],
    );
    assert.equal(tags.lyrics, "[00:01.00] Remember");
  });

  test("a song without an album has none, and YouTube Music's cover is asked for large", () => {
    const tags = missingSongTags(
      missingSongJob(track({ album: UNKNOWN_ALBUM })),
      null,
      "https://lh3.googleusercontent.com/x=w120-h120-l90-rj",
    );
    assert.equal(tags.album, null);
    assert.equal(tags.artworkUrl, "https://lh3.googleusercontent.com/x=w1200-h1200-l90-rj");
    assert.equal(tags.lyrics, null);
  });

  test("lyrics and genre are looked up by the Track's title, artist, album and length", () => {
    assert.deepEqual(missingSongLookup(missingSongJob(track())), {
      title: "Halo",
      artist: "Beyoncé",
      album: "I Am... Sasha Fierce",
      durationMs: 261_000,
    });
  });
});

describe("missingSongsDownload", () => {
  const songs = (count: number): MissingSongJob[] =>
    Array.from({ length: count }, (_, index) =>
      missingSongJob(track({ id: index + 1, title: `Song ${index + 1}` })),
    );
  const job = (
    song: MissingSongJob,
    patch: Partial<YtDownloadJournalJob<MissingSongJob>> = {},
  ): YtDownloadJournalJob<MissingSongJob> => ({
    id: song.videoId,
    song,
    phase: "queued",
    ...patch,
  });
  const imported = { phase: "completed", acknowledged: true, saved: { path: "/m.mp3" } } as const;
  const ids = (list: readonly YtSong[]) => list.map((song) => song.videoId);

  test("Settings counts the missing songs and offers Download All, which queues them all", () => {
    const missing = songs(312);
    const view = missingSongsDownload(missing, []);
    assert.equal(view.line, "312 songs aren't on this phone");
    assert.deepEqual(view.actions, ["downloadAll"]);
    assert.deepEqual(ids(view.toDownload), ids(missing));
    assert.equal(MISSING_SONGS_DOWNLOAD_ACTION_LABELS.downloadAll, "Download All");
  });

  test("one song, and thousands, are counted as said", () => {
    assert.equal(missingSongsDownload(songs(1), []).line, "1 song isn't on this phone");
    assert.equal(missingSongsDownload(songs(1204), []).line, "1,204 songs aren't on this phone");
  });

  test("with no missing songs there's nothing to say or offer", () => {
    const view = missingSongsDownload([], []);
    assert.equal(view.line, null);
    assert.deepEqual(view.actions, []);
    assert.equal(view.summary, null);
  });

  test("while they download, the line counts the songs saved, filled-in ones included, and Cancel stops the rest", () => {
    const [first, second, third] = songs(3) as [MissingSongJob, MissingSongJob, MissingSongJob];
    // The first is filled in: it's no longer missing.
    const jobs = [
      job(first, imported),
      job(second, { phase: "transferring", received: 5, total: 10 }),
      job(third),
    ];
    const view = missingSongsDownload([second, third], jobs);
    assert.equal(view.line, "Downloading · 1 of 3");
    assert.deepEqual(view.actions, ["cancel"]);
    assert.deepEqual(view.toCancel, [second.videoId, third.videoId]);
    assert.deepEqual(view.toDownload, []);
  });

  test("songs not asked for yet are still offered while others download", () => {
    const [first, second] = songs(2) as [MissingSongJob, MissingSongJob];
    const view = missingSongsDownload([first, second], [job(first)]);
    assert.deepEqual(view.actions, ["downloadAll", "cancel"]);
    assert.deepEqual(ids(view.toDownload), [second.videoId]);
  });

  test("once nothing is on its way, Retry Failed asks again only for the failures, and the summary lists the songs nothing matched", () => {
    const [found, notFound, offline, unavailable] = songs(4) as [
      MissingSongJob,
      MissingSongJob,
      MissingSongJob,
      MissingSongJob,
    ];
    const jobs = [
      job(found, imported),
      job(notFound, { phase: "failed", reason: "notFound" }),
      job(offline, { phase: "failed", reason: "offline" }),
      job(unavailable, { phase: "failed", reason: "unavailable" }),
    ];
    const view = missingSongsDownload([notFound, offline, unavailable], jobs);
    assert.equal(view.line, "3 songs aren't on this phone");
    assert.deepEqual(view.actions, ["retryFailed"]);
    assert.deepEqual(ids(view.toRetry), [notFound.videoId, offline.videoId, unavailable.videoId]);
    assert.deepEqual(view.toDownload, []);
    assert.equal(view.summary?.line, "2 songs weren't found");
    assert.deepEqual(ids(view.summary?.songs ?? []), [notFound.videoId, unavailable.videoId]);
  });

  test("failures wait for Retry Failed until the rest has ended, and the summary until then too", () => {
    const [failed, queued] = songs(2) as [MissingSongJob, MissingSongJob];
    const notFound = job(failed, { phase: "failed", reason: "notFound" });
    const view = missingSongsDownload([failed, queued], [notFound, job(queued)]);
    assert.deepEqual(view.actions, ["cancel"]);
    assert.equal(view.summary, null);
    assert.equal(missingSongsDownload([failed], [notFound]).summary?.line, "1 song wasn't found");
  });

  test("Cancel forgets the jobs: the songs stay missing, and Download All is back", () => {
    const missing = songs(2);
    const view = missingSongsDownload(
      missing,
      missing.map((song) => job(song, { phase: "cancelled" })),
    );
    assert.equal(view.line, "2 songs aren't on this phone");
    assert.deepEqual(view.actions, ["downloadAll"]);
  });

  test("YT Music songs' downloads aren't counted", () => {
    const yt = result("yt") as unknown as MissingSongJob;
    const [song] = songs(1) as [MissingSongJob];
    const view = missingSongsDownload([song], [job(yt, imported), job(song)]);
    assert.equal(view.line, "Downloading · 0 of 1");
  });
});
