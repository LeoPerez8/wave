/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  blackPlayerPlayId,
  normalizeTrack,
  orderKeyBetween,
  recordingKey,
  writePlaylistYtSong,
  type PlayEvent,
  type YtAlbumSong,
} from "@wave/core";
import { sql } from "drizzle-orm";

import type { IndexedTrack } from "../LibraryStore.ts";
import { importedPlays, saveImportedPlays } from "./blackPlayer.ts";
import { creditSplits } from "./credits.ts";
import { libraryCounts } from "./counts.ts";
import { latestPlay, listFavorites, recordPlay } from "./playHistory.ts";
import { selectPlaylistEntries } from "./playlists.ts";
import { saveBatch } from "./save.ts";
import * as schema from "./schema.ts";
import {
  selectChangesSince,
  selectPhoneId,
  selectTrackIdentities,
  stampPreference,
} from "./sync.ts";
import { selectJoinedAccount, selectUnpushed } from "./syncRows.ts";
import {
  addTrack,
  migrateTestDatabase,
  openTestDatabase,
  star,
  type TestDatabase,
} from "./testDatabase.ts";
import { deleteTracks } from "./tracks.ts";

const yt = (videoId: string, title: string): YtAlbumSong => ({
  videoId,
  title,
  artists: ["Radiohead"],
  album: "OK Computer",
  albumId: "MPREb_ok",
  durationMs: 180_000,
  artworkUrl: null,
  explicit: false,
});

/** The keys adding [count] entries one after the other at the end of a playlist makes. */
const keysInOrder = (count: number): string[] => {
  const keys: string[] = [];
  for (let i = 0; i < count; i++) keys.push(orderKeyBetween(keys.at(-1) ?? null, null));
  return keys;
};

/** A Library as the Wave before accounts left it: plays (BlackPlayer's too), stars and playlists with YT Music entries. */
const before = async () => {
  const old = await openTestDatabase({ through: "0017_imported_plays" });
  const airbag = addTrack(old, {
    title: "Airbag",
    album: "OK Computer",
    artist: "Radiohead",
    trackNumber: 1,
  });
  const lucky = addTrack(old, {
    title: "Lucky",
    album: "OK Computer",
    artist: "Radiohead",
    trackNumber: 11,
  });
  const gone = addTrack(old, { title: "Gone", album: "Single", artist: "Someone" });
  const play = (trackId: number, startedAt: number, importedFrom: string | null) =>
    old.run(sql`INSERT INTO play_events (track_id, started_at, listened_ms, duration_ms, end_reason, counted, imported_from)
      VALUES (${trackId}, ${startedAt}, 180000, 180000, 'completed', 1, ${importedFrom})`);
  play(airbag, 1_000, "blackplayer");
  play(airbag, 2_000, null);
  play(lucky, 3_000, null);
  play(gone, 4_000, null);
  // Deleted before the update: its plays stay, with no song to key them by.
  old.run(sql`DELETE FROM tracks WHERE id = ${gone}`);
  star(old, lucky, 5_000);
  star(old, airbag, 6_000);
  const drive = old.get<{ id: number }>(
    sql`INSERT INTO playlists (name, created_at, updated_at) VALUES ('Drive', 10, 20) RETURNING id`,
  ).id;
  const empty = old.get<{ id: number }>(
    sql`INSERT INTO playlists (name, created_at, updated_at) VALUES ('Empty', 30, 40) RETURNING id`,
  ).id;
  // Out of order, with gaps and a shared position (the item id breaks the tie).
  const entry = (trackId: number | null, ytSong: string | null, position: number) =>
    old.run(sql`INSERT INTO playlist_items (playlist_id, track_id, yt_song, position, added_at)
      VALUES (${drive}, ${trackId}, ${ytSong}, ${position}, ${100 + position})`);
  entry(airbag, null, 7);
  entry(lucky, null, 0);
  entry(null, writePlaylistYtSong(yt("v1", "Exit Music")), 3);
  entry(lucky, null, 7);
  return { db: old, airbag, lucky, gone, drive, empty };
};

