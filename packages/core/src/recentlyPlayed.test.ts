import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  recentlyPlayedAlbums,
  mixReplayContext,
  recentlyPlayedContexts,
  recordedPlayContext,
  type LatestPlayedSong,
  type RecentlyPlayedContext,
  type RecentPlay,
} from "./index.ts";

/** Songs as the store reads them, latest played first: [album id, latest play]. */
const songs = (...rows: [number, number][]): LatestPlayedSong[] =>
  rows.map(([albumId, lastPlayedAt]) => ({ albumId, lastPlayedAt }));

describe("recentlyPlayedAlbums", () => {
  test("lists each album once, by its latest play, the latest first", () => {
    const read = songs([3, 900], [1, 800], [3, 700], [2, 600], [1, 500]);

    assert.deepEqual(recentlyPlayedAlbums(read, 12, true), [3, 1, 2]);
  });

  test("stops at the limit", () => {
    const read = songs([5, 900], [4, 800], [3, 700], [2, 600], [1, 500]);

    assert.deepEqual(recentlyPlayedAlbums(read, 2, false), [5, 4]);
  });

  test("albums last played at the same time come by album, the latest added first", () => {
    const read = songs([2, 900], [7, 900], [4, 800]);

    assert.deepEqual(recentlyPlayedAlbums(read, 12, true), [7, 2, 4]);
  });

  test("on a tie, Library albums, the latest added first, come before online ones in order", () => {
    const read: LatestPlayedSong<number | string>[] = [
      { albumId: "MPREb_b", lastPlayedAt: 900 },
      { albumId: 2, lastPlayedAt: 900 },
      { albumId: "MPREb_a", lastPlayedAt: 900 },
      { albumId: 7, lastPlayedAt: 900 },
    ];

    assert.deepEqual(recentlyPlayedAlbums(read, 12, true), [7, 2, "MPREb_a", "MPREb_b"]);
  });

  test("needs more songs while the songs read hold too few albums and others remain", () => {
    const read = songs([3, 900], [3, 800], [2, 700]);

    assert.equal(recentlyPlayedAlbums(read, 3, false), null);
  });

  test("an album played when the songs read stop may tie with one not read yet", () => {
    // Album 1's song at 700 is the last read: an unread song of album 9 may have played at 700 too.
    const read = songs([3, 900], [2, 800], [1, 700]);

    assert.equal(recentlyPlayedAlbums(read, 3, false), null);
    assert.deepEqual(recentlyPlayedAlbums(read, 2, false), [3, 2]);
  });

  test("with every played song read, the albums there are, however few", () => {
    assert.deepEqual(recentlyPlayedAlbums(songs([3, 900], [2, 700]), 12, true), [3, 2]);
    assert.deepEqual(recentlyPlayedAlbums([], 12, true), []);
  });
});

/** Plays as the store reads them, latest first: [context kind, context id, track id, started at]. */
const plays = (...rows: [string | null, string | null, string, number][]): RecentPlay[] =>
  rows.map(([kind, id, trackId, startedAt]) => ({
    context: kind === null ? null : { kind, id },
    trackId,
    startedAt,
  }));

const shown = (contexts: readonly RecentlyPlayedContext[] | null) =>
  contexts?.map((entry) => `${entry.kind} ${entry.context.kind}:${entry.context.id}`) ?? null;

