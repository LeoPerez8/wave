import assert from "node:assert/strict";
import { test } from "node:test";

import { musicVideoAudioTrack } from "./index.ts";

const result = (videoId: string, title: string, durationMs: number, videoType?: string) => ({
  videoId,
  title,
  artists: ["Some Band."],
  album: "An Album",
  durationMs,
  ...(videoType === undefined ? {} : { videoType }),
});
const video = {
  title: "Even If You Don't (Official Audio)",
  artists: ["Some Band."],
  durationMs: 184_000,
};

test("a music video's audio track is the song of the same recording, its video note set aside", () => {
  assert.equal(
    musicVideoAudioTrack(video, [
      result("other", "Another Song", 184_000),
      result("audio", "Even If You Don't", 184_000),
    ])?.videoId,
    "audio",
  );
  for (const note of ["Official Music Video", "Official Video", "Lyric Video", "Visualizer"])
    assert.equal(
      musicVideoAudioTrack({ ...video, title: `Even If You Don't (${note})` }, [
        result("audio", "Even If You Don't", 184_000),
      ])?.videoId,
      "audio",
    );
});

test("a music video may run up to a minute longer than its audio track, never more than 3 s shorter", () => {
  const audio = (durationMs: number) => [result("audio", "Even If You Don't", durationMs)];
  assert.equal(
    musicVideoAudioTrack({ ...video, durationMs: 240_000 }, audio(184_000))?.videoId,
    "audio",
  );
  assert.equal(musicVideoAudioTrack({ ...video, durationMs: 250_000 }, audio(184_000)), null);
  assert.equal(musicVideoAudioTrack({ ...video, durationMs: 180_000 }, audio(184_000)), null);
});

test("another video, another edition or another artist isn't the audio track", () => {
  assert.equal(
    musicVideoAudioTrack(video, [
      result("omv", "Even If You Don't", 184_000, "MUSIC_VIDEO_TYPE_OMV"),
      result("ugc", "Even If You Don't", 184_000, "MUSIC_VIDEO_TYPE_UGC"),
      result("live", "Even If You Don't (Live)", 184_000),
      { ...result("cover", "Even If You Don't", 184_000), artists: ["Someone Else"] },
    ]),
    null,
  );
  assert.equal(
    musicVideoAudioTrack({ ...video, artists: [] }, [
      result("audio", "Even If You Don't", 184_000),
    ]),
    null,
  );
});
