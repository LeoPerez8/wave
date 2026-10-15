import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  accountTrackIds,
  blackPlayerPlayId,
  missingSongTrack,
  planMissingSongs,
  planSongSync,
} from "./index.ts";
import type { AccountSongState, SyncSong, SyncSongFields } from "./index.ts";

const fields = (title: string, more: Partial<SyncSongFields> = {}): SyncSongFields => ({
  title,
  credit: "Radiohead",
  album: "OK Computer",
  albumArtist: "Radiohead",
  discNumber: null,
  trackNumber: null,
  durationMs: 180_000,
  year: 1997,
  genre: null,
  videoId: null,
  addedAt: 1,
  ...more,
});

const accountRow = (id: string, song: SyncSongFields, changedAt = 10): SyncSong => ({
  id,
  changedAt,
  phoneId: "other",
  deleted: false,
  ...song,
});

describe("accountTrackIds", () => {
  test("each account song is the phone's Track with its recording key", () => {
    const tracks = accountTrackIds(
      [
        { id: 1, recordingKey: "airbag", durationMs: 284_000 },
        { id: 2, recordingKey: "lucky", durationMs: 259_000 },
        { id: 3, recordingKey: null, durationMs: 1 },
      ],
      [],
    );
    assert.equal(tracks.get("airbag"), 1);
    assert.equal(tracks.get("lucky"), 2);
    assert.equal(tracks.get("exit music"), undefined);
  });

  test("of two files with one key, the one within 3 seconds of the account song's length", () => {
    const phone = [
      { id: 4, recordingKey: "intro", durationMs: 60_000 },
      { id: 5, recordingKey: "intro", durationMs: 200_000 },
    ];
    assert.equal(
      accountTrackIds(phone, [{ recordingKey: "intro", durationMs: 201_500 }]).get("intro"),
      5,
    );
    // Length can't tell them apart: they're one song for the account, so the first stands for it.
    assert.equal(accountTrackIds(phone, []).get("intro"), 4);
    assert.equal(
      accountTrackIds(phone, [{ recordingKey: "intro", durationMs: 130_000 }]).get("intro"),
      4,
    );
  });
});

describe("planSongSync", () => {
  test("the phone's songs the account lacks go up, one per recording key", () => {
    const plan = planSongSync({
      phone: [
        { recordingKey: "airbag", fields: fields("Airbag") },
        { recordingKey: "airbag", fields: fields("Airbag", { durationMs: 181_000 }) },
      ],
      account: [],
      now: 100,
      phoneId: "me",
    });

    assert.deepEqual(plan.push, [
      { id: "airbag", changedAt: 100, phoneId: "me", deleted: false, ...fields("Airbag") },
    ]);
    assert.equal(plan.local.length, 1);
    assert.equal(plan.local[0]?.recordingKey, "airbag");
    assert.notEqual(plan.local[0]?.local, null);
  });

  test("a song the account has already is the account's: the phone's tags don't go up", () => {
    const plan = planSongSync({
      phone: [{ recordingKey: "airbag", fields: fields("Airbag", { genre: "Rock" }) }],
      account: [{ row: accountRow("airbag", fields("Airbag")), local: null }],
      now: 100,
      phoneId: "me",
    });

    assert.deepEqual(plan.push, []);
    assert.equal(plan.local.length, 1);

    // Synced since, it stays put while the phone's tags stay put.
    const again = planSongSync({
      phone: [{ recordingKey: "airbag", fields: fields("Airbag", { genre: "Rock" }) }],
      account: [
        { row: accountRow("airbag", fields("Airbag")), local: plan.local[0]?.local ?? null },
      ],
      now: 200,
      phoneId: "me",
    });
    assert.deepEqual(again, { push: [], local: [] });
  });

  test("a song retagged on the phone goes up again, after the account's last change", () => {
    const synced = planSongSync({
      phone: [{ recordingKey: "airbag", fields: fields("Airbag") }],
      account: [],
      now: 100,
      phoneId: "me",
    });
    const state: AccountSongState = {
      row: accountRow("airbag", fields("Airbag"), 500),
      local: synced.local[0]?.local ?? null,
    };

    const retagged = planSongSync({
      phone: [{ recordingKey: "airbag", fields: fields("Airbag", { year: 1998 }) }],
      account: [state],
      now: 300,
      phoneId: "me",
    });

    assert.deepEqual(retagged.push, [
      {
        id: "airbag",
        changedAt: 501,
        phoneId: "me",
        deleted: false,
        ...fields("Airbag", { year: 1998 }),
      },
    ]);
  });

  test("a song whose file is gone stays in the account: nothing goes up", () => {
    const synced = planSongSync({
      phone: [{ recordingKey: "airbag", fields: fields("Airbag") }],
      account: [],
      now: 100,
      phoneId: "me",
    });
    const gone = planSongSync({
      phone: [],
      account: [
        { row: accountRow("airbag", fields("Airbag")), local: synced.local[0]?.local ?? null },
      ],
      now: 200,
      phoneId: "me",
    });

    assert.deepEqual(gone, { push: [], local: [{ recordingKey: "airbag", local: null }] });
  });

  test("a song the account removed comes back when the phone has its file", () => {
    const plan = planSongSync({
      phone: [{ recordingKey: "airbag", fields: fields("Airbag") }],
      account: [
        { row: { id: "airbag", changedAt: 700, phoneId: "other", deleted: true }, local: null },
      ],
      now: 100,
      phoneId: "me",
    });

    assert.deepEqual(plan.push, [
      { id: "airbag", changedAt: 701, phoneId: "me", deleted: false, ...fields("Airbag") },
    ]);
  });
});

