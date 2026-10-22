import assert from "node:assert/strict";
import { test } from "node:test";
import { ytAlbumOpening, type YtArtistSection } from "./index.ts";

const empty: YtArtistSection = { status: "ready", saved: null, failure: null };
const context = {
  name: "Justice",
  artistId: 1,
  album: { title: "Cross", albumArtistId: 1, albumArtistIds: [1] },
  tracks: [],
  elsewhere: () => null,
  enabled: true,
  now: 1000,
  integrated: true,
  releasePage: () => undefined,
  contentReady: true,
  settled: false,
  online: true,
};

test("an integrated album starts no request or finder until local content and the screen settle", () => {
  const first = ytAlbumOpening(empty, context);
  assert.equal(first.askArtist, false);
  assert.equal(first.readRelease, null);
  assert.equal(first.finder, false);
  assert.equal(first.view?.tracks, null);
  assert.equal(ytAlbumOpening(empty, { ...context, settled: true }).askArtist, true);
  assert.equal(
    ytAlbumOpening(empty, { ...context, settled: true, contentReady: false }).askArtist,
    false,
  );
});

test("offline albums show their note before restoration or settlement without optional work", () => {
  for (const state of [empty, { status: "reading" } as const]) {
    const work = ytAlbumOpening(state, { ...context, online: false });
    assert.equal(work.view?.note, "offline");
    assert.equal(work.askArtist, false);
    assert.equal(work.readRelease, null);
    assert.equal(work.finder, false);
  }
});

test("online tracks join after the local rows without moving a row already drawn", () => {
  const tracks = [
    {
      id: 1,
      title: "Second",
      artist: "Justice",
      artists: ["Justice"],
      durationMs: 1000,
      trackNumber: 2,
    },
    {
      id: 2,
      title: "Third",
      artist: "Justice",
      artists: ["Justice"],
      durationMs: 1000,
      trackNumber: 3,
    },
  ];
  const songs = [
    {
      videoId: "first",
      title: "First",
      artists: ["Justice"],
      durationMs: 1000,
      album: "Cross",
      artworkUrl: null,
      explicit: false,
    },
    {
      videoId: "second",
      title: "Second",
      artists: ["Justice"],
      durationMs: 1000,
      album: "Cross",
      artworkUrl: null,
      explicit: false,
    },
    {
      videoId: "third",
      title: "Third",
      artists: ["Justice"],
      durationMs: 1000,
      album: "Cross",
      artworkUrl: null,
      explicit: false,
    },
  ];
  const found: YtArtistSection = {
    ...empty,
    saved: {
      outcome: "found",
      checkedAt: 1000,
      browseId: "artist",
      page: {
        name: "Justice",
        songs: [],
        albums: [
          {
            browseId: "release",
            title: "Cross",
            artists: ["Justice"],
            year: 2007,
            kind: "album",
            artworkUrl: null,
          },
        ],
        singles: [],
      },
    },
  };
  const options = {
    ...context,
    tracks,
    settled: true,
    releasePage: () => ({ status: "loaded" as const, songs }),
  };
  const work = ytAlbumOpening(found, options);
  assert.deepEqual(
    work.view?.tracks?.map((row) => (row.source === "library" ? row.track.id : row.song.videoId)),
    [1, 2, "first"],
  );
  assert.equal(ytAlbumOpening(found, { ...options, settled: false }).view?.tracks, null);
});

test("an album retry cannot bypass Library, off, offline or unsettled opening gates", () => {
  const failed = { ...empty, failure: "offline" as const };
  const retry = { ...context, retryArtist: true, settled: true };
  assert.equal(ytAlbumOpening(failed, retry).askArtist, true);
  for (const override of [
    { online: false },
    { settled: false },
    { contentReady: false },
    { pick: "library" as const },
    { enabled: false },
  ]) {
    const work = ytAlbumOpening(failed, { ...retry, ...override });
    assert.equal(work.askArtist, false);
    assert.equal(work.readRelease, null);
    assert.equal(work.finder, false);
  }
});
