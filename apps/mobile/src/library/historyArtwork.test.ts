import assert from "node:assert/strict";
import { test } from "node:test";
import type { PlaySnapshot } from "@wave/core";

import type { SongRow } from "./LibraryStore.ts";
import { songRowPresentation } from "../songs/songListModel.ts";
import { historyArtwork, historyArtworkUri } from "./historyArtwork.ts";

const snapshot = (cover: Partial<PlaySnapshot>): PlaySnapshot => ({
  title: "Song",
  artist: "Artist",
  album: null,
  artworkPath: null,
  thumbPath: null,
  ...cover,
});
const song = (thumbPath: string | null, artworkPath: string | null) =>
  ({ thumbPath, artworkPath }) as SongRow;

test("a Library play shows the cover it was played with", () => {
  assert.equal(
    historyArtworkUri(
      {
        videoId: null,
        snapshot: snapshot({ thumbPath: "/covers/then.jpg" }),
        song: song("/covers/now.jpg", null),
      },
      false,
    ),
    "file:///covers/then.jpg",
  );
});

test("a Library play from another phone shows its resolved song's cover", () => {
  assert.equal(
    historyArtworkUri(
      {
        videoId: null,
        snapshot: snapshot({ artworkUrl: "https://covers.example/remote.jpg" }),
        song: song(null, "/covers/now.jpg"),
      },
      false,
    ),
    "file:///covers/now.jpg",
  );
});

test("a Library play from another phone falls back to its remote cover", () => {
  const remote = snapshot({ artworkUrl: "https://covers.example/remote.jpg" });
  assert.equal(
    historyArtworkUri({ videoId: null, snapshot: remote, song: song(null, null) }, false),
    "https://covers.example/remote.jpg",
  );
  assert.equal(
    historyArtworkUri({ videoId: null, snapshot: remote, song: null }, false),
    "https://covers.example/remote.jpg",
  );
});

test("a stream shows its downloaded song's cover, else its remote one while it can play", () => {
  const stream = snapshot({ artworkUrl: "https://i.ytimg.com/cover.jpg" });
  assert.equal(
    historyArtworkUri(
      { videoId: "v", snapshot: stream, song: song("/covers/file.jpg", null) },
      false,
    ),
    "file:///covers/file.jpg",
  );
  assert.equal(
    historyArtworkUri({ videoId: "v", snapshot: stream, song: null }, true),
    "https://i.ytimg.com/cover.jpg",
  );
  assert.equal(historyArtworkUri({ videoId: "v", snapshot: stream, song: null }, false), undefined);
});

test("a history row shows the cover the policy chose, whatever kind of address it is", () => {
  const plays = [
    { videoId: null, snapshot: snapshot({ thumbPath: "/covers/then.jpg" }), song: null },
    {
      videoId: null,
      snapshot: snapshot({ artworkPath: `/data/artwork/${"a".repeat(40)}.jpg` }),
      song: null,
    },
    {
      videoId: null,
      snapshot: snapshot({ artworkUrl: "https://covers.example/remote.jpg" }),
      song: null,
    },
    { videoId: "v", snapshot: snapshot({ artworkUrl: "https://i.ytimg.com/c.jpg" }), song: null },
  ];
  for (const play of plays) {
    const row = songRowPresentation(
      {
        kind: "history",
        id: 1,
        title: "Song",
        artist: "Artist",
        durationMs: null,
        artwork: historyArtwork(play, true),
      },
      // The history policy already decided whether a remote cover may show.
      { remoteArtwork: true },
    );
    assert.equal(row.artworkUri, historyArtworkUri(play, true));
  }
  assert.deepEqual(historyArtwork(plays[3]!, false), { kind: "placeholder" });
});
