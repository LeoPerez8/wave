import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  findRecording,
  joinLibraries,
  mergePlays,
  mergeRows,
  normalizeTrack,
  recordingKey,
} from "./index.ts";
import type { RawTrack } from "./index.ts";

const MUSIC = "/storage/emulated/0/Music";

const something: RawTrack = {
  path: `${MUSIC}/The Beatles/Abbey Road/02 Something.flac`,
  title: "Something",
  artist: "The Beatles",
  album: "Abbey Road",
  albumArtist: "The Beatles",
  trackNumber: "2/17",
  discNumber: "1/1",
  durationMs: 182_000,
};

const keyOf = (raw: RawTrack): string => recordingKey(normalizeTrack(raw));

describe("recordingKey", () => {
  test("a re-download from another source is the same recording", () => {
    const redownload: RawTrack = {
      path: `${MUSIC}/Downloads/beatles_something_320.mp3`,
      title: "something!",
      artist: "The Beatles",
      album: "abbey  road",
      albumArtist: "the beatles",
      trackNumber: "2",
      discNumber: "1",
      durationMs: 183_500,
    };
    assert.equal(keyOf(redownload), keyOf(something));
  });

  test("the album version and the single are different recordings", () => {
    const single: RawTrack = {
      ...something,
      path: `${MUSIC}/The Beatles/Something/01 Something.mp3`,
      album: "Something",
      trackNumber: "1",
    };
    assert.notEqual(keyOf(single), keyOf(something));
  });

  test("a file without a disc number is on disc 1", () => {
    assert.equal(keyOf({ ...something, discNumber: null }), keyOf(something));
    assert.notEqual(keyOf({ ...something, discNumber: "2" }), keyOf(something));
  });

  test("a file without a track number keys on its album and title", () => {
    const untracked = { ...something, trackNumber: null, discNumber: null };
    assert.equal(keyOf({ ...untracked, path: `${MUSIC}/other.ogg` }), keyOf(untracked));
    assert.notEqual(keyOf(untracked), keyOf({ ...untracked, title: "Come Together" }));
  });

  test("a song with no album tag keys on its album artist and title", () => {
    const loose: RawTrack = {
      path: `${MUSIC}/Downloads/Something.mp3`,
      title: "Something",
      artist: "The Beatles",
      trackNumber: "4",
    };
    const elsewhere: RawTrack = {
      path: `${MUSIC}/Phone/the beatles - something.m4a`,
      title: "Something",
      artist: "the Beatles",
    };
    assert.equal(keyOf(elsewhere), keyOf(loose));
    assert.notEqual(keyOf(loose), keyOf({ ...loose, artist: "Shirley Bassey" }));
    assert.notEqual(keyOf(loose), keyOf(something));
    assert.equal(
      recordingKey({
        title: "Something",
        album: null,
        albumArtist: "The Beatles",
        discNumber: null,
        trackNumber: null,
      }),
      keyOf(loose),
    );
  });
});

describe("findRecording", () => {
  const song = { recordingKey: "k", durationMs: 200_000 };
  const take = (durationMs: number, key = "k") => ({ recordingKey: key, durationMs });

  test("the one candidate with the song's key is the song, whatever its length", () => {
    const only = take(260_000);
    assert.equal(findRecording(song, [take(200_000, "other"), only]), only);
  });

  test("no candidate with the song's key is no match", () => {
    assert.equal(findRecording(song, [take(200_000, "other")]), null);
  });

  test("among several with the key, the one within 3 seconds wins", () => {
    const close = take(202_900);
    assert.equal(findRecording(song, [take(240_000), close, take(196_000)]), close);
  });

  test("among several with the key, two within 3 seconds leave no winner", () => {
    assert.equal(findRecording(song, [take(198_000), take(203_000), take(260_000)]), null);
  });

  test("among several with the key, none within 3 seconds leaves no winner", () => {
    assert.equal(findRecording(song, [take(230_000), take(170_000)]), null);
  });
});

interface PlaylistRow {
  readonly id: string;
  readonly changedAt: number;
  readonly phoneId: string;
  readonly deleted: boolean;
  readonly name: string;
}

const row = (
  id: string,
  changedAt: number,
  phoneId: string,
  name: string,
  deleted = false,
): PlaylistRow => ({ id, changedAt, phoneId, deleted, name });

