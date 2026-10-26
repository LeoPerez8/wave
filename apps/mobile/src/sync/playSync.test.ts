import assert from "node:assert/strict";
import { test } from "node:test";
import { type PlayEvent, type YtAlbumSong } from "@wave/core";
import { eq, sql } from "drizzle-orm";

import { harness, pullAll, push } from "../../../sync/src/testing.ts";
import { creditSplits } from "../library/db/credits.ts";
import { endPlay, recordPlay } from "../library/db/playHistory.ts";
import { listeningHistory } from "../library/db/listeningHistory.ts";
import {
  addTrack,
  migrateTestDatabase,
  openTestDatabase,
  type TestDatabase,
} from "../library/db/testDatabase.ts";
import { deleteTracksById } from "../library/db/tracks.ts";
import * as schema from "../library/db/schema.ts";
import { joinAccount } from "../library/db/syncRows.ts";
import { syncCycle, type SyncTransport } from "./syncCycle.ts";

const SONG: YtAlbumSong = {
  videoId: "history-video",
  title: "Airbag",
  artists: ["Radiohead"],
  album: "OK Computer",
  durationMs: 284_000,
  artworkUrl: "https://i.ytimg.com/vi/history-video/hqdefault.jpg",
  explicit: false,
  albumId: null,
};

const PLAY: PlayEvent = {
  trackId: "yt:history-video",
  startedAt: 1_792_929_600_000,
  listenedMs: 25_000,
  durationMs: 284_000,
  counted: true,
  endReason: "stopped",
  context: { kind: "playlist", id: "night" },
  source: "phone",
};

const account = async () => {
  const service = await harness();
  const session = await service.signIn();
  const transport: SyncTransport = {
    request: async (method, path, body) => {
      const response = await service.request(method, path, {
        session,
        ...(body === null ? {} : { body, headers: { "content-type": "application/json" } }),
      });
      return { status: response.status, body: await response.text() };
    },
  };
  return { service, session, transport };
};

const phone = async (transport: SyncTransport, existing?: TestDatabase) => {
  const db = existing ?? (await openTestDatabase());
  let historyChanges = 0;
  const sync = (songsChanged = false, to = transport) =>
    syncCycle({
      db,
      splits: creditSplits(),
      transport: to,
      account: "ana@example.com",
      preferences: { value: () => null, apply: () => {} },
      now: () => 1_792_929_700_000,
      songsChanged,
      wait: async () => {},
      historyChanged: () => historyChanges++,
    });
  return { db, sync, historyChanges: () => historyChanges };
};

test("a finished streamed play reaches the service with its recording key, snapshot and portable cover", async () => {
  const { service, session, transport } = await account();
  const a = await phone(transport);
  const id = recordPlay(a.db, PLAY, false, SONG);
  await a.sync();
  assert.equal((await pullAll(service, session)).plays.length, 0);

  endPlay(a.db, id, PLAY);
  assert.equal((await a.sync()).pushed, 1);
  const stored = (await pullAll(service, session)).plays;
  assert.equal(stored.length, 1);
  assert.equal(stored[0]?.songId, "ok computer\u001fradiohead\u001fairbag");
  assert.equal(stored[0]?.videoId, "history-video");
  assert.equal(stored[0]?.startedAt, 1_792_929_600_000);
  assert.deepEqual(stored[0]?.snapshot, {
    title: "Airbag",
    artist: "Radiohead",
    album: "OK Computer",
    artworkPath: "https://i.ytimg.com/vi/history-video/hqdefault.jpg",
    thumbPath: "https://i.ytimg.com/vi/history-video/hqdefault.jpg",
  });
  assert.equal((await a.sync()).pushed, 0);
  service.db.close();
});