describe("blackPlayerPlayId", () => {
  test("a song's n-th BlackPlayer play has one id on every phone", () => {
    assert.equal(blackPlayerPlayId("airbag", 3), blackPlayerPlayId("airbag", 3));
    assert.notEqual(blackPlayerPlayId("airbag", 3), blackPlayerPlayId("airbag", 4));
    assert.notEqual(blackPlayerPlayId("airbag", 3), blackPlayerPlayId("lucky", 3));
  });
});

describe("missingSongTrack", () => {
  test("an account song comes in with the tags its file would give, without a file", () => {
    const track = missingSongTrack(
      fields("Airbag", {
        trackNumber: 1,
        discNumber: 1,
        genre: "Alternative",
        durationMs: 284_000,
      }),
    );
    assert.deepEqual(
      {
        title: track.title,
        artist: track.artist,
        artistCredits: track.artistCredits,
        album: track.album,
        albumArtist: track.albumArtist,
        genre: track.genre,
        year: track.year,
        trackNumber: track.trackNumber,
        discNumber: track.discNumber,
        durationMs: track.durationMs,
      },
      {
        title: "Airbag",
        artist: "Radiohead",
        artistCredits: ["Radiohead"],
        album: "OK Computer",
        albumArtist: "Radiohead",
        genre: "Alternative",
        year: 1997,
        trackNumber: 1,
        discNumber: 1,
        durationMs: 284_000,
      },
    );
    // Filed as a scanned copy would be: its album, and its place in title order.
    assert.equal(track.albumKey, missingSongTrack(fields("Lucky")).albumKey);
    assert.equal(track.titleSort, missingSongTrack(fields("airbag")).titleSort);
  });

  test("a song with no album tag files under Unknown Album, as a scanned one does", () => {
    assert.equal(missingSongTrack(fields("Creep", { album: null })).album, "Unknown Album");
  });

  test("a compilation's song keeps its album artist", () => {
    const track = missingSongTrack(
      fields("Teardrop", { credit: "Massive Attack", albumArtist: "Various Artists" }),
    );
    assert.deepEqual([track.artist, track.albumArtist], ["Massive Attack", "Various Artists"]);
  });
});

describe("planMissingSongs", () => {
  test("an account song no Track has comes in as a missing song", () => {
    const plan = planMissingSongs({
      account: [
        { recordingKey: "airbag", song: fields("Airbag") },
        { recordingKey: "lucky", song: fields("Lucky", { videoId: "lucky-video", addedAt: 5 }) },
      ],
      held: ["airbag"],
      missing: [],
    });
    assert.deepEqual(
      plan.save.map((song) => [song.trackId, song.recordingKey, song.track.title, song.videoId]),
      [[null, "lucky", "Lucky", "lucky-video"]],
    );
    assert.equal(plan.save[0]?.addedAt, 5);
    assert.deepEqual([plan.leave, plan.prune], [[], false]);
  });

  /** Missing song Lucky (Track 4) as the Library shows `fields("Lucky")`. */
  const shownLucky = {
    id: 4,
    recordingKey: "lucky",
    title: "Lucky",
    artist: "Radiohead",
    album: "OK Computer",
    albumArtist: "Radiohead",
    genre: null,
    year: 1997,
    trackNumber: null,
    discNumber: null,
    durationMs: 180_000,
    videoId: null,
  };

  test("a missing song whose tags the account has already stays as it is", () => {
    const plan = planMissingSongs({
      account: [{ recordingKey: "lucky", song: fields("Lucky") }],
      held: ["lucky"],
      missing: [shownLucky],
    });
    assert.deepEqual(plan, { save: [], leave: [], prune: false });
  });

  test("a missing song takes the account's tags when another phone changed them", () => {
    const retagged = (song: Partial<SyncSongFields>) =>
      planMissingSongs({
        account: [{ recordingKey: "lucky", song: fields("Lucky", song) }],
        held: ["lucky"],
        missing: [shownLucky],
      });
    const plan = retagged({ genre: "Alternative", trackNumber: 11 });
    assert.deepEqual(
      plan.save.map((song) => [song.trackId, song.recordingKey, song.track.genre]),
      [[4, "lucky", "Alternative"]],
    );
    assert.equal(plan.save[0]?.track.trackNumber, 11);
    assert.equal(plan.prune, true);
    // A video id the song was downloaded from is a change too.
    assert.equal(retagged({ videoId: "lucky-video" }).save[0]?.videoId, "lucky-video");
  });

  test("a missing song the account no longer has leaves, as does one it never had", () => {
    const plan = planMissingSongs({
      account: [{ recordingKey: "airbag", song: fields("Airbag") }],
      held: ["airbag", "lucky"],
      missing: [shownLucky, { ...shownLucky, id: 9, recordingKey: null }],
    });
    assert.deepEqual(plan, { save: [], leave: [4, 9], prune: true });
  });
});
