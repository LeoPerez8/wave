import {
  finishSteps,
  mergeCountedPlays,
  sortKey,
  type PlayEvent,
  type YtAlbumSong,
} from "@wave/core";
import assert from "node:assert/strict";
import { test } from "node:test";
import { sql } from "drizzle-orm";

import { creditSplits, relinkCredits } from "./credits.ts";
import type { LibraryDatabase } from "./database.ts";
import { finishReplaySteps, readConnections, replayRead } from "./offThreadReads.ts";
import { recordPlay } from "./playHistory.ts";
import {
  playedArtistSongs,
  playedArtistSongsRead,
  playedArtistSongsSteps,
  streamedListeningTotals,
  type PlayedArtistSongs,
  type StreamedListeningTotal,
} from "./playedEntities.ts";
import { playedLibrary } from "./playedLibrary.ts";
import { artistPlays } from "./stats.ts";
import { streamedSongsOf } from "./streamedSongs.ts";
import {
  addTrack,
  asyncReadClient,
  openTestDatabase,
  traceQueries,
  type TestDatabase,
} from "./testDatabase.ts";

const ytSong = (videoId: string, artists: string, album = "Album"): YtAlbumSong => ({
  videoId,
  title: `Title ${videoId}`,
  artists: [artists],
  album,
  albumId: null,
  artworkUrl: null,
  durationMs: 180_000,
  explicit: false,
});
const play = (id: string, at: number, counted = true): PlayEvent => ({
  trackId: id,
  context: null,
  startedAt: at,
  listenedMs: 180_000,
  durationMs: 180_000,
  endReason: "completed",
  counted,
  source: "phone",
});

/** `playedArtistSongs` as it read before its steps (#1452): what the steps must still give. */
const before = (db: LibraryDatabase, artistId: number, now: number): PlayedArtistSongs => {
  const base = artistPlays(db, artistId, now);
  const streams = streamedListeningTotals(db);
  if (streams.length === 0) return { ...base, streamedListening: [], streamedSongPlays: [] };
  const library = playedLibrary(db);
  const ids = new Set(base.songIds);
  const songs = streamedSongsOf(
    db,
    streams.map((entry) => entry.videoId),
  );
  const credited = (entry: StreamedListeningTotal): boolean => {
    if (entry.trackId !== null) return ids.has(entry.trackId);
    const song = songs.get(entry.videoId);
    return song !== undefined && library.resolve(song).artists.some((a) => a.id === artistId);
  };
  const theirs = streams.filter(credited);
  const upToNow = theirs.some((entry) => entry.lastPlayedAt > now)
    ? streamedListeningTotals(db, { from: null, to: now }).filter(credited)
    : theirs;
  const listened = mergeCountedPlays({
    library: base.listening.map((song) => ({
      id: song.trackId,
      countedPlays: song.countedPlays,
      listenedMs: song.listenedMs,
      latestPlayAt: song.lastPlayedAt,
    })),
    streamed: theirs.map((entry) => ({
      videoId: entry.videoId,
      trackId: entry.trackId,
      countedPlays: entry.countedPlays,
      listenedMs: entry.listenedMs,
      latestPlayAt: entry.lastPlayedAt,
    })),
  });
  const played = mergeCountedPlays({
    library: base.songPlays,
    streamed: upToNow
      .filter((entry) => entry.countedPlays > 0)
      .map((entry) => ({
        videoId: entry.videoId,
        trackId: entry.trackId,
        countedPlays: entry.countedPlays,
        listenedMs: entry.countedListenedMs,
        latestPlayAt: entry.latestPlayAt,
      })),
  });
  const ownListening = new Map(base.listening.map((song) => [song.trackId, song]));
  const ownPlays = new Map(base.songPlays.map((song) => [song.id, song]));
  const wanted = [...played.library.keys()].filter((id) => !ownPlays.has(id));
  const titles = new Map(
    db
      .all<{ id: number; titleSort: string }>(
        sql`SELECT id, title_sort AS "titleSort" FROM tracks
          WHERE id IN (SELECT value FROM json_each(${JSON.stringify(wanted)}))`,
      )
      .map((row) => [row.id, row.titleSort]),
  );
  return {
    ...base,
    listening: [...listened.library].map(([trackId, sums]) => {
      const own = ownListening.get(trackId);
      return {
        trackId,
        artistIds: own?.artistIds ?? [artistId],
        inLibrary: own?.inLibrary ?? true,
        countedPlays: sums.countedPlays,
        listenedMs: sums.listenedMs,
        lastPlayedAt: sums.latestPlayAt,
      };
    }),
    songPlays: [...played.library].map(([id, sums]) => ({
      id,
      sortKey: ownPlays.get(id)?.sortKey ?? titles.get(id) ?? "",
      ...sums,
    })),
    streamedListening: [...listened.online.values()].map((sums) => ({
      countedPlays: sums.countedPlays,
      listenedMs: sums.listenedMs,
      lastPlayedAt: sums.latestPlayAt,
    })),
    streamedSongPlays: [...played.online].map(([videoId, sums]) => ({
      song: { kind: "yt" as const, videoId },
      sortKey: sortKey(songs.get(videoId)?.title ?? ""),
      ...sums,
    })),
  };
};

