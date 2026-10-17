import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  downloadFailurePlan,
  downloadFallback,
  downloadSource,
  ytAudioMatches,
  ytAudioRejection,
  ytAudioTrack,
  ytDownloadReport,
} from "./index.ts";
import type { DownloadFailurePlan, YtDownloadFailure, YtSong } from "./index.ts";

/** What the journal does with a transfer that fails with [failure]. */
const step = (plan: DownloadFailurePlan, failure: YtDownloadFailure) =>
  plan.retry.includes(failure) ? "retry" : plan.end.includes(failure) ? "end" : "next";

describe("downloadSource", () => {
  test("with Download in best quality off, a download comes from YouTube Music while YT Music is on", () => {
    assert.equal(downloadSource({ ytMusicOn: true, bestQuality: false }), "youtube");
  });

  test("with Download in best quality on, downloads come from Soulseek whether YT Music is on or off", () => {
    assert.equal(downloadSource({ ytMusicOn: true, bestQuality: true }), "soulseek");
    assert.equal(downloadSource({ ytMusicOn: false, bestQuality: true }), "soulseek");
  });

  test("with YT Music and Download in best quality both off, a download has no source", () => {
    assert.equal(downloadSource({ ytMusicOn: false, bestQuality: false }), null);
  });

  test("a missing song with a video id downloads that video from YouTube Music, even with Download in best quality on", () => {
    assert.equal(downloadSource({ ytMusicOn: true, bestQuality: true, video: true }), "youtube");
    assert.equal(downloadSource({ ytMusicOn: true, bestQuality: false, video: true }), "youtube");
  });

  test("with YT Music off, a missing song with a video id comes from Soulseek while Download in best quality is on", () => {
    assert.equal(downloadSource({ ytMusicOn: false, bestQuality: true, video: true }), "soulseek");
    assert.equal(downloadSource({ ytMusicOn: false, bestQuality: false, video: true }), null);
  });
});

describe("downloadFallback", () => {
  const on = { ytMusicOn: true };

  test("a recording Soulseek has no 320 kbps copy of, or whose peers ran out, comes from YouTube Music", () => {
    assert.equal(downloadFallback("unavailable", on), "youtube");
  });

  test("a rejected Soulseek account, or a Soulseek server that can't be reached, falls back too", () => {
    assert.equal(downloadFallback("accountRejected", on), "youtube");
    assert.equal(downloadFallback("unreachable", on), "youtube");
  });

  test("Soulseek signed out mid-download falls back, as a new download would come from YouTube Music", () => {
    assert.equal(downloadFallback("account", on), "youtube");
  });

  test("a Soulseek attempt that ran out of time falls back", () => {
    assert.equal(downloadFallback("timedOut", on), "youtube");
  });

  test("offline, full storage and an unwritable folder end the download: YouTube would fail the same way", () => {
    for (const failure of ["offline", "storage", "noFolder"] as const)
      assert.equal(downloadFallback(failure, on), null, failure);
  });

  test("with YT Music off, every Soulseek failure ends the download as before", () => {
    for (const failure of [
      "unavailable",
      "accountRejected",
      "unreachable",
      "account",
      "timedOut",
    ] as const)
      assert.equal(downloadFallback(failure, { ytMusicOn: false }), null, failure);
  });
});

