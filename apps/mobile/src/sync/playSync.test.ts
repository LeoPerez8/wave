import assert from "node:assert/strict";
import { test } from "node:test";
import { type PlayEvent, type YtAlbumSong } from "@wave/core";

import { harness, pullAll } from "../../../sync/src/testing.ts";
import { creditSplits } from "../library/db/credits.ts";
import { endPlay, recordPlay } from "../library/db/playHistory.ts";
import { listeningHistory } from "../library/db/listeningHistory.ts";
import { openTestDatabase } from "../library/db/testDatabase.ts";
import { syncCycle, type SyncTransport } from "./syncCycle.ts";

const SONG: YtAlbumSong = {
  videoId: "history-video",
  title: "Airbag",
  artists: ["Radiohead"],
  album: "OK Computer",
  durationMs: 284_000,
  artworkUrl: "https://i.ytimg.com/vi/history-video/hqdefault.jpg",
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

const phone = async (transport: SyncTransport) => {
  const db = await openTestDatabase();
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
