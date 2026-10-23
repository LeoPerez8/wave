import assert from "node:assert/strict";
import { test } from "node:test";

import {
  NO_HELD_SONGS,
  artistSongOrder,
  libraryFinder,
  pagePlayback,
  songsInPlace,
  type MixedSong,
  type SongSortKey,
  type YtSong,
} from "./index.ts";

const track = (id: number, title: string) => ({
  id,
  title,
  artist: "Bad Omens",
  durationMs: 200_000,
  path: `/music/${id}.flac`,
});
type Track = ReturnType<typeof track>;

const yt = (videoId: string, title: string): YtSong => ({
  videoId,
  title,
  artists: ["Bad Omens"],
  durationMs: 200_000,
  album: null,
  artworkUrl: null,
  explicit: false,
});

const library = (song: Track): MixedSong<YtSong, Track> => ({ source: "library", track: song });
const stream = (song: YtSong): MixedSong<YtSong, Track> => ({ source: "stream", song });
const onlinePopular = { sort: "popular", online: true } as const;

test("Online Popular mixes files and streams in YouTube Music's order, ranking every row", () => {
  const ghost = track(1, "Ghost");
  const pretend = track(2, "Just Pretend");
  const decisions = yt("a", "Bad Decisions");
  const zero = yt("d", "Zero");
  const rows = [library(ghost), library(pretend), stream(decisions), stream(zero)];

  assert.deepEqual(
    artistSongOrder(
      rows,
      [decisions, yt("b", "Just Pretend"), yt("c", "Ghost"), zero],
      onlinePopular,
    ),
    [
      { ...stream(decisions), popularRank: 1 },
      { ...library(pretend), popularRank: 2 },
      { ...library(ghost), popularRank: 3 },
      { ...stream(zero), popularRank: 4 },
    ],
  );
});

test("Library songs outside the ranking follow it in song name order without a number", () => {
  const ghost = track(1, "Ghost");
  const zulu = track(2, "Zulu Demo");
  const amber = track(3, "The Ámber Demo");
  const decisions = yt("a", "Bad Decisions");
  assert.deepEqual(
    artistSongOrder(
      [library(zulu), library(ghost), library(amber), stream(decisions)],
      [decisions, yt("b", "Ghost")],
      onlinePopular,
    ),
    [
      { ...stream(decisions), popularRank: 1 },
      { ...library(ghost), popularRank: 2 },
      { ...library(amber), popularRank: undefined },
      { ...library(zulu), popularRank: undefined },
    ],
  );
});

test("every other sort keeps the Library-first list and shows no ranks", () => {
  const ghost = library(track(1, "Ghost"));
  const decisions = stream(yt("a", "Bad Decisions"));
  const sorts: readonly SongSortKey[] = ["title", "artist", "album", "added", "starred"];
  for (const sort of sorts) {
    for (const online of [true, false]) {
      assert.deepEqual(
        artistSongOrder([ghost, decisions], [yt("a", "Bad Decisions"), yt("b", "Ghost")], {
          sort,
          online,
        }),
        [
          { ...ghost, popularRank: undefined },
          { ...decisions, popularRank: undefined },
        ],
      );
    }
  }
});

test("Library Popular keeps its existing order and gaps in the saved ranking", () => {
  const ghost = library(track(1, "Ghost"));
  const demo = library(track(2, "Demo"));
  assert.deepEqual(
    artistSongOrder([ghost, demo], [yt("a", "Bad Decisions"), yt("b", "Ghost")], {
      sort: "popular",
      online: false,
    }),
    [
      { ...ghost, popularRank: 2 },
      { ...demo, popularRank: undefined },
    ],
  );
});

test("before a ranking is saved the list stays in its existing order with no ranks", () => {
  const rows = [library(track(1, "Zero")), library(track(2, "Ghost"))];
  assert.deepEqual(artistSongOrder(rows, null, onlinePopular), [
    { ...rows[0], popularRank: undefined },
    { ...rows[1], popularRank: undefined },
  ]);
});

test("repeated ranking entries keep their first place and leave no gaps or repeated stream rows", () => {
  const ghost = library(track(1, "Ghost"));
  const decisions = stream(yt("a", "Bad Decisions"));
  const zero = stream(yt("z", "Zero"));
  assert.deepEqual(
    artistSongOrder(
      [ghost, decisions, decisions, zero],
      [
        yt("g", "Ghost"),
        yt("g2", "Ghost"),
        yt("a", "Bad Decisions"),
        yt("a", "Bad Decisions"),
        yt("z", "Zero"),
      ],
      onlinePopular,
    ),
    [
      { ...ghost, popularRank: 1 },
      { ...decisions, popularRank: 2 },
      { ...zero, popularRank: 3 },
    ],
  );
});

test("a finished download keeps its ranked row and plays the Library's file", () => {
  const ghost = track(1, "Ghost");
  const decisions = yt("a", "Bad Decisions");
  const popular = [decisions, yt("g", "Ghost")];
  const before = songsInPlace(NO_HELD_SONGS, [decisions], libraryFinder([ghost]), (s) => s.id);
  const downloaded = track(2, "Bad Decisions (Remastered 2011)");
  const after = songsInPlace(
    before.held,
    [decisions],
    libraryFinder([ghost, downloaded]),
    (s) => s.id,
  );
  const shown = artistSongOrder([library(ghost), ...after.songs], popular, onlinePopular);
  assert.deepEqual(shown, [
    { source: "library", song: decisions, track: downloaded, popularRank: 1 },
    { ...library(ghost), popularRank: 2 },
  ]);
  assert.deepEqual(pagePlayback(shown), { kind: "library", tracks: [downloaded, ghost] });
});

test("a ranking arriving reorders the displayed list without changing playback already started", () => {
  const ghost = library(track(1, "Ghost"));
  const decisions = stream(yt("a", "Bad Decisions"));
  const before = artistSongOrder([ghost, decisions], null, onlinePopular);
  const playing = pagePlayback(before);
  const after = artistSongOrder(
    before,
    [yt("a", "Bad Decisions"), yt("g", "Ghost")],
    onlinePopular,
  );
  assert.deepEqual(after, [
    { ...decisions, popularRank: 1 },
    { ...ghost, popularRank: 2 },
  ]);
  assert.deepEqual(playing, {
    kind: "mixed",
    songs: [
      { ...ghost, popularRank: undefined },
      { ...decisions, popularRank: undefined },
    ],
  });
  assert.deepEqual(pagePlayback(after), { kind: "mixed", songs: after });
});