describe("recentlyPlayedContexts", () => {
  test("shows where each play came from, once, at its latest play", () => {
    const read = plays(
      ["playlist", "4", "10", 900],
      ["album", "7", "11", 800],
      ["playlist", "4", "12", 700],
      ["ytAlbum", "MPREb_x", "yt:a", 600],
      ["ytPlaylist", "PLx", "yt:b", 500],
      ["artist", "3", "13", 400],
    );

    assert.deepEqual(shown(recentlyPlayedContexts(read, 12, true)), [
      "playlist playlist:4",
      "album album:7",
      "album ytAlbum:MPREb_x",
      "playlist ytPlaylist:PLx",
      "artist artist:3",
    ]);
  });

  test("a song played on its own shows the song, not its album", () => {
    // A Search tap's related songs play as the song's (`song` names it).
    const read = plays(
      ["search", null, "21", 900],
      ["songs", null, "22", 800],
      [null, null, "yt:c", 700],
      ["song", "23", "yt:related", 650],
      ["song", "23", "23", 600],
      ["search", null, "21", 500],
      ["home", "favorites", "24", 400],
    );

    assert.deepEqual(shown(recentlyPlayedContexts(read, 12, true)), [
      "song song:21",
      "song song:22",
      "song song:yt:c",
      "song song:23",
      "song song:24",
    ]);
  });

  test("a mix shows once, as the mix, replayed or not", () => {
    const replay = mixReplayContext({ kind: "dj", id: "77" });
    const read = plays(
      [replay.kind, replay.id, "31", 900],
      ["magic", "55", "yt:d", 800],
      ["discoverMix", "mix-1", "yt:e", 700],
      ["dj", "77", "32", 600],
      ["related", null, "yt:f", 500],
      ["magic", "55", "33", 400],
      ["newReleases", "9", "34", 300],
    );

    assert.deepEqual(shown(recentlyPlayedContexts(read, 12, true)), [
      "mix dj:77",
      "mix magic:55",
      "mix discoverMix:mix-1",
      "mix related:null",
      "mix newReleases:9",
    ]);
    assert.deepEqual(recentlyPlayedContexts(read, 12, true)?.[1], {
      kind: "mix",
      context: { kind: "magic", id: "55" },
      trackId: "yt:d",
      playedAt: 800,
    });
  });
});

describe("recentlyPlayedContexts, read a page at a time", () => {
  test("stops at the limit", () => {
    const read = plays(
      ["album", "1", "1", 900],
      ["album", "2", "2", 800],
      ["album", "3", "3", 700],
    );

    assert.deepEqual(shown(recentlyPlayedContexts(read, 2, false)), [
      "album album:1",
      "album album:2",
    ]);
  });

  test("needs more plays while those read hold too few contexts and others remain", () => {
    const read = plays(["album", "1", "1", 900], ["album", "1", "2", 800]);

    assert.equal(recentlyPlayedContexts(read, 2, false), null);
    assert.deepEqual(shown(recentlyPlayedContexts(read, 2, true)), ["album album:1"]);
    assert.deepEqual(recentlyPlayedContexts([], 12, true), []);
  });
});

describe("recordedPlayContext", () => {
  const session = (seed: { kind: string; id: string }, plainPlay?: boolean) => ({
    id: "55",
    seed,
    ...(plainPlay === undefined ? {} : { plainPlay }),
  });
  const magic = { kind: "magic", id: "55" };

  test("a session a plain play of a song began records its plays as that song's", () => {
    assert.deepEqual(recordedPlayContext(magic, session({ kind: "track", id: "yt:s" }, true)), {
      kind: "song",
      id: "yt:s",
    });
  });

  test("a DJ session records its plays as the DJ's", () => {
    assert.deepEqual(recordedPlayContext(magic, session({ kind: "dj", id: "55" })), {
      kind: "dj",
      id: "55",
    });
  });

  test("any other queue keeps its context", () => {
    assert.deepEqual(recordedPlayContext(magic, session({ kind: "track", id: "4" })), magic);
    assert.deepEqual(
      recordedPlayContext(magic, { ...session({ kind: "dj", id: "1" }, true), id: "other" }),
      magic,
    );
    assert.deepEqual(recordedPlayContext({ kind: "album", id: "3" }, null), {
      kind: "album",
      id: "3",
    });
    assert.equal(recordedPlayContext(null, session({ kind: "dj", id: "55" })), null);
  });
});
