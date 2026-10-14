import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  downloadFallback,
  downloadFallbackFailures,
  downloadSource,
  ytAudioMatches,
} from "./index.ts";

describe("downloadSource", () => {
  test("with YT Music on and no Soulseek account, a download comes from YouTube Music", () => {
    assert.equal(downloadSource({ ytMusicOn: true, soulseekAccount: false }), "youtube");
  });

  test("with a Soulseek account, downloads stay on Soulseek whether YT Music is on or off", () => {
    assert.equal(downloadSource({ ytMusicOn: true, soulseekAccount: true }), "soulseek");
    assert.equal(downloadSource({ ytMusicOn: false, soulseekAccount: true }), "soulseek");
  });

  test("with YT Music off and no Soulseek account, a download has no source", () => {
    assert.equal(downloadSource({ ytMusicOn: false, soulseekAccount: false }), null);
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

describe("downloadFallbackFailures", () => {
  test("lists the Soulseek failures the journal hands over to YouTube Music", () => {
    assert.deepEqual(
      [...downloadFallbackFailures({ ytMusicOn: true })].sort(),
      ["account", "accountRejected", "timedOut", "unavailable", "unreachable"],
    );
  });

  test("is empty with YT Music off", () => {
    assert.deepEqual(downloadFallbackFailures({ ytMusicOn: false }), []);
  });
});

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
