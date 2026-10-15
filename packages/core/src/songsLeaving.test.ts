import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { songsLeaving } from "./index.ts";

describe("songsLeaving", () => {
  test("a removed song leaves the account with its star and its playlist entries, each a tombstone", () => {
    const removal = songsLeaving({
      leaving: [
        {
          recordingKey: "lucky",
          star: { changedAt: 50 },
          entries: [
            { id: "night-1", changedAt: 40 },
            { id: "drive-3", changedAt: 900 },
          ],
        },
      ],
      staying: [],
      account: [{ recordingKey: "lucky", changedAt: 700, deleted: false }],
      now: 100,
      phoneId: "me",
    });

    assert.deepEqual(removal, {
      songs: [{ id: "lucky", changedAt: 701, phoneId: "me", deleted: true }],
      favorites: [{ id: "lucky", changedAt: 100, phoneId: "me", deleted: true }],
      playlistEntries: [
        { id: "night-1", changedAt: 100, phoneId: "me", deleted: true },
        { id: "drive-3", changedAt: 901, phoneId: "me", deleted: true },
      ],
    });
  });

  test("a song another Track still has stays, as does its star while a staying Track is starred", () => {
    const leaving = [
      { recordingKey: "intro", star: { changedAt: 50 }, entries: [{ id: "e1", changedAt: 10 }] },
    ];
    const account = [{ recordingKey: "intro", changedAt: 20, deleted: false }];
    const base = { leaving, account, now: 100, phoneId: "me" };

    assert.deepEqual(
      songsLeaving({ ...base, staying: [{ recordingKey: "intro", starred: true }] }),
      {
        songs: [],
        favorites: [],
        playlistEntries: [{ id: "e1", changedAt: 100, phoneId: "me", deleted: true }],
      },
    );
    // The Track staying isn't starred: the account's star was the leaving one's.
    assert.deepEqual(
      songsLeaving({ ...base, staying: [{ recordingKey: "intro", starred: false }] }).favorites,
      [{ id: "intro", changedAt: 100, phoneId: "me", deleted: true }],
    );
  });

  test("a song the account doesn't have, or has removed already, sends no tombstone", () => {
    const leaving = [{ recordingKey: "new", star: null, entries: [] }];
    const base = { leaving, staying: [], now: 100, phoneId: "me" };

    assert.deepEqual(songsLeaving({ ...base, account: [] }).songs, []);
    assert.deepEqual(
      songsLeaving({ ...base, account: [{ recordingKey: "new", changedAt: 90, deleted: true }] })
        .songs,
      [],
    );
  });

  test("two Tracks with one key leaving send one song and one star", () => {
    const removal = songsLeaving({
      leaving: [
        { recordingKey: "intro", star: { changedAt: 300 }, entries: [] },
        { recordingKey: "intro", star: { changedAt: 50 }, entries: [] },
      ],
      staying: [],
      account: [{ recordingKey: "intro", changedAt: 20, deleted: false }],
      now: 100,
      phoneId: "me",
    });

    assert.deepEqual(removal.songs, [
      { id: "intro", changedAt: 100, phoneId: "me", deleted: true },
    ]);
    assert.deepEqual(removal.favorites, [
      { id: "intro", changedAt: 301, phoneId: "me", deleted: true },
    ]);
  });
});
