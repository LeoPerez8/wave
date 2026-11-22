import { finishSteps, type YtAlbumSong } from "@wave/core";
import assert from "node:assert/strict";
import { test } from "node:test";

import { playEvents } from "./schema.ts";
import { streamedSongsOf, streamedSongsRead, streamedSongsSteps } from "./streamedSongs.ts";
import { openTestDatabase, traceQueries, type TestDatabase } from "./testDatabase.ts";

const song = (videoId: string, title: string): YtAlbumSong => ({
  videoId,
  title,
  artists: ["A"],
  album: "Album",
  albumId: null,
  artworkUrl: null,
  durationMs: 200_000,
  explicit: false,
});

const played = (
  db: TestDatabase,
  videoId: string,
  startedAt: number,
  kept: { streamedSong?: YtAlbumSong; snapshot?: { title: string; artist: string } },
) =>
  db
    .insert(playEvents)
    .values({
      videoId,
      counted: true,
      startedAt,
      listenedMs: 20_000,
      durationMs: 180_000 + startedAt,
      endReason: "completed",
      streamedSong: kept.streamedSong ?? null,
      snapshot:
        kept.snapshot === undefined
          ? null
          : { ...kept.snapshot, album: null, artworkPath: null, thumbPath: null },
    })
    .run();

test("streamed songs read for a replay, then worked out in steps, are streamedSongsOf's (#1452)", async () => {
  const db = await openTestDatabase();
  played(db, "kept", 1, { streamedSong: song("kept", "Old") });
  played(db, "kept", 2, { streamedSong: song("kept", "New") });
  played(db, "snap", 3, { snapshot: { title: "Snapshot", artist: "B" } });
  played(db, "both", 4, { snapshot: { title: "Snapshot", artist: "C" } });
  played(db, "both", 5, { streamedSong: song("both", "Kept") });
  const wanted = ["snap", "kept", "unknown", "both", "kept"];
  const stepped = (ids: readonly string[]) => {
    const { wanted: videos, rows } = streamedSongsRead(db, ids);
    return finishSteps(streamedSongsSteps(videos, rows));
  };
  assert.deepEqual([...stepped(wanted)], [...streamedSongsOf(db, wanted)]);
  assert.deepEqual([...stepped([])], []);
  // Two statements however many videos are asked for.
  const statements = (ids: readonly string[]) =>
    traceQueries(db, () => streamedSongsRead(db, ids)).queries.length;
  assert.equal(statements(Array.from({ length: 300 }, (_, n) => `v${n}`)), statements(["kept"]));
});