describe("migration 0018", () => {
  test("keeps every playlist's order, every star and every play", async () => {
    const { db, airbag, lucky, gone, drive } = await before();
    // The order the Wave before accounts listed them in.
    const itemIds = db
      .all<{ id: number }>(sql`SELECT id FROM playlist_items ORDER BY position, id`)
      .map((row) => row.id);

    await migrateTestDatabase(db);

    assert.deepEqual(
      selectPlaylistEntries(db, drive).map((entry) =>
        entry.source === "library" ? entry.track.title : `yt:${entry.song.title}`,
      ),
      ["Lucky", "yt:Exit Music", "Airbag", "Lucky"],
    );
    assert.deepEqual(
      selectPlaylistEntries(db, drive).map((entry) => entry.itemId),
      itemIds,
    );
    assert.deepEqual(libraryCounts(db), {
      playlists: 2,
      artists: 1,
      albums: 1,
      songs: 2,
      genres: 0,
      favorites: 2,
    });
    assert.deepEqual(
      listFavorites(db).map((row) => [row.id, row.starredAt]),
      [
        [airbag, 6_000],
        [lucky, 5_000],
      ],
    );
    assert.deepEqual(
      db
        .select({ trackId: schema.playEvents.trackId, startedAt: schema.playEvents.startedAt })
        .from(schema.playEvents)
        .all(),
      [
        { trackId: airbag, startedAt: 1_000 },
        { trackId: airbag, startedAt: 2_000 },
        { trackId: lucky, startedAt: 3_000 },
        { trackId: gone, startedAt: 4_000 },
      ],
    );
    assert.deepEqual(importedPlays(db), [{ trackId: airbag, plays: 1, latestAt: 1_000 }]);
  });

  test("tracks keep their ids, credits and files, and get their recording key", async () => {
    const { db, airbag, lucky } = await before();
    await migrateTestDatabase(db);
    assert.deepEqual(selectTrackIdentities(db), [
      {
        id: airbag,
        path: "/Music/OK Computer/Airbag.mp3",
        recordingKey: recordingKey({
          title: "Airbag",
          album: "OK Computer",
          albumArtist: "Radiohead",
          discNumber: null,
          trackNumber: 1,
        }),
        videoId: null,
        durationMs: 180_000,
      },
      {
        id: lucky,
        path: "/Music/OK Computer/Lucky.mp3",
        recordingKey: recordingKey({
          title: "Lucky",
          album: "OK Computer",
          albumArtist: "Radiohead",
          discNumber: null,
          trackNumber: 11,
        }),
        videoId: null,
        durationMs: 180_000,
      },
    ]);
    const credits = db
      .select({ trackId: schema.trackArtists.trackId })
      .from(schema.trackArtists)
      .all()
      .map((row) => row.trackId);
    assert.deepEqual(credits.toSorted(), [airbag, lucky].toSorted());
  });

  test("a song added after the update never takes a deleted song's id", async () => {
    const { db, gone } = await before();
    await migrateTestDatabase(db);
    const added = addTrack(db, { title: "New", album: "Later" });
    assert.ok(added > gone, `${added} after ${gone}`);
  });

  test("plays get their song's recording key; plays of songs deleted before stay without one", async () => {
    const { db, airbag, lucky, gone } = await before();
    await migrateTestDatabase(db);
    const keys = new Map(selectTrackIdentities(db).map((track) => [track.id, track.recordingKey]));
    assert.deepEqual(
      db
        .select({ trackId: schema.playEvents.trackId, key: schema.playEvents.recordingKey })
        .from(schema.playEvents)
        .all(),
      [
        { trackId: airbag, key: keys.get(airbag) },
        { trackId: airbag, key: keys.get(airbag) },
        { trackId: lucky, key: keys.get(lucky) },
        { trackId: gone, key: null },
      ],
    );
  });

  test("playlists and entries get ids of their own and entries order keys in their order, stamped by this phone", async () => {
    const { db, drive, empty } = await before();
    await migrateTestDatabase(db);
    const phoneId = selectPhoneId(db);
    assert.match(phoneId, /^[0-9a-f]{32}$/);
    const changes = selectChangesSince(db, 0);

    assert.deepEqual(
      changes.playlists.map((row) => [row.name, row.changedAt, row.phoneId, row.deleted]),
      [
        ["Drive", 20, phoneId, false],
        ["Empty", 40, phoneId, false],
      ],
    );
    const ids = [
      ...changes.playlists.map((row) => row.syncId),
      ...changes.entries.map((row) => row.syncId),
    ];
    assert.ok(ids.every((id) => /^[0-9a-f]{32}$/.test(id)));
    assert.equal(new Set(ids).size, ids.length);

    const driveId = changes.playlists.find((row) => row.name === "Drive")?.syncId;
    const entries = selectPlaylistEntries(db, drive).map((entry) =>
      changes.entries.find((row) => row.itemId === entry.itemId),
    );
    assert.deepEqual(
      entries.map((row) => row?.orderKey),
      keysInOrder(4),
    );
    assert.ok(entries.every((row) => row?.playlistSyncId === driveId));
    assert.deepEqual(
      entries.map((row) => [row?.changedAt, row?.phoneId, row?.deleted]),
      [
        [100, phoneId, false],
        [103, phoneId, false],
        [107, phoneId, false],
        [107, phoneId, false],
      ],
    );
    assert.equal(selectPlaylistEntries(db, empty).length, 0);
  });

  test("a long playlist's entries get the keys adding them one by one makes, past the short ones", async () => {
    const old = await openTestDatabase({ through: "0017_imported_plays" });
    const song = addTrack(old, { title: "Airbag" });
    const id = old.get<{ id: number }>(
      sql`INSERT INTO playlists (name, created_at, updated_at) VALUES ('Long', 0, 0) RETURNING id`,
    ).id;
    // Positions counting down, so the playlist's order is the reverse of the rows'.
    old.run(sql`WITH RECURSIVE n(i) AS (SELECT 0 UNION ALL SELECT i + 1 FROM n WHERE i < 3999)
      INSERT INTO playlist_items (playlist_id, track_id, position, added_at)
      SELECT ${id}, ${song}, 4000 - i, i FROM n`);
    await migrateTestDatabase(old);

    const keys = new Map(
      selectChangesSince(old, -1).entries.map((row) => [row.itemId, row.orderKey]),
    );
    assert.deepEqual(
      selectPlaylistEntries(old, id).map((entry) => keys.get(entry.itemId)),
      keysInOrder(4_000),
    );
  });

  test("stars are stamped by this phone when they were made", async () => {
    const { db, airbag, lucky } = await before();
    await migrateTestDatabase(db);
    const phoneId = selectPhoneId(db);
    assert.deepEqual(
      selectChangesSince(db, 0).favorites.map((row) => [
        row.trackId,
        row.changedAt,
        row.phoneId,
        row.deleted,
      ]),
      [
        [lucky, 5_000, phoneId, false],
        [airbag, 6_000, phoneId, false],
      ],
    );
  });
});