const artist = (db: TestDatabase, name: string) =>
  db.get<{ id: number }>(sql`SELECT id FROM artists WHERE name = ${name}`).id;

/** Library songs by A and C, and streams: credited, featured, downloaded, skipped and others'. */
const seed = async () => {
  const db = await openTestDatabase();
  const local = addTrack(db, { title: "Local", artist: "A", album: "Album" });
  const downloaded = addTrack(db, { title: "Downloaded", artist: "A feat. C", album: "Other" });
  addTrack(db, { title: "Theirs", artist: "C", album: "Third" });
  relinkCredits(db, creditSplits());
  db.run(sql`UPDATE tracks SET video_id = 'down' WHERE id = ${downloaded}`);
  recordPlay(db, play(String(local), 1_000));
  recordPlay(db, play("yt:down", 1_500), false, ytSong("down", "A feat. C", "Other"));
  recordPlay(db, play("yt:feat", 2_000), false, ytSong("feat", "A feat. B"));
  recordPlay(db, play("yt:feat", 2_500, false), false, ytSong("feat", "A feat. B"));
  recordPlay(db, play("yt:solo", 3_000), false, ytSong("solo", "C"));
  recordPlay(db, play("yt:online", 3_500), false, ytSong("online", "Nobody", "Elsewhere"));
  return db;
};

test("an artist's listening read for a replay, then worked out in steps, is what it read before (#1452)", async () => {
  const db = await seed();
  const reads = readConnections(async () => asyncReadClient(db));
  const replayed = async (artistId: number, now: number) => {
    const read = await replayRead(
      reads,
      (d) => playedArtistSongsRead(d, artistId, now),
      () => 0,
    );
    const steps = playedArtistSongsSteps(read.value, artistId, now);
    return (await finishReplaySteps(steps, () => 0)).value;
  };
  const check = async (label: string) => {
    for (const name of ["A", "C"]) {
      const id = artist(db, name);
      for (const now of [10_000, 2_200]) {
        const expected = before(db, id, now);
        assert.deepEqual(playedArtistSongs(db, id, now), expected, `${label}: ${name} at ${now}`);
        assert.deepEqual(await replayed(id, now), expected, `${label}: ${name} replayed, ${now}`);
      }
    }
  };
  await check("history");
  assert.ok(before(db, artist(db, "A"), 10_000).streamedSongPlays.length > 0);
  // A play started after now (a phone whose clock ran ahead).
  recordPlay(db, play("yt:feat", 20_000), false, ytSong("feat", "A feat. B"));
  await check("a future play");
  const empty = await openTestDatabase();
  addTrack(empty, { title: "Only", artist: "A", album: "Album" });
  relinkCredits(empty, creditSplits());
  const id = artist(empty, "A");
  assert.deepEqual(
    finishSteps(playedArtistSongsSteps(playedArtistSongsRead(empty, id, 10_000), id, 10_000)),
    before(empty, id, 10_000),
  );
});

test("an artist's listening reads the same statements however many songs were streamed", async () => {
  const db = await seed();
  const id = artist(db, "A");
  const statements = () =>
    traceQueries(db, () => playedArtistSongsRead(db, id, 10_000)).queries.length;
  const few = statements();
  for (let index = 0; index < 200; index++)
    recordPlay(db, play(`yt:v${index}`, 5_000 + index), false, ytSong(`v${index}`, "A feat. B"));
  assert.equal(statements(), few);
  // The streams are worked out after the read, at least a step each.
  let steps = 0;
  const working = playedArtistSongsSteps(playedArtistSongsRead(db, id, 10_000), id, 10_000);
  for (let step = working.next(); !step.done; step = working.next()) steps++;
  assert.ok(steps > 200, `${steps} steps`);
});