test("another phone keeps an unmatched streamed play in history immediately and merges repeat pulls by id", async () => {
  const { service, transport } = await account();
  const a = await phone(transport);
  endPlay(a.db, recordPlay(a.db, PLAY, false, SONG), PLAY);
  await a.sync();

  const b = await phone(transport);
  assert.equal((await b.sync()).pulled.plays, true);
  const rows = listeningHistory(b.db).rows;
  assert.equal(rows.length, 1);
  assert.equal(rows[0]?.startedAt, 1_792_929_600_000);
  assert.equal(rows[0]?.videoId, "history-video");
  assert.equal(rows[0]?.song, null);
  assert.deepEqual(rows[0]?.snapshot, {
    title: "Airbag",
    artist: "Radiohead",
    album: "OK Computer",
    artworkPath: null,
    thumbPath: null,
    artworkUrl: "https://i.ytimg.com/vi/history-video/hqdefault.jpg",
  });
  assert.deepEqual(rows[0]?.streamedSong, SONG);
  assert.equal(b.historyChanges(), 1);
  const replay: SyncTransport = {
    request: (method, path, body) =>
      transport.request(method, method === "GET" ? "/v1/pull?since=0" : path, body),
  };
  const again = await b.sync(false, replay);
  assert.equal(again.pulled.plays, false);
  assert.equal(again.pushed, 0);
  assert.deepEqual(listeningHistory(b.db).rows, rows);
  assert.equal(b.historyChanges(), 1);
  service.db.close();
});

test("a Library play without an account song shows from its snapshot until the file arrives", async () => {
  const { service, session, transport } = await account();
  const a = await phone(transport);
  const track = addTrack(a.db, {
    title: "Airbag",
    artist: "Radiohead",
    album: "OK Computer",
    durationMs: 284_000,
    artworkHash: "ok",
  });
  const play = { ...PLAY, trackId: String(track) };
  endPlay(a.db, recordPlay(a.db, play), play);
  deleteTracksById(a.db, [track]);
  await a.sync();
  const stored = await pullAll(service, session);
  assert.equal(stored.songs.length, 0);
  assert.deepEqual(stored.plays[0]?.snapshot, {
    title: "Airbag",
    artist: "Radiohead",
    album: "OK Computer",
    artworkPath: null,
    thumbPath: null,
  });

  const b = await phone(transport);
  assert.equal((await b.sync()).pulled.plays, true);
  const before = listeningHistory(b.db).rows;
  assert.equal(before.length, 1);
  assert.equal(before[0]?.snapshot.title, "Airbag");
  assert.equal(before[0]?.song, null);
  assert.equal(before[0]?.streamedSong, null);
  assert.equal(before[0]?.videoId, null);
  assert.equal((await b.sync()).pushed, 0);

  const arrived = addTrack(b.db, {
    title: "Airbag",
    artist: "Radiohead",
    album: "OK Computer",
    durationMs: 284_000,
  });
  await b.sync(true);
  const after = listeningHistory(b.db).rows;
  assert.equal(after.length, 1);
  assert.equal(after[0]?.id, before[0]?.id);
  assert.equal(after[0]?.song?.id, arrived);
  assert.equal(after[0]?.startedAt, 1_792_929_600_000);
  assert.equal((await pullAll(service, session)).plays.length, 1);
  service.db.close();
});

test("a pulled streamed play attaches to a Library song by recording key or video id", async () => {
  const { service, transport } = await account();
  const a = await phone(transport);
  endPlay(a.db, recordPlay(a.db, PLAY, false, SONG), PLAY);
  await a.sync();

  for (const match of ["recording key", "video id"]) {
    const b = await phone(transport);
    const track = addTrack(b.db, {
      title: match === "video id" ? "Retagged title" : "Airbag",
      artist: "Radiohead",
      album: "OK Computer",
      durationMs: 284_000,
    });
    if (match === "video id") {
      b.db
        .update(schema.tracks)
        .set({ videoId: "history-video" })
        .where(eq(schema.tracks.id, track))
        .run();
    }
    await b.sync();
    const rows = listeningHistory(b.db).rows;
    assert.equal(rows.length, 1);
    assert.equal(rows[0]?.song?.id, track, match);
    assert.equal(rows[0]?.snapshot.title, "Airbag");
    assert.equal((await b.sync()).pushed, 0);
  }
  service.db.close();
});

