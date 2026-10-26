/// <reference types="node" />
import {
  availableRecaps,
  recap,
  recapWindow,
  type CountedListening,
  type PlayEvent,
  type RecapPeriod,
  type YtAlbumSong,
} from "@wave/core";
import { sql } from "drizzle-orm";
import assert from "node:assert/strict";
import { test } from "node:test";

import { creditSplits, relinkCredits } from "./credits.ts";
import { recordPlay } from "./playHistory.ts";
import { recapPlays } from "./playedEntities.ts";
import { countedListeningPage } from "./stats.ts";
import { addTrack, openTestDatabase, type TestDatabase } from "./testDatabase.ts";

const MINUTE = 60_000;
const september: RecapPeriod = { kind: "month", year: 2026, month: 9 };
/** A local time in September 2026. */
const inSeptember = (day: number, hour = 20) => new Date(2026, 8, day, hour).getTime();

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
const karma: YtAlbumSong = {
  ...airbag,
  videoId: "v-karma",
  title: "Karma Police",
  artists: ["Radiohead feat. Thom"],
};

const play = (trackId: string, startedAt: number, listenedMs = 6 * MINUTE): PlayEvent => ({
  trackId,
  context: null,
  startedAt,
  listenedMs,
  durationMs: 6 * MINUTE,
  endReason: "completed",
  counted: true,
  source: "phone",
});
const stream = (db: TestDatabase, song: YtAlbumSong, startedAt: number, listenedMs?: number) =>
  recordPlay(db, play(`yt:${song.videoId}`, startedAt, listenedMs), false, song);

/** The whole history's counted listening, read page by page as Recap availability reads it. */
const listening = (db: TestDatabase): CountedListening[] => {
  const rows: CountedListening[] = [];
  let after = 0;
  for (;;) {
    const page = countedListeningPage(db, after);
    rows.push(...page.rows);
    if (page.next === null) return rows;
    after = page.next;
  }
};

/** [period]'s Recap from the store, as Stats computes it. */
const recapOf = (db: TestDatabase, period: RecapPeriod) => {
  const plays = recapPlays(db, recapWindow(period));
  return recap({ period, listening: listening(db), ...plays });
};

test("a month of 4 hours of streaming alone has a Recap, with those songs and artists", async () => {
  const db = await openTestDatabase();
  // 40 plays of 6 minutes: 4 hours, all streamed.
  for (let i = 0; i < 30; i++) stream(db, airbag, inSeptember(1 + (i % 28)) + i);
  for (let i = 0; i < 10; i++) stream(db, karma, inSeptember(2 + i, 9));

  assert.deepEqual(availableRecaps(listening(db), new Date(2026, 9, 1).getTime()), [september]);
  const shown = recapOf(db, september);
  assert.equal(shown.minutesListened, 240);
  assert.deepEqual(
    shown.topSongs.map((entry) => [entry.id, entry.countedPlays]),
    [
      ["v-airbag", 30],
      ["v-karma", 10],
    ],
  );
  const plays = recapPlays(db, recapWindow(september));
  const name = (id: number | string) => plays.artists.find((artist) => artist.id === id)?.item.name;
  assert.deepEqual(
    shown.topArtists.map((entry) => [name(entry.id), entry.countedPlays]),
    [
      ["Radiohead", 40],
      ["Thom", 10],
    ],
  );
  assert.deepEqual(
    shown.discoveredArtists.map((entry) => name(entry.id)),
    ["Radiohead", "Thom"],
  );
  // YT Music doesn't say a streamed song's genre: no genre is made up for it.
  assert.deepEqual(shown.topGenres, []);
});

test("a streamed song a Library song now is counts as it, its genre and first play included", async () => {
  const db = await openTestDatabase();
  const id = addTrack(db, {
    title: "Airbag",
    artist: "Radiohead",
    album: "OK Computer",
    genre: "Rock",
  });
  relinkCredits(db, creditSplits());
  db.run(sql`UPDATE tracks SET video_id = 'v-airbag' WHERE id = ${id}`);
  // Streamed in August, before the download: Radiohead's first play.
  stream(db, airbag, new Date(2026, 7, 20).getTime());
  stream(db, airbag, inSeptember(3));
  recordPlay(db, play(String(id), inSeptember(4)));

  const shown = recapOf(db, september);
  assert.deepEqual(
    shown.topSongs.map((entry) => [entry.id, entry.countedPlays]),
    [[id, 2]],
  );
  assert.equal(shown.topArtists[0]?.countedPlays, 2);
  assert.deepEqual(shown.discoveredArtists, []);
  assert.deepEqual(
    shown.topGenres.map((entry) => entry.family.name),
    ["Rock"],
  );
});

test("Recap listening counts streamed plays beside the Library's, skips left out", async () => {
  const db = await openTestDatabase();
  const id = addTrack(db, { title: "Local" });
  recordPlay(db, play(String(id), inSeptember(1), 10 * MINUTE));
  stream(db, airbag, inSeptember(2), 20 * MINUTE);
  recordPlay(
    db,
    {
      ...play(`yt:${airbag.videoId}`, inSeptember(3), 5_000),
      counted: false,
      endReason: "skipped",
    },
    false,
    airbag,
  );
  assert.equal(recapOf(db, september).minutesListened, 30);
});