describe("downloadFailurePlan", () => {
  const on = { ytMusicOn: true };
  const off = { ytMusicOn: false };

  test("a Soulseek peer that fails, or sends another recording, gives way to the next peer", () => {
    for (const setup of [on, off]) {
      const plan = downloadFailurePlan("soulseek", setup);
      assert.equal(step(plan, "unavailable"), "next");
      assert.equal(step(plan, "failed"), "next");
      assert.equal(plan.rejected, null);
    }
  });

  test("once Soulseek's peers run out, the recording is unavailable in 320 kbps", () => {
    assert.equal(downloadFailurePlan("soulseek", on).exhausted, "unavailable");
    assert.equal(downloadFailurePlan("soulseek", off).exhausted, "unavailable");
  });

  test("an account problem, full storage or an unwritable folder ends a Soulseek download at once", () => {
    for (const setup of [on, off])
      for (const failure of ["account", "accountRejected", "storage", "noFolder"] as const)
        assert.equal(step(downloadFailurePlan("soulseek", setup), failure), "end", failure);
  });

  test("offline, a Soulseek download is tried again after a pause", () => {
    assert.equal(step(downloadFailurePlan("soulseek", on), "offline"), "retry");
    assert.equal(step(downloadFailurePlan("soulseek", off), "offline"), "retry");
  });

  test("with YT Music on, an unreachable Soulseek server ends the attempt at once, to fall back", () => {
    assert.equal(step(downloadFailurePlan("soulseek", on), "unreachable"), "end");
    assert.deepEqual(downloadFailurePlan("soulseek", on).fallsBack.toSorted(), [
      "account",
      "accountRejected",
      "timedOut",
      "unavailable",
      "unreachable",
    ]);
  });

  test("with YT Music off, an unreachable server is retried like a dropped connection, and nothing falls back", () => {
    assert.equal(step(downloadFailurePlan("soulseek", off), "unreachable"), "retry");
    assert.deepEqual(downloadFailurePlan("soulseek", off).fallsBack, []);
  });

  test("the failures that fall back are the ones downloadFallback hands over", () => {
    for (const failure of FAILURES)
      assert.equal(
        downloadFailurePlan("soulseek", on).fallsBack.includes(failure),
        downloadFallback(failure, on) === "youtube",
        failure,
      );
  });

  test("a YouTube transfer that breaks off starts again; offline it's tried again after a pause", () => {
    const plan = downloadFailurePlan("youtube", on);
    assert.equal(step(plan, "failed"), "next");
    assert.equal(step(plan, "unavailable"), "next");
    assert.equal(step(plan, "offline"), "retry");
  });

  test("a song YouTube won't serve, YT Music turned off, full storage or an unwritable folder end a YouTube download", () => {
    for (const failure of ["ytUnavailable", "noSource", "storage", "noFolder"] as const)
      assert.equal(step(downloadFailurePlan("youtube", on), failure), "end", failure);
  });

  test("YouTube audio that isn't the song is unavailable on YouTube Music; restarts that run out fail the download", () => {
    const plan = downloadFailurePlan("youtube", on);
    assert.equal(plan.rejected, "ytUnavailable");
    assert.equal(plan.exhausted, "failed");
  });

  test("a YouTube download has nothing to fall back to", () => {
    assert.deepEqual(downloadFailurePlan("youtube", on).fallsBack, []);
    assert.deepEqual(downloadFailurePlan("youtube", off).fallsBack, []);
  });
});

const FAILURES: readonly YtDownloadFailure[] = [
  "offline",
  "failed",
  "timedOut",
  "noFolder",
  "storage",
  "account",
  "accountRejected",
  "unreachable",
  "unavailable",
  "noSource",
  "ytUnavailable",
];

describe("ytAudioMatches", () => {
  const song = { durationMs: 60_000 };

  test("YouTube's audio is the song when it lasts as long, give or take two seconds", () => {
    assert.equal(ytAudioMatches(song, 60_000), true);
    assert.equal(ytAudioMatches(song, 61_900), true);
    assert.equal(ytAudioMatches(song, 58_100), true);
  });

  test("audio that's shorter or longer than the song is rejected", () => {
    assert.equal(ytAudioMatches(song, 57_000), false);
    assert.equal(ytAudioMatches(song, 62_500), false);
  });

  test("a long song may be off by up to 2% of its length", () => {
    const long = { durationMs: 600_000 };
    assert.equal(ytAudioMatches(long, 611_000), true);
    assert.equal(ytAudioMatches(long, 613_000), false);
  });

  test("without a known length, any audio with a length is the song; silence never is", () => {
    assert.equal(ytAudioMatches({ durationMs: null }, 180_000), true);
    assert.equal(ytAudioMatches({ durationMs: null }, 0), false);
    assert.equal(ytAudioMatches(song, 0), false);
  });
});

describe("ytAudioRejection", () => {
  test("audio of another length is turned down with both lengths, so the row says why", () => {
    const song = { durationMs: 225_000 };
    assert.equal(
      ytAudioRejection(song, 242_400),
      "YouTube's audio is 4:02 long, but the song is 3:45",
    );
    assert.equal(
      ytAudioRejection(song, 30_000),
      "YouTube's audio is 0:30 long, but the song is 3:45",
    );
  });

  test("audio that is the song isn't turned down", () => {
    assert.equal(ytAudioRejection({ durationMs: 225_000 }, 226_000), null);
    assert.equal(ytAudioRejection({ durationMs: null }, 180_000), null);
  });

  test("audio without a length is turned down as that", () => {
    assert.equal(ytAudioRejection({ durationMs: 225_000 }, 0), "YouTube's audio has no length");
    assert.equal(ytAudioRejection({ durationMs: null }, 0), "YouTube's audio has no length");
  });
});

