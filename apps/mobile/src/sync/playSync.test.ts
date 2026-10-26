import assert from "node:assert/strict";
import { test } from "node:test";
import { type PlayEvent, type YtAlbumSong } from "@wave/core";

import { harness, pullAll } from "../../../sync/src/testing.ts";
import { creditSplits } from "../library/db/credits.ts";
import { endPlay, recordPlay } from "../library/db/playHistory.ts";
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
  const sync = (songsChanged = false) =>
    syncCycle({
      db,
      splits: creditSplits(),
      transport,
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
