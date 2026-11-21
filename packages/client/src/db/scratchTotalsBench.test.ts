// Temporary profiling script (not committed).
import { sql } from "drizzle-orm";
import { test } from "node:test";
import { statsWindow } from "@wave/core";

import { createFastAgainFixture } from "./fastAgainFixture.ts";
import { playedEntityTotals, playedArtistTotals, streamedListeningTotals } from "./playedEntities.ts";
import { creditedPlayTotals } from "./stats.ts";
import { streamedSongsOf } from "./streamedSongs.ts";
import { selectArtists } from "./artists.ts";
import { selectAlbums } from "./albums.ts";
import { homePlays } from "./playHistory.ts";

const time = (label: string, run: () => unknown, times = 5) => {
  run();
  const runs: number[] = [];
  for (let i = 0; i < times; i++) {
    const start = performance.now();
    run();
    runs.push(performance.now() - start);
  }
  runs.sort((a, b) => a - b);
  console.log(label.padEnd(40), runs[Math.floor(runs.length / 2)]!.toFixed(1), "ms");
};

test("profile", async () => {
  const f = await createFastAgainFixture(1000);
  const db = f.db;
  // 300 streamed videos, 6,000 streamed plays over 90 days.
  const streamed = 6000;
  db.run(sql`WITH RECURSIVE n(x) AS (VALUES(0) UNION ALL SELECT x + 1 FROM n WHERE x < ${streamed - 1})
    INSERT INTO play_events (video_id, streamed_song, started_at, listened_ms, duration_ms,
      end_reason, counted, source, recording_key, sync_id)
    SELECT printf('v%010d', x % 300),
      json_object('videoId', printf('v%010d', x % 300), 'title', 'Song ' || (x % 300),
        'artists', json_array('Online artist ' || (x % 40), CASE WHEN x % 3 = 0 THEN 'Library artist 1' ELSE 'Guest ' || (x % 7) END),
        'album', 'Online album ' || (x % 60), 'durationMs', 180000, 'artworkUrl', null,
        'explicit', json('false'), 'albumId', printf('MPREb_%d', x % 60)),
      ${f.now} - (${streamed} - x) * ${Math.floor((90 * 86400000) / streamed)},
      180000, 180000, 'completed', 1, 'phone', 'yt-rec-' || (x % 300), 'stream-' || x FROM n`);
  const now = f.now;
  for (const period of ["week", "month", "year", "all"] as const) {
    const w = statsWindow(period, now);
    time(`playedEntityTotals ${period}`, () => playedEntityTotals(db, w));
  }
  const w = statsWindow("month", now);
  time("playedArtistTotals month", () => playedArtistTotals(db, w));
  time("creditedPlayTotals month", () => creditedPlayTotals(db, w));
  time("creditedPlayTotals all", () => creditedPlayTotals(db, statsWindow("all", now)));
  time("streamedListeningTotals month", () => streamedListeningTotals(db, w));
  const streams = streamedListeningTotals(db, w);
  time("streamedSongsOf", () => streamedSongsOf(db, streams.map((s) => s.videoId)));
  time("selectArtists", () => selectArtists(db, {}));
  time("selectAlbums", () => selectAlbums(db, undefined));
  time("homePlays", () => homePlays(db));
  f.close();
});
