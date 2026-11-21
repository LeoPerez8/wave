/// <reference types="node" />
import { recapWindow, type PlayEvent, type RecapPeriod, type YtAlbumSong } from "@wave/core";
import { sql } from "drizzle-orm";
import * as Effect from "effect/Effect";
import assert from "node:assert/strict";
import { test } from "node:test";

import { creditSplits, relinkCredits } from "./credits.ts";
import { recordPlay } from "./playHistory.ts";
import { recapPlays } from "./playedEntities.ts";
import { loadRecapStories } from "./recapStories.ts";
import { countedListening } from "./stats.ts";
import { statsDatabaseReads } from "./statsQueries.ts";
import { addTrack, openTestDatabase, type TestDatabase } from "./testDatabase.ts";

const MINUTE = 60_000;
const september: RecapPeriod = { kind: "month", year: 2026, month: 9 };
const inSeptember = (day: number, hour = 20) => new Date(2026, 8, day, hour).getTime();

const play = (trackId: string, startedAt: number): PlayEvent => ({
  trackId,
  context: null,
  startedAt,
  listenedMs: 6 * MINUTE,
  durationMs: 6 * MINUTE,
  endReason: "completed",
  counted: true,
  source: "phone",
});

const airbag: YtAlbumSong = {
  videoId: "v-airbag",
  title: "Airbag",
  artists: ["Radiohead"],
  album: "OK Computer",
  durationMs: 6 * MINUTE,
  artworkUrl: "https://i.ytimg.com/airbag.jpg",
  explicit: false,
  albumId: "MPREb_ok",
};

const stories = (db: TestDatabase, period: RecapPeriod) =>
  Effect.runPromise(
    loadRecapStories(statsDatabaseReads(db), {
      period,
      listening: countedListening(db),
      plays: recapPlays(db, recapWindow(period)),
    }),
  );

test("a Recap's stories carry their songs, artists and album in Core's order, the summary last", async () => {
  const db = await openTestDatabase();
  const moon = addTrack(db, {
    title: "Pink Moon",
    artist: "Nick Drake",
    album: "Pink Moon",
    genre: "Folk",
  });
  relinkCredits(db, creditSplits());
  for (let i = 0; i < 3; i++) recordPlay(db, play(String(moon), inSeptember(1 + i)));
  recordPlay(db, play("yt:v-airbag", inSeptember(5)), false, airbag);

  const recap = await stories(db, september);
  assert.equal(recap.title, "September 2026");
  assert.deepEqual(
    recap.slides.map((slide) => slide.kind),
    [
      "minutes",
      "topSongs",
      "topArtists",
      "topAlbum",
      "topGenres",
      "habits",
      "discovered",
      "summary",
    ],
  );
  const songs = recap.slides.find((slide) => slide.kind === "topSongs")!.songs;
  assert.deepEqual(
    songs.map(({ item, countedPlays }) => [
      item.source === "library" ? item.track.title : item.song.title,
      countedPlays,
    ]),
    [
      ["Pink Moon", 3],
      ["Airbag", 1],
    ],
  );
  const discovered = recap.slides.find((slide) => slide.kind === "discovered")!;
  assert.equal(discovered.count, 2);
  assert.deepEqual(
    discovered.artists.map(({ item }) => item.name),
    ["Nick Drake", "Radiohead"],
  );
  const summary = recap.slides.at(-1)!;
  assert.ok(summary.kind === "summary");
  assert.equal(summary.minutes, 24);
  assert.equal(summary.genre?.name, "Folk");
});

test("a story whose songs all left the Library is dropped, and the summary still closes the Recap", async () => {
  const db = await openTestDatabase();
  const gone = addTrack(db, { title: "Gone", artist: "Somebody" });
  recordPlay(db, play(String(gone), inSeptember(1)));
  db.run(sql`UPDATE tracks SET path = NULL WHERE id = ${gone}`);

  const recap = await stories(db, september);
  assert.equal(
    recap.slides.some((slide) => slide.kind === "topSongs"),
    false,
  );
  const summary = recap.slides.at(-1)!;
  assert.ok(summary.kind === "summary");
  assert.deepEqual(summary.songs, []);
});