test("legacy plays without new fields use this phone's song snapshot and wait only when it is unknown", async () => {
  const { service, session, transport } = await account();
  const legacy = {
    id: "legacy-play",
    songId: "ok computer\u001fradiohead\u001fairbag",
    startedAt: PLAY.startedAt,
    listenedMs: 25_000,
    durationMs: 284_000,
    endReason: "stopped",
    counted: true,
    contextType: null,
    contextId: null,
    source: "phone",
    importedFrom: null,
  };
  await push(service, session, {
    plays: [
      legacy,
      {
        ...legacy,
        id: "unknown-legacy-play",
        songId: "ok computer\u001fradiohead\u001flucky",
      },
    ],
  });
  const b = await phone(transport);
  const track = addTrack(b.db, {
    title: "Airbag",
    artist: "Radiohead",
    album: "OK Computer",
    artworkHash: "b-cover",
  });
  await b.sync();
  const before = listeningHistory(b.db).rows;
  assert.equal(before.length, 1);
  assert.equal(before[0]?.song?.id, track);
  assert.deepEqual(before[0]?.snapshot, {
    title: "Airbag",
    artist: "Radiohead",
    album: "OK Computer",
    artworkPath: "/covers/b-cover.jpg",
    thumbPath: "/covers/b-cover.thumb.jpg",
  });
  addTrack(b.db, { title: "Lucky", artist: "Radiohead", album: "OK Computer" });
  await b.sync(true);
  assert.deepEqual(
    listeningHistory(b.db)
      .rows.map((row) => row.snapshot.title)
      .toSorted(),
    ["Airbag", "Lucky"],
  );
  service.db.close();
});

test("an upgrade pushes migrated snapshots but leaves already stored play ids alone", async () => {
  const { service, session, transport } = await account();
  const db = await openTestDatabase({ through: "0038_genre_order" });
  const track = addTrack(db, {
    title: "Airbag",
    artist: "Radiohead",
    album: "OK Computer",
    artworkHash: "old-cover",
  });
  joinAccount(db, "ana@example.com");
  db.run(sql`INSERT INTO play_events (track_id, started_at, listened_ms, duration_ms,
    end_reason, counted, recording_key, sync_id, pushed, ongoing)
    VALUES (${track}, ${PLAY.startedAt}, 25000, 284000, 'stopped', 1,
      'ok computer' || char(31) || 'radiohead' || char(31) || 'airbag', 'already-pushed', 1, 0),
      (${track}, ${PLAY.startedAt + 1000}, 25000, 284000, 'stopped', 1,
      'ok computer' || char(31) || 'radiohead' || char(31) || 'airbag', 'waiting', 0, 0)`);
  await push(service, session, {
    plays: [
      {
        id: "already-pushed",
        songId: "ok computer\u001fradiohead\u001fairbag",
        startedAt: PLAY.startedAt,
        listenedMs: 25000,
        durationMs: 284000,
        endReason: "stopped",
        counted: true,
        contextType: null,
        contextId: null,
        source: "phone",
        importedFrom: null,
      },
    ],
  });
  await migrateTestDatabase(db);
  const sentIds: string[] = [];
  const observed: SyncTransport = {
    request: (method, path, body) => {
      if (method === "POST" && body !== null) {
        for (const play of JSON.parse(body).plays ?? []) sentIds.push(play.id);
      }
      return transport.request(method, path, body);
    },
  };
  const a = await phone(observed, db);
  await a.sync();
  assert.deepEqual(sentIds, ["waiting"]);
  const stored = (await pullAll(service, session)).plays;
  assert.equal(stored.find((row) => row.id === "already-pushed")?.snapshot, null);
  assert.deepEqual(stored.find((row) => row.id === "waiting")?.snapshot, {
    title: "Airbag",
    artist: "Radiohead",
    album: "OK Computer",
    artworkPath: null,
    thumbPath: null,
  });
  assert.equal((await a.sync()).pushed, 0);
  service.db.close();
});