describe("mergeRows", () => {
  test("the later change wins, whichever side it's on", () => {
    const older = row("p1", 1_000, "pixel", "Road trip");
    const newer = row("p1", 2_000, "galaxy", "Road Trip 2026");
    assert.deepEqual(mergeRows([older], [newer]).rows, [newer]);
    assert.deepEqual(mergeRows([newer], [older]).rows, [newer]);
  });

  test("changes made at the same time are told apart by the phone id", () => {
    const fromA = row("p1", 1_000, "a-phone", "Gym");
    const fromB = row("p1", 1_000, "b-phone", "Running");
    assert.deepEqual(mergeRows([fromA], [fromB]).rows, [fromB]);
    assert.deepEqual(mergeRows([fromB], [fromA]).rows, [fromB]);
  });

  test("a removal beats an older edit that arrives late", () => {
    const removed = row("p1", 3_000, "pixel", "Gym", true);
    const lateEdit = row("p1", 2_000, "galaxy", "Gym (old)");
    const merged = mergeRows([removed], [lateEdit]);
    assert.deepEqual(merged.rows, [removed]);
    assert.deepEqual(merged.accepted, []);
  });

  test("an edit made after a removal brings the row back", () => {
    const removed = row("p1", 3_000, "pixel", "Gym", true);
    const edit = row("p1", 4_000, "galaxy", "Gym again");
    const merged = mergeRows([removed], [edit]);
    assert.deepEqual(merged.rows, [edit]);
    assert.deepEqual(merged.accepted, [edit]);
  });

  test("accepted holds the incoming rows that won, and rows keeps every id", () => {
    const kept = row("p1", 5_000, "pixel", "Mine");
    const stale = row("p1", 1_000, "galaxy", "Stale");
    const fresh = row("p2", 1_000, "galaxy", "New one");
    const merged = mergeRows([kept], [stale, fresh]);
    assert.deepEqual(merged.rows, [kept, fresh]);
    assert.deepEqual(merged.accepted, [fresh]);
  });

  test("the same changes merged in any order give the same rows", () => {
    const changes = [
      row("p1", 1_000, "pixel", "Gym"),
      row("p1", 2_000, "galaxy", "Gym 2"),
      row("p1", 2_000, "pixel", "Gym 2 (pixel)"),
      row("p1", 3_000, "galaxy", "Gym", true),
      row("p2", 1_000, "pixel", "Chill"),
      row("p2", 5_000, "galaxy", "Chill out"),
      row("p3", 4_000, "pixel", "Old", true),
      row("p3", 1_000, "galaxy", "Older edit"),
    ];
    const expected = [changes[3], changes[5], changes[6]];
    assert.deepEqual(mergeRows([], changes).rows, expected);
    for (const order of permutationsOf(changes, 40)) {
      let rows: readonly PlaylistRow[] = [];
      for (const change of order) rows = mergeRows(rows, [change]).rows;
      assert.deepEqual(rows, expected);
      const half = Math.floor(order.length / 2);
      const split = mergeRows(order.slice(0, half), order.slice(half)).rows;
      assert.deepEqual(split, expected);
    }
  });
});

describe("mergePlays", () => {
  const play = (id: string, listenedMs: number) => ({ id, recordingKey: "k", listenedMs });

  test("a play is added once, and a play already held is never changed", () => {
    const first = play("pixel-1", 120_000);
    const second = play("galaxy-1", 30_000);
    const merged = mergePlays(
      [first],
      [play("pixel-1", 999), second, play("galaxy-1", 1)],
    );
    assert.deepEqual(merged.plays, [first, second]);
    assert.deepEqual(merged.added, [second]);
  });
});

describe("joinLibraries", () => {
  const track = (id: number, key: string) => ({ id, recordingKey: key });
  const accountSong = (key: string) => ({ recordingKey: key, title: key });
  const noPlaylists = { playlists: [] };

  test("the account's songs the phone has become its Tracks, the rest come in missing", () => {
    const join = joinLibraries({
      phone: { songs: [track(1, "abbey road/something"), track(2, "revolver/taxman")], playlists: [] },
      account: {
        songs: [accountSong("abbey road/something"), accountSong("help/yesterday")],
        playlists: [],
      },
    });
    assert.deepEqual(join.tracks, [
      { account: accountSong("abbey road/something"), phone: [track(1, "abbey road/something")] },
    ]);
    assert.deepEqual(join.missing, [accountSong("help/yesterday")]);
    assert.deepEqual(join.up, [track(2, "revolver/taxman")]);
  });

  test("two files with one recording key are one song: it goes up once, and both are its Tracks", () => {
    const flac = track(1, "abbey road/something");
    const mp3 = track(2, "abbey road/something");
    const alone = joinLibraries({ phone: { songs: [flac, mp3], ...noPlaylists }, account: { songs: [], ...noPlaylists } });
    assert.deepEqual(alone.up, [flac]);
    assert.deepEqual(alone.tracks, []);

    const joined = joinLibraries({
      phone: { songs: [flac, mp3], ...noPlaylists },
      account: { songs: [accountSong("abbey road/something")], ...noPlaylists },
    });
    assert.deepEqual(joined.tracks, [{ account: accountSong("abbey road/something"), phone: [flac, mp3] }]);
    assert.deepEqual(joined.up, []);
    assert.deepEqual(joined.missing, []);
  });

  test("playlists with the same name stay two playlists", () => {
    const mine = row("pl-phone", 1_000, "pixel", "Favourites");
    const theirs = row("pl-account", 2_000, "galaxy", "Favourites");
    const join = joinLibraries({
      phone: { songs: [], playlists: [mine] },
      account: { songs: [], playlists: [theirs] },
    });
    assert.deepEqual(join.playlistsUp, [mine]);
    assert.deepEqual(join.playlistsDown, [theirs]);
  });

  test("a playlist both sides have, from an earlier sign-in, keeps its latest change", () => {
    const renamedHere = row("pl-1", 5_000, "pixel", "Gym (new)");
    const onAccount = row("pl-1", 2_000, "galaxy", "Gym");
    const removedThere = row("pl-2", 6_000, "galaxy", "Old", true);
    const keptHere = row("pl-2", 1_000, "pixel", "Old");
    const join = joinLibraries({
      phone: { songs: [], playlists: [renamedHere, keptHere] },
      account: { songs: [], playlists: [onAccount, removedThere] },
    });
    assert.deepEqual(join.playlistsUp, [renamedHere]);
    assert.deepEqual(join.playlistsDown, [removedThere]);
  });
});

/** [count] orders of [items], made by a fixed shuffle so a failure repeats. */
const permutationsOf = <T>(items: readonly T[], count: number): T[][] => {
  let seed = 7;
  const random = (): number => {
    seed = (seed * 48_271) % 2_147_483_647;
    return seed / 2_147_483_647;
  };
  const orders = [[...items], [...items].reverse()];
  while (orders.length < count) {
    const order = [...items];
    for (let i = order.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [order[i], order[j]] = [order[j] as T, order[i] as T];
    }
    orders.push(order);
  }
  return orders;
};