const play = (trackId: number): PlayEvent => ({
  trackId: String(trackId),
  context: null,
  startedAt: 1_000,
  listenedMs: 0,
  durationMs: null,
  endReason: "stopped",
  counted: false,
  source: "phone",
});
const playKeys = (db: TestDatabase) =>
  db
    .select({ trackId: schema.playEvents.trackId, key: schema.playEvents.recordingKey })
    .from(schema.playEvents)
    .all();

describe("migration 0019", () => {
  test("every play with a song goes up once, imported ones by BlackPlayer's ids; the latest goes on", async () => {
    const { db, airbag, lucky, gone } = await before();
    await migrateTestDatabase(db);
    const keys = new Map(selectTrackIdentities(db).map((track) => [track.id, track.recordingKey]));

    const plays = selectUnpushed(db, 100, () => null).rows.plays;
    assert.deepEqual(
      plays.map((row) => [row.songId, row.startedAt, row.importedFrom]),
      [
        [keys.get(airbag), 1_000, "blackplayer"],
        [keys.get(airbag), 2_000, null],
        [keys.get(lucky), 3_000, null],
      ],
    );
    assert.equal(plays[0]?.id, blackPlayerPlayId(keys.get(airbag) ?? "", 1));
    assert.match(plays[1]?.id ?? "", /^[0-9a-f]{32}$/);
    assert.match(plays[2]?.id ?? "", /^[0-9a-f]{32}$/);
    // The play the player may still be on is picked back up as before.
    assert.equal(latestPlay(db)?.play.trackId, String(gone));
  });

  test("nothing is on the account yet: every playlist, entry and star waits to go up", async () => {
    const { db } = await before();
    await migrateTestDatabase(db);
    const rows = selectUnpushed(db, 100, () => null).rows;
    assert.deepEqual(
      [rows.playlists.length, rows.playlistEntries.length, rows.favorites.length],
      [2, 4, 2],
    );
    assert.equal(selectJoinedAccount(db), null);
  });
});

