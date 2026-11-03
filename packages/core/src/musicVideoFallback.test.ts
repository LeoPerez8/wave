import assert from "node:assert/strict";
import { test } from "node:test";
import { spotifyYtMatch } from "./index.ts";

const wanted = { title: "Skyfall", artists: ["Adele"], album: null, durationMs: 286_000 };
const video = {
  ...wanted,
  videoId: "DeumyOzKqgI",
  durationMs: 290_000,
  videoType: "MUSIC_VIDEO_TYPE_OMV",
};

test("Skyfall can match its official music video when no Songs recording matches", () => {
  assert.equal(spotifyYtMatch(wanted, [video]), video);
});

test("Songs win; only matching official videos in the inclusive -3/+60 second window qualify", () => {
  const audio = { ...video, videoType: "MUSIC_VIDEO_TYPE_ATV", durationMs: 286_000 };
  assert.equal(spotifyYtMatch(wanted, [video, audio]), audio);
  for (const patch of [
    { videoType: "MUSIC_VIDEO_TYPE_UGC", durationMs: 286_000 },
    { videoType: null, durationMs: 290_000 },
    { durationMs: 282_999 },
    { durationMs: 346_001 },
    { durationMs: null },
    { title: "Skyfall (Live)" },
    { artists: ["Someone else"] },
  ])
    assert.equal(spotifyYtMatch(wanted, [{ ...video, ...patch }]), null);
  for (const durationMs of [283_000, 346_000]) {
    const match = { ...video, durationMs };
    assert.equal(spotifyYtMatch(wanted, [match]), match);
  }
});

test("recording lookup falls back once and preserves a failed video search", async () => {
  const { searchRecording } = await import("./index.ts");
  const failure = { ok: false, reason: "offline" } as const;
  const result = await searchRecording(wanted, async (kind) =>
    kind === "songs" ? { ok: true, songs: [] } : failure,
  );
  assert.equal(result, failure);
});

test("the recorded Skyfall Videos response matches despite its presentation note", async () => {
  const { readFile } = await import("node:fs/promises");
  const recorded = JSON.parse(
    await readFile(new URL("./fixtures/skyfall-video.json", import.meta.url), "utf8"),
  );
  assert.equal(spotifyYtMatch(wanted, [recorded])?.videoId, "DeumyOzKqgI");
});

test("Songs success spends no video request; fallback takes the first OMV and never UGC", async () => {
  const { searchRecording } = await import("./index.ts");
  const audio = {
    ...video,
    videoType: "MUSIC_VIDEO_TYPE_ATV",
    durationMs: 286_000,
    artworkUrl: null,
    explicit: false,
  };
  assert.deepEqual(
    await searchRecording(wanted, async (kind) => {
      assert.equal(kind, "songs");
      return { ok: true, songs: [audio] };
    }),
    { ok: true, songs: [audio] },
  );
  const official = { ...audio, ...video };
  assert.deepEqual(
    await searchRecording(wanted, async (kind) => ({
      ok: true,
      songs:
        kind === "songs"
          ? []
          : [
              { ...official, videoType: "MUSIC_VIDEO_TYPE_UGC" },
              official,
              { ...official, videoId: "later" },
            ],
    })),
    { ok: true, songs: [official] },
  );
});

test("official video identity survives saving and reloading a playlist", async () => {
  const { readPlaylistYtSong, writePlaylistYtSong } = await import("./index.ts");
  const saved = { ...video, artworkUrl: null, explicit: false };
  assert.equal(readPlaylistYtSong(writePlaylistYtSong(saved))?.videoType, "MUSIC_VIDEO_TYPE_OMV");
});

test("a failed fallback keeps an unsearched entry; Recognize accepts the same official video", async () => {
  const { searchRecording, settleUnsearched, resolveRecognizedSong } = await import("./index.ts");
  const official = {
    ...video,
    title: "Skyfall (Official Lyric Video)",
    artworkUrl: null,
    explicit: false,
  };
  const song = { ...wanted, artworkUrl: null };
  const answer = await searchRecording(song, async (kind) =>
    kind === "songs" ? { ok: true, songs: [] } : { ok: false, reason: "failed" },
  );
  assert.ok(answer);
  assert.equal(settleUnsearched(song, answer).kind, "failed");
  const heard = {
    title: "Skyfall",
    artist: "Adele",
    album: null,
    coverUrl: null,
    isrc: null,
    releaseYear: null,
  };
  const recognized = resolveRecognizedSong(heard, [], { ok: true, songs: [official] });
  assert.equal(recognized.kind === "resolved" && recognized.lookup, "match");
});
