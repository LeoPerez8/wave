import assert from "node:assert/strict";
import { test } from "node:test";
import { recordPlay } from "@wave/client/db/playHistory";
import { deleteTracksById } from "@wave/client/db/tracks";
import { addTrack, openTestDatabase, type TestDatabase } from "@wave/client/testing";
import type { PlayEvent, YtAlbumSong } from "@wave/core";
import { historyPage, historyReplay, type HistoryHost } from "./history.ts";

const played = (trackId: string, startedAt: number, counted = true): PlayEvent => ({
  trackId,
  startedAt,
  counted,
  listenedMs: counted ? 20_000 : 0,
  durationMs: 180_000,
  endReason: "completed",
  context: null,
  source: "desktop",
});

const stream: YtAlbumSong = {
  videoId: "history-video",
  title: "Airbag",
  artists: ["Radiohead", "Guest"],
  album: "OK Computer",
  durationMs: 180_000,
  artworkUrl: "https://i.ytimg.com/cover.jpg",
  explicit: false,
  albumId: "MPREb_album",
};

const host = (ytMusic: boolean, kept: YtAlbumSong[] = []): HistoryHost => ({
  ytMusic,
  keep: (songs) => kept.push(...songs),
  unavailable: () => false,
});

/** A Library play, a streamed one, a play of a song removed since, and one that wasn't counted. */
const seeded = async (): Promise<{ db: TestDatabase; moon: number; ids: number[] }> => {
  const db = await openTestDatabase();
  const moon = addTrack(db, { title: "Pink Moon", artist: "Nick Drake" });
  const gone = addTrack(db, { title: "Harvest", artist: "Neil Young" });
  const ids = [
    recordPlay(db, played(String(moon), 1000)),
    recordPlay(db, played(String(gone), 2000)),
    recordPlay(db, played("yt:history-video", 3000), false, stream),
    recordPlay(db, played(String(moon), 4000, false)),
  ];
  deleteTracksById(db, [gone]);
  return { db, moon, ids };
};

test("history lists counted Library and streamed plays together, newest first", async () => {
  const { db, moon, ids } = await seeded();
  const kept: YtAlbumSong[] = [];
  const page = historyPage(db, { before: undefined }, "", host(true, kept));
  assert.deepEqual(
    page.rows.map(({ id, startedAt, replays, song }) => ({
      id,
      startedAt,
      replays,
      title: song.title,
      artist: song.artist,
      songId: song.id,
      videoId: song.videoId,
      unavailable: song.unavailable,
      artworkUrl: song.artworkUrl ?? null,
    })),
    [
      {
        id: ids[2],
        startedAt: 3000,
        replays: "stream",
        title: "Airbag",
        artist: "Radiohead & Guest",
        songId: 0,
        videoId: "history-video",
        unavailable: false,
        artworkUrl: "https://i.ytimg.com/cover.jpg",
      },
      {
        id: ids[1],
        startedAt: 2000,
        replays: null,
        title: "Harvest",
        artist: "Neil Young",
        songId: 0,
        videoId: undefined,
        unavailable: true,
        artworkUrl: null,
      },
      {
        id: ids[0],
        startedAt: 1000,
        replays: "library",
        title: "Pink Moon",
        artist: "Nick Drake",
        songId: moon,
        videoId: undefined,
        unavailable: false,
        artworkUrl: null,
      },
    ],
  );
  assert.equal(page.next, null);
  // The streamed row's menu and replay need its song known to YT Music's service.
  assert.deepEqual(kept, [stream]);
});

test("with YT Music off a streamed play is dimmed, has no cover and doesn't replay", async () => {
  const { db, ids } = await seeded();
  const kept: YtAlbumSong[] = [];
  const row = historyPage(db, { before: undefined }, "", host(false, kept)).rows[0]!;
  assert.equal(row.replays, null);
  assert.equal(row.song.unavailable, true);
  assert.equal(row.song.title, "Airbag");
  assert.equal(row.song.artworkUrl ?? null, null);
  assert.deepEqual(kept, []);
  assert.equal(historyReplay(db, ids[2]!, false), null);
});

test("a play replays its Library song or its stream, and a removed song replays nothing", async () => {
  const { db, moon, ids } = await seeded();
  assert.deepEqual(historyReplay(db, ids[0]!, true), { id: String(moon), streams: [] });
  assert.deepEqual(historyReplay(db, ids[2]!, true), {
    id: "yt:history-video",
    streams: [stream],
  });
  assert.equal(historyReplay(db, ids[1]!, true), null);
  // An uncounted play isn't in history, so nothing replays from it.
  assert.equal(historyReplay(db, ids[3]!, true), null);
});

test("history reads around a play, newer than a cursor, and searches the whole history", async () => {
  const db = await openTestDatabase();
  const moon = addTrack(db, { title: "Pink Moon", artist: "Nick Drake" });
  const road = addTrack(db, { title: "Road", artist: "Nick Drake" });
  const first = recordPlay(db, played(String(road), 500));
  const plays = Array.from({ length: 120 }, (_, i) =>
    recordPlay(db, played(String(moon), 1000 + i)),
  );
  const newest = historyPage(db, { before: undefined }, "", host(true));
  assert.equal(newest.rows.length, 50);
  assert.equal(
    newest.rows.some(({ id }) => id === first),
    false,
  );
  // Search finds the play older than the rows loaded so far.
  const found = historyPage(db, { before: undefined }, "road", host(true));
  assert.deepEqual(
    found.rows.map(({ id }) => id),
    [first],
  );
  const around = historyPage(db, { around: plays[60]! }, "", host(true));
  assert.equal(around.rows[25]?.id, plays[60]);
  assert.notEqual(around.newer, null);
  const above = historyPage(db, { after: around.newer! }, "", host(true));
  assert.equal(above.rows.at(-1)?.id, plays[86]);
});