describe("plays", () => {
  test("a play records its song's recording key, which it keeps once the file is deleted", async () => {
    const db = await openTestDatabase();
    const airbag = addTrack(db, { title: "Airbag", album: "OK Computer", trackNumber: 1 });
    const key = selectTrackIdentities(db)[0]?.recordingKey;
    assert.ok(key);
    recordPlay(db, play(airbag));
    saveImportedPlays(db, [{ trackId: airbag, startedAt: 500 }]);
    deleteTracks(db, ["/Music/OK Computer/Airbag.mp3"]);
    assert.deepEqual(playKeys(db), [
      { trackId: airbag, key },
      { trackId: airbag, key },
    ]);
  });
});

/** A file as the scanner reads it, tagged as given. */
const scanned = (
  title: string,
  tags: { album?: string; trackNumber?: string } = {},
): IndexedTrack => ({
  ...normalizeTrack({
    path: `/Music/${title}.m4a`,
    title,
    artist: "Radiohead",
    album: tags.album ?? "OK Computer",
    trackNumber: tags.trackNumber ?? "1",
    durationMs: 200_000,
  }),
  sizeBytes: 1_000,
  modifiedAt: 0,
  sampleRate: null,
  bitrateKbps: null,
  artworkHash: null,
  hasLyrics: false,
});

const identityOf = (db: TestDatabase, path: string) =>
  selectTrackIdentities(db).find((track) => track.path === path);

describe("saving files", () => {
  test("a scanned file gets its recording key and no video id", async () => {
    const db = await openTestDatabase();
    saveBatch(db, creditSplits(), [scanned("Airbag")], [], [], 0);
    assert.deepEqual(identityOf(db, "/Music/Airbag.m4a"), {
      id: identityOf(db, "/Music/Airbag.m4a")?.id,
      path: "/Music/Airbag.m4a",
      recordingKey: recordingKey({
        title: "Airbag",
        album: "OK Computer",
        albumArtist: "Radiohead",
        discNumber: null,
        trackNumber: 1,
      }),
      videoId: null,
      durationMs: 200_000,
    });
  });

  test("a file saved again with other tags is keyed by them", async () => {
    const db = await openTestDatabase();
    saveBatch(db, creditSplits(), [scanned("Airbag")], [], [], 0);
    saveBatch(db, creditSplits(), [scanned("Airbag", { trackNumber: "2" })], [], [], 1);
    assert.equal(
      identityOf(db, "/Music/Airbag.m4a")?.recordingKey,
      recordingKey({
        title: "Airbag",
        album: "OK Computer",
        albumArtist: "Radiohead",
        discNumber: null,
        trackNumber: 2,
      }),
    );
  });

  test("a YouTube Music download keeps its video id, also when its file is saved again", async () => {
    const db = await openTestDatabase();
    saveBatch(db, creditSplits(), [{ ...scanned("Lucky"), videoId: "v-lucky" }], [], [], 0);
    assert.equal(identityOf(db, "/Music/Lucky.m4a")?.videoId, "v-lucky");
    // A rescan, or Find Lyrics and Genre writing its tags.
    saveBatch(db, creditSplits(), [scanned("Lucky", { album: "OK Computer OKNOTOK" })], [], [], 1);
    assert.equal(identityOf(db, "/Music/Lucky.m4a")?.videoId, "v-lucky");
  });
});

describe("stampPreference", () => {
  test("records when each synced preference last changed here, one row per preference", async () => {
    const db = await openTestDatabase();
    stampPreference(db, "settings.theme", 1_000);
    stampPreference(db, "settings.glass", 2_000);
    stampPreference(db, "settings.theme", 3_000);
    const phoneId = selectPhoneId(db);
    assert.deepEqual(selectChangesSince(db, 0).preferences, [
      { key: "settings.glass", changedAt: 2_000, phoneId },
      { key: "settings.theme", changedAt: 3_000, phoneId },
    ]);
    assert.deepEqual(
      selectChangesSince(db, 2_000).preferences.map((row) => row.key),
      ["settings.theme"],
    );
  });

  test("two changes of a preference in one millisecond get two times", async () => {
    const db = await openTestDatabase();
    stampPreference(db, "settings.theme", 1_000);
    stampPreference(db, "settings.theme", 1_000);
    assert.equal(selectChangesSince(db, 0).preferences[0]?.changedAt, 1_001);
  });
});

describe("selectPhoneId", () => {
  test("each install has its own phone id, kept for good", async () => {
    const one = await openTestDatabase();
    const other = await openTestDatabase();
    assert.equal(selectPhoneId(one), selectPhoneId(one));
    assert.notEqual(selectPhoneId(one), selectPhoneId(other));
  });
});
