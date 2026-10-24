import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { setImmediate } from "node:timers/promises";
import * as Effect from "effect/Effect";
import { sql } from "drizzle-orm";
import {
  artistMixSeeds,
  catalogMixReader,
  discoverMixesOfCatalog,
  genreMixSeeds,
  libraryGenreProfiles,
  magicArtistKey,
  magicBatch,
  playlistRecommendations,
  RECOMMENDATION_SNAPSHOT,
  seededRandom,
  startMagicQueue,
} from "@wave/core";
import { loadLibraryStore } from "../../bench/fastAgain/store.ts";
import { addLibrary, closeTestDatabase, openTestDatabase } from "../library/db/testDatabase.ts";
import { addCandidates } from "../library/db/candidateCatalog.ts";
import { createPlaylist } from "../library/db/playlists.ts";
import { sharePlaylistRecommendationInputs } from "../library/playlistRecommendationInputs.ts";
import { magicCatalogRead } from "../playback/magicCatalogRead.ts";
import { readMixInputs } from "./mixInputs.ts";
import { readMixCatalog } from "./readMixCatalog.ts";
import { snapshotRead } from "../lib/snapshotRead.ts";
import { readArtistGraph } from "./artistGraph.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
const now = Date.UTC(2026, 9, 23);

const radioSongs = (name: string, prefix: string) =>
  Array.from({ length: 60 }, (_, i) => ({
    videoId: `${prefix}-${i}`,
    title: `New ${prefix} ${i}`,
    artists: [name],
    album: null,
    albumId: null,
    durationMs: 180000,
    artworkUrl: null,
    explicit: false,
  }));
const until = async (done: () => boolean) => {
  for (let turns = 0; turns < 2000 && !done(); turns++) await setImmediate();
  assert.ok(done(), "recommendations settle within bounded turns");
};

test("2,531 Tracks and 900 artists finish paging, refill a Magic Queue online, and populate playlists and both Home mixes", async (t) => {
  const db = await openTestDatabase();
  const between = Effect.promise(() => setImmediate());
  try {
    addLibrary(db, { tracks: 2531, artists: 900, albums: 900 });
    db.run(sql`UPDATE tracks SET genres = '["Rock"]',
      artist_credit = (SELECT name FROM artists WHERE id = tracks.artist_id)`);
    db.run(sql`UPDATE albums SET album_artist_credit =
      (SELECT name FROM artists WHERE id = albums.album_artist_id)`);
    db.run(sql`INSERT OR IGNORE INTO album_artists (album_id, artist_id, position)
      SELECT id, album_artist_id, 0 FROM albums`);
    db.run(sql`INSERT INTO play_events
      (track_id, started_at, listened_ms, duration_ms, end_reason, counted, source, sync_id)
      SELECT id, ${now} - id * 200000, 180000, 180000, 'completed', 1, 'phone', '621-play-' || id
      FROM tracks`);
    const store = await loadLibraryStore(root, db);
    const trackIds = new Set(Effect.runSync(store.listSongs).map((track) => track.id));
    let pages = 0;
    const reads = {
      ...store,
      mixSongsPage: (after: number) =>
        Effect.suspend(() => {
          pages++;
          return store.mixSongsPage(after);
        }),
    };
    const indexes = snapshotRead(readMixInputs(reads, between, now), {
      part: RECOMMENDATION_SNAPSHOT.library,
      versions: () => ({}),
    });
    const recommendations = sharePlaylistRecommendationInputs(reads, between);
    try {
      const library = await Effect.runPromise(indexes.get);
      assert.deepEqual(new Set(library.songs.map((track) => track.id)), trackIds);
      assert.equal(library.songs.length, 2531, "every Track appears once");
      assert.equal(library.artists.length, 900);
      assert.ok(pages > 0 && pages <= 128, "the complete Library fits a bounded read budget");
      const mixPages = pages;
      assert.equal(await Effect.runPromise(indexes.get), library);
      assert.equal(pages, mixPages, "a kept derivation never starts paging again");
      const artist = library.topArtists[0]!;
      const seed = library.songs.find((song) => song.artistId === artist.id)!;
      const started = startMagicQueue(
        { kind: "track", id: String(seed.id), title: seed.title },
        [
          {
            trackId: String(seed.id),
            artists: [magicArtistKey(artist.name)],
            genre: "Rock",
            style: null,
          },
        ],
        {
          id: "621",
          random: seededRandom("621"),
          ytShare: 1,
          radio: { artists: [artist.name], profile: new Map([["rock", 1]]) },
        },
      );
      assert.ok(started);

      let requests = 0;
      const profileOf = libraryGenreProfiles(library);
      const initialCatalog = await Effect.runPromise(readMixCatalog(store, between));
      const pick = await Effect.runPromise(
        magicCatalogRead(started.session, {
          online: true,
          onMobileData: false,
          usedToday: 0,
          now,
          catalog: initialCatalog,
          between,
          graph: null,
          profileOf,
          taste: null,
          inLibrary: () => false,
          cached: Effect.succeed(new Set<string>()),
          tried: new Map(),
          usedOnMobile: () => {},
          refill: Effect.sync(() => {
            requests++;
            addCandidates(db, { seed: artist.name, songs: radioSongs(artist.name, "radio") }, now);
            return {
              bytes: 1000,
              reached: true,
              pages: [{ seed: artist.name, songs: radioSongs(artist.name, "radio") }],
            };
          }),
        }),
      );
      assert.equal(requests, 1, "an empty catalog reaches the online radio boundary");
      const batch = magicBatch(started.session, [], seededRandom("621-batch"), pick.candidates);
      assert.equal(batch.trackIds.length, 9);
      assert.ok(batch.trackIds.every((id) => id.startsWith("yt:")));
      for (const played of library.topArtists)
        addCandidates(
          db,
          { seed: played.name, songs: radioSongs(played.name, String(played.id)) },
          now,
        );
      const graph = await Effect.runPromise(readArtistGraph(store, between));
      const catalog = await Effect.runPromise(readMixCatalog(store, between));
      const playlistId = createPlaylist(
        db,
        "621",
        [{ source: "library", trackId: seed.id }],
        now,
      ).playlistId;
      const input = await Effect.runPromise(recommendations.get(playlistId));
      assert.deepEqual(new Set(input.library.map((track) => Number(track.id))), trackIds);
      assert.equal(input.library.length, 2531, "playlist inputs contain every Track once");
      const offers = playlistRecommendations(input.playlist, {
        ...input,
        graph,
        now,
        online: true,
      });
      assert.ok(offers.length > 0, "the playlist footer receives recommendations");
      assert.ok(pages - mixPages <= 128, "playlist inputs fit a bounded read budget");
      const completedPages = pages;
      assert.deepEqual(await Effect.runPromise(recommendations.get(playlistId)), input);
      assert.equal(pages, completedPages, "a warm playlist read reuses the Library source");
      for (const seeds of [
        artistMixSeeds(
          {
            played: library.topArtists,
            library: library.artists.map((row) => ({ ...row, songCount: row.trackCount })),
          },
          seededRandom("621-artists"),
        ),
        genreMixSeeds(library, seededRandom("621-genres")),
      ]) {
        assert.ok(seeds.length > 0);
        const reader = catalogMixReader({ catalog, graph, library, profileOf, taste: null, now });
        const mixes = discoverMixesOfCatalog(seeds, reader, { library, known: library.known });
        assert.ok(mixes.length > 0, `${seeds[0]!.kind} mixes are populated`);
        assert.ok(mixes.every((mix) => mix.songs.length > 0));
      }
      await setImmediate();
      assert.equal(
        pages,
        completedPages,
        "completed jobs leave no Track paging behind on another screen",
      );
      t.diagnostic(
        `Desktop SQLite: 2531 Tracks, 900 artists; ${pages} total pages; 1 radio refill; ${batch.trackIds.length} batch Tracks; ${offers.length} playlist offers`,
      );
    } finally {
      indexes.dispose();
      recommendations.dispose();
    }
  } finally {
    closeTestDatabase(db);
  }
});

