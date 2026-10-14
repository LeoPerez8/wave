import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { downloadSource, ytAudioMatches } from "./index.ts";

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
