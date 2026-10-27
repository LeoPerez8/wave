import assert from "node:assert/strict";
import { test } from "node:test";
import {
  missingSongJobId,
  unsearchedTrackId,
  type UnsearchedSong,
  type YtDownloadStatus,
  type YtSong,
} from "@wave/core";

import { occurrenceKeys, songRowState, type SongListSnapshot } from "./songRowState.ts";
import type { SongListEntry } from "./songListSources.ts";

const yt = (videoId: string): YtSong => ({
  videoId,
  title: `Song ${videoId}`,
  artists: ["Artist"],
  album: null,
  durationMs: null,
  artworkUrl: null,
  explicit: false,
});
const unsearched: UnsearchedSong = {
  title: "Imported",
  artists: ["Artist"],
  album: "Album",
  durationMs: 200_000,
  artworkUrl: null,
};
const librarySong = {
  id: 7,
  title: "Library",
  artist: "Artist",
  durationMs: 180_000,
  explicit: "clean" as const,
  path: null,
};
const queued: YtDownloadStatus = { kind: "queued" };

const snapshot = (overrides: Partial<SongListSnapshot> = {}): SongListSnapshot => ({
  playing: new Set(),
  favorites: new Set(),
  pending: new Set(),
  download: () => null,
  ytMusic: true,
  unplayable: new Set(),
  ...overrides,
});

test("a playlist's unsearched entry plays, and downloads, under its unsearched id; it never stars", () => {
  const id = unsearchedTrackId(unsearched);
  const entry: SongListEntry = { source: { kind: "unsearched", song: unsearched } };
  const row = songRowState(
    entry,
    "12",
    snapshot({
      playing: new Set([id]),
      favorites: new Set([7]),
      download: (job) => (job === id ? queued : null),
    }),
  );
  assert.equal(row.state.playing, true);
  assert.equal(row.state.starred, false);
  assert.deepEqual(row.state.download, queued);
});

test("an unavailable entry neither plays, stars nor downloads", () => {
  const entry: SongListEntry = {
    source: {
      kind: "unavailable",
      song: { ...unsearched, reason: "notFound" },
    },
  };
  const row = songRowState(
    entry,
    "13",
    snapshot({ playing: new Set(["13"]), download: () => queued }),
  );
  assert.equal(row.state.playing, false);
  assert.equal(row.state.starred, false);
  assert.equal(row.state.download, null);
});

test("a missing Library song reads its own download job and its star", () => {
  const entry: SongListEntry = {
    source: { kind: "library", song: librarySong },
    facts: { missing: true },
  };
  const row = songRowState(
    entry,
    "7",
    snapshot({
      favorites: new Set([7]),
      download: (job) => (job === missingSongJobId(7) ? queued : null),
    }),
  );
  assert.equal(row.state.starred, true);
  assert.deepEqual(row.state.download, queued);
});

test("a history row's explicit state wins over the list's playing and favorite sets", () => {
  const entry: SongListEntry = {
    source: {
      kind: "history",
      id: 3,
      trackId: "7",
      title: "Library",
      artist: "Artist",
      durationMs: 1000,
    },
    state: { playing: false, starred: false, remoteArtwork: true, trailingLabel: "9:41" },
  };
  const row = songRowState(
    entry,
    "play:3",
    snapshot({ playing: new Set(["7"]), favorites: new Set([7]), ytMusic: false }),
  );
  assert.equal(row.state.playing, false);
  assert.equal(row.state.starred, false);
  assert.equal(row.state.remoteArtwork, true);
  assert.equal(row.state.trailingLabel, "9:41");
});

test("a queue row follows the entry's song id", () => {
  const entry: SongListEntry = {
    source: { kind: "queue", entry: { key: "q1", trackId: "7" }, track: librarySong },
  };
  assert.equal(
    songRowState(entry, "q1", snapshot({ playing: new Set(["7"]) })).state.playing,
    true,
  );
});

test("a ranked stream that can't play is dimmed and its tap is blocked", () => {
  const entry: SongListEntry = { source: { kind: "ytMusic", song: yt("v") }, gated: true };
  const playable = songRowState(entry, "yt:v", snapshot());
  assert.equal(playable.blocked, false);
  assert.notEqual(playable.state.unavailable, true);
  const refused = songRowState(entry, "yt:v", snapshot({ unplayable: new Set(["v"]) }));
  assert.equal(refused.blocked, true);
  assert.equal(refused.state.unavailable, true);
  const off = songRowState(entry, "yt:v", snapshot({ ytMusic: false }));
  assert.equal(off.blocked, true);
  assert.equal(off.state.remoteArtwork, false);
  // Ungated lists (an album's page) never block a stream.
  const plain = songRowState({ source: entry.source }, "yt:v", snapshot({ ytMusic: false }));
  assert.equal(plain.blocked, false);
});

test("a YT Music song stars as its pending favorite", () => {
  const entry: SongListEntry = { source: { kind: "ytMusic", song: yt("v") } };
  assert.equal(
    songRowState(entry, "yt:v", snapshot({ pending: new Set(["v"]) })).state.starred,
    true,
  );
  assert.equal(
    songRowState(entry, "yt:v", snapshot({ favorites: new Set([7]) })).state.starred,
    false,
  );
});

test("songs key by id, with an occurrence counter only for real duplicates", () => {
  const songs = ["a", "b", "a", "c", "a"].map((id) => ({ id }));
  const keys = occurrenceKeys(songs, (song) => song.id);
  assert.deepEqual(
    songs.map((song) => keys.get(song)),
    ["a", "b", "a:occurrence:1", "c", "a:occurrence:2"],
  );
  // A list that fills in keeps the keys its earlier songs had.
  const more = [...songs, { id: "b" }];
  const grown = occurrenceKeys(more, (song) => song.id);
  assert.deepEqual(
    songs.map((song) => grown.get(song)),
    songs.map((song) => keys.get(song)),
  );
  assert.equal(grown.get(more[5]!), "b:occurrence:1");
});