test("scan writes stop at the playlist retry line, stay failed through bursts, then recover after the scan", async () => {
  const { createFastAgainFixture } = await import("../library/db/fastAgainFixture.ts");
  const { observePlaylistRecommendationInputs } =
    await import("../library/playlistRecommendationInputs.ts");
  const { followPlaylistRecommendations } =
    await import("../library/playlistRecommendationVisit.ts");
  const { onLibraryChange, publishLibraryChange } = await import("../library/libraryChanges.ts");
  const { playlistRecommendationSession } = await import("@wave/core");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    let storm = true;
    let reads = 0;
    let writes = 0;
    const source = observePlaylistRecommendationInputs(
      store,
      Effect.promise(async () => {
        await setImmediate();
        if (!storm) return;
        fixture.db.run(
          sql`UPDATE tracks SET title = ${`Changed ${++writes}`} WHERE id = ${fixture.songIds[0]!}`,
        );
        publishLibraryChange({ kind: "tracks", burst: true });
      }),
      onLibraryChange,
      () => () => {},
    );
    let offered = 0;
    const session = playlistRecommendationSession({
      newId: () => String(++offered),
      read: async (signal) => {
        reads++;
        const input = await Effect.runPromise(source.get(fixture.playlistId), { signal });
        return {
          playlist: input.playlist,
          sources: { ...input, graph: null, now: fixture.now, online: false },
        };
      },
      dismiss: async () => {},
    });
    const visit = followPlaylistRecommendations(session, {
      playlistId: fixture.playlistId,
      sight: { visible: () => true, subscribe: () => () => {} },
      start: async () => {},
      subscribe: onLibraryChange,
      wait: async () => {},
    });

    try {
      await until(() => session.get().error === "load" && !session.get().loading);
      assert.equal(reads, 1, "the visit does not cancel and reset the bounded source read");
      assert.equal(writes, 4, "the shared source stops after four invalidated attempts");
      for (let i = 0; i < 20; i++) publishLibraryChange({ kind: "tracks", burst: true });
      await setImmediate();
      assert.equal(reads, 1, "background writes preserve the failure line");
      storm = false;
      visit.invalidate();
      await until(
        () => session.get().slots.some((slot) => slot !== null) && !session.get().loading,
      );
      assert.equal(session.get().error, null);
      assert.equal(reads, 2);
    } finally {
      visit.dispose();
      source.dispose();
    }
  } finally {
    fixture.close();
  }
});