describe("ytAudioTrack", () => {
  const ytSong = (videoId: string, title: string, durationMs: number | null): YtSong => ({
    videoId,
    title,
    artists: ["twenty one pilots"],
    album: "Blurryface",
    durationMs,
    artworkUrl: null,
    explicit: false,
  });
  // As YT Music's Blurryface page lists it: the music video's id, the album cut's length.
  const fromAlbumPage = ytSong("ywvRgGAd2XI", "Lane Boy", 254_000);
  const audioTrack = ytSong("uumR0WQrJjw", "Lane Boy", 254_000);

  test("a song listed under its music video downloads the Songs search's audio track of it", () => {
    const results = [audioTrack, ytSong("GmaWJ-kaUrg", "Stressed Out", 264_000)];
    assert.equal(ytAudioTrack(fromAlbumPage, results), "uumR0WQrJjw");
  });

  test("a song the search lists keeps its own video, even after another release of it", () => {
    const compilation = { ...ytSong("Xk1Comp0000", "Lane Boy", 253_000), album: "Hits" };
    assert.equal(ytAudioTrack(audioTrack, [compilation, audioTrack]), null);
  });

  test("nothing that isn't the recording replaces the song's video: the length check still judges it", () => {
    const live = ytSong("WEMcQGj3FPY", "Lane Boy (Live)", 254_000);
    const otherCut = ytSong("0rQ4lG_PBVM", "Lane Boy", 240_000);
    assert.equal(ytAudioTrack(fromAlbumPage, [live, otherCut]), null);
    assert.equal(ytAudioTrack({ ...fromAlbumPage, durationMs: null }, [audioTrack]), null);
    assert.equal(ytAudioTrack(fromAlbumPage, null), null);
  });
});

describe("ytDownloadReport", () => {
  test("says which video was asked for and served, by which client, and the three lengths", () => {
    assert.equal(
      ytDownloadReport({
        song: "ywvRgGAd2XI",
        requested: "uumR0WQrJjw",
        resolved: "uumR0WQrJjw",
        client: "WEB_REMIX",
        videoType: "MUSIC_VIDEO_TYPE_ATV",
        announcedMs: 253_000,
        expectedMs: 254_000,
        expectedFrom: "ytMusic",
        measuredMs: 253_129,
      }),
      "YouTube download of ywvRgGAd2XI: asked for uumR0WQrJjw, served uumR0WQrJjw (ATV) by WEB_REMIX; " +
        "YouTube says 253.0 s, the song is 254.0 s (YT Music's listing), the file plays 253.1 s",
    );
  });

  test("says what it doesn't know, and a missing song's length is its Library track's", () => {
    assert.equal(
      ytDownloadReport({
        song: null,
        requested: "uumR0WQrJjw",
        resolved: null,
        client: null,
        videoType: null,
        announcedMs: null,
        expectedMs: null,
        expectedFrom: "library",
        measuredMs: 253_129,
      }),
      "YouTube download: asked for uumR0WQrJjw, served an unknown video (unknown type) by an unknown client; " +
        "YouTube says no length, the song has no length (its Library track), the file plays 253.1 s",
    );
  });

  test("an unsearched song's length is what Spotify listed", () => {
    assert.equal(
      ytDownloadReport({
        song: null,
        requested: "uumR0WQrJjw",
        resolved: "uumR0WQrJjw",
        client: "WEB_REMIX",
        videoType: "MUSIC_VIDEO_TYPE_ATV",
        announcedMs: 498_000,
        expectedMs: 498_000,
        expectedFrom: "spotify",
        measuredMs: 498_100,
      }),
      "YouTube download: asked for uumR0WQrJjw, served uumR0WQrJjw (ATV) by WEB_REMIX; " +
        "YouTube says 498.0 s, the song is 498.0 s (Spotify's listing), the file plays 498.1 s",
    );
  });
});
