import assert from "node:assert/strict";
import { test } from "node:test";

import { stepYtSection, ytSearchAsksVideos, ytSectionView, type YtSong } from "./index.ts";

const song = (videoId: string, title: string, artists: string[], videoType?: string): YtSong => ({
  videoId,
  title,
  artists,
  album: null,
  durationMs: 290_000,
  artworkUrl: null,
  explicit: false,
  ...(videoType === undefined ? {} : { videoType }),
});

const official = song(
  "DeumyOzKqgI",
  "Skyfall (Official Lyric Video)",
  ["Adele"],
  "MUSIC_VIDEO_TYPE_OMV",
);
const upload = song("upload", "Skyfall Adele cover", ["Someone"], "MUSIC_VIDEO_TYPE_UGC");
const otherSong = song("other", "Skyfall Beats", ["Producer"], "MUSIC_VIDEO_TYPE_ATV");
const NOTHING_IN_LIBRARY = {
  hasSong: () => false,
  hasArtist: () => false,
  hasAlbum: () => false,
};

/** What Online shows for "Skyfall Adele" once YT Music answers with [songs] and [videos]. */
const shown = (query: string, songs: readonly YtSong[], videos?: readonly YtSong[]) => {
  const loading = stepYtSection<YtSong>(
    { status: "idle", pick: null },
    { type: "typed", query, enabled: true, libraryHasResults: false },
  );
  const found = stepYtSection(loading, {
    type: "found",
    query,
    songs,
    artists: [],
    albums: [],
    ...(videos === undefined ? {} : { videos }),
  });
  return ytSectionView(found, NOTHING_IN_LIBRARY);
};

test("Online asks for videos only when no song result matches the query", () => {
  assert.equal(ytSearchAsksVideos("Skyfall Adele", [otherSong]), true);
  assert.equal(ytSearchAsksVideos("Skyfall Adele", []), true);
  const audio = song("audio", "Skyfall", ["Adele"], "MUSIC_VIDEO_TYPE_ATV");
  assert.equal(ytSearchAsksVideos("Skyfall Adele", [otherSong, audio]), false);
});

test("Skyfall Adele shows its official music video, first, when no song result matches", () => {
  const view = shown("Skyfall Adele", [otherSong], [upload, official]);
  assert.deepEqual(
    view?.songs.map((s) => s.videoId),
    ["DeumyOzKqgI", "other"],
  );
  assert.equal(view?.top?.kind === "song" && view.top.song.videoId, "DeumyOzKqgI");
});

test("a query a song result matches shows no video", () => {
  const audio = song("audio", "Skyfall", ["Adele"], "MUSIC_VIDEO_TYPE_ATV");
  const view = shown("Skyfall Adele", [audio], [official]);
  assert.deepEqual(
    view?.songs.map((s) => s.videoId),
    ["audio"],
  );
});

test("user uploads, untyped videos and videos that don't match the query never show", () => {
  const untyped = song("untyped", "Skyfall", ["Adele"]);
  const unrelated = song("unrelated", "Hello (Official Video)", ["Adele"], "MUSIC_VIDEO_TYPE_OMV");
  const ugcAdele = song("ugc", "Skyfall", ["Adele"], "MUSIC_VIDEO_TYPE_UGC");
  const view = shown("Skyfall Adele", [], [upload, untyped, unrelated, ugcAdele]);
  assert.deepEqual(view?.songs, []);
  assert.equal(view?.note, "noMatches");
});

test("no video answer leaves the songs as they were", () => {
  assert.deepEqual(
    shown("Skyfall Adele", [otherSong])?.songs.map((s) => s.videoId),
    ["other"],
  );
});

test("Skyfall Adele asks for and shows the OMV despite karaoke, cover and tribute Songs", () => {
  for (const title of [
    "Skyfall (In the Style of Adele) [Karaoke Version]",
    "Skyfall (In the Style of Adele)",
    "Skyfall Adele Cover",
    "Skyfall (Tribute to Adele)",
  ]) {
    const imitation = song("imitation", title, ["Studio Singers"], "MUSIC_VIDEO_TYPE_ATV");
    assert.equal(ytSearchAsksVideos("Skyfall Adele", [imitation]), true, title);
    assert.deepEqual(shown("Skyfall Adele", [imitation], [upload, official])?.songs, [
      official,
      imitation,
    ]);
  }
});
