/**
 * Home's mix build reads its rows in a bounded number of reads (#1351): the
 * same count for a Library of 1,000 songs and one of 12,000, with their plays,
 * streamed plays, playlist entries and candidate catalog growing with them.
 */
import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import { runTestPromise, runTestSync } from "../../lib/steppedTesting.ts";
import type { PlayEvent, YtAlbumSong } from "@wave/core";
import { sql } from "drizzle-orm";
import { addCandidates } from "@wave/client/db/candidateCatalog";
import { recordPlay } from "@wave/client/db/playHistory";
import { createPlaylist } from "@wave/client/db/playlists";
import { traceQueries } from "@wave/client/testing";
import {
  createFastAgainFixture,
  type FastAgainFixture,
  type FastAgainSize,
} from "@wave/client/testing/fastAgainFixture";
import { loadLibraryStore } from "../../../bench/fastAgain/store.ts";
import { readMixInputs } from "../../home/mixInputs.ts";
import { readMixCatalog } from "../../home/readMixCatalog.ts";
import { readMixBuildLibrary } from "../../home/mixBuildLibrary.ts";
import { readKnownVideos } from "../../home/knownVideosRead.ts";
import { readPlaylistSeedIds } from "../../home/playlistSeedIds.ts";
import { createHomeWork } from "../../home/homeWork.ts";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));

const online = (i: number, title = `Streamed ${i}`): YtAlbumSong => ({
  videoId: `yt-${String(i).padStart(8, "0")}`,
  title,
  artists: [`Online Artist ${i % 30}`],
  album: `Online Album ${i % 50}`,
  albumId: null,
  durationMs: 200_000,
  artworkUrl: null,
  explicit: false,
});
const play = (trackId: string, startedAt: number): PlayEvent => ({
  trackId,
  context: null,
  startedAt,
  listenedMs: 180_000,
  durationMs: 200_000,
  endReason: "completed",
  counted: true,
  source: "phone",
});

/** Streamed plays, YT Music playlist entries and catalog songs, a tenth of the Library each. */
const seed = (fixture: FastAgainFixture): YtAlbumSong[] => {
  const extra = fixture.size / 10;
  const songs = Array.from({ length: extra }, (_, i) => online(i));
  songs.forEach((song, i) =>
    recordPlay(fixture.db, play(`yt:${song.videoId}`, fixture.now - 1000 * (i + 1)), false, song),
  );
  createPlaylist(
    fixture.db,
    "Streamed playlist",
    songs.map((song) => ({ source: "stream" as const, song })),
    fixture.now,
  );
  for (let at = 0; at < extra; at += 100)
    addCandidates(
      fixture.db,
      { seed: `Online Artist ${at % 30}`, songs: songs.slice(at, at + 100) },
      fixture.now,
    );
  // Radio songs a build matches: half the Library's titles, half unknown.
  const titles = fixture.db
    .all<{ title: string }>(sql`SELECT title FROM tracks ORDER BY id LIMIT ${extra / 2}`)
    .map((row) => row.title);
  return [
    ...titles.map((title, i) => ({ ...online(1_000_000 + i, title), artists: ["Nobody"] })),
    ...songs.slice(0, extra / 2),
  ];
};

/** [store], counting each read it is asked for by name. */
const counting = <S extends object>(store: S) => {
  const reads: string[] = [];
  const counted = (key: PropertyKey, value: unknown) =>
    Effect.isEffect(value)
      ? Effect.tap(value, () => Effect.sync(() => void reads.push(String(key))))
      : value;
  const proxy = new Proxy(store, {
    get(target, key) {
      const value = Reflect.get(target, key);
      return typeof value === "function"
        ? (...args: unknown[]) => counted(key, value.apply(target, args))
        : counted(key, value);
    },
  });
  return { store: proxy, reads };
};

const measure = async (size: FastAgainSize) => {
  const fixture = await createFastAgainFixture(size);
  try {
    const radio = seed(fixture);
    const { store, reads } = counting(await loadLibraryStore(root, fixture.db));
    const traced = traceQueries(fixture.db, () =>
      runTestSync(
        Effect.gen(function* () {
          yield* readMixInputs(store, Effect.void, fixture.now);
          yield* readMixCatalog(store, Effect.void);
          const cold = yield* readMixBuildLibrary(null, store, Effect.void);
          yield* cold.matchRadios(radio);
          yield* readKnownVideos(store);
          // The Magic Queue carousel's playlist side.
          yield* readPlaylistSeedIds(store);
        }),
      ),
    );
    return { reads, statements: traced.queries.length };
  } finally {
    fixture.close();
  }
};

test("a Home mix build reads as often for 12,000 songs as for 1,000", async () => {
  const small = await measure(1000);
  const large = await measure(12000);
  console.log(
    `Home mix build: ${small.reads.length} reads (${small.statements} statements) at 1,000 songs, ` +
      `${large.reads.length} reads (${large.statements} statements) at 12,000`,
  );
  const tally = (reads: readonly string[]) => {
    const counts = new Map<string, number>();
    for (const name of reads) counts.set(name, (counts.get(name) ?? 0) + 1);
    return [...counts].map(([name, count]) => `${name} ${count}`);
  };
  console.log(`1,000: ${tally(small.reads).join(", ")}
12,000: ${tally(large.reads).join(", ")}`);
  assert.deepEqual(large.reads, small.reads);
  assert.equal(large.statements, small.statements);
  assert.ok(small.reads.length <= 24, `${small.reads.length} reads: ${small.reads.join(", ")}`);
  // Rows a build looks at are never read one at a time.
  for (const name of ["matchingSong", "knownVideosPage", "mixSongsPage"])
    assert.ok(!small.reads.includes(name), `${name} is read per row or page`);
});

test("off Home, a mix build stops after the read or slice under way and finishes once Home is back", async () => {
  const fixture = await createFastAgainFixture(1000);
  try {
    seed(fixture);
    const raw = await loadLibraryStore(root, fixture.db);
    const expected = runTestSync(readMixInputs(raw, Effect.void, fixture.now));
    const { store, reads } = counting(raw);
    const work = createHomeWork();
    let visible = true;
    const listeners = new Set<(visible: boolean) => void>();
    work.follow({
      visible: () => visible,
      subscribe: (listener) => {
        listeners.add(listener);
        return () => listeners.delete(listener);
      },
    });
    const show = (next: boolean) => {
      visible = next;
      for (const listener of listeners) listener(next);
    };
    const between = Effect.andThen(
      Effect.promise(() => setImmediate()),
      work.turn,
    );
    const built = runTestPromise(readMixInputs(store, between, fixture.now));
    while (reads.length < 3) await setImmediate();
    // Settings is shown.
    show(false);
    const left = reads.length;
    for (let i = 0; i < 200; i++) await setImmediate();
    assert.ok(reads.length <= left + 1, `${reads.length - left} reads off Home`);
    show(true);
    const inputs = await built;
    assert.deepEqual(inputs.songs, expected.songs);
    assert.deepEqual(inputs.plays, expected.plays);
    assert.deepEqual(inputs.topArtists, expected.topArtists);
  } finally {
    fixture.close();
  }
});
