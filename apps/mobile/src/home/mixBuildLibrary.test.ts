import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import {
  artistMixSeeds,
  genreMixSeeds,
  discoverMixesOfRadios,
  rankedDiscoverMixRead,
  type YtAlbumSong,
} from "@wave/core";
import type { SongRow } from "../library/LibraryStore.ts";
import { readMixBuildLibrary } from "./mixBuildLibrary.ts";

for (const cachedFinder of [false, true])
  test(`cold Artist and Genre builds filter known songs with ${cachedFinder ? "a completed finder" : "scoped SQL matches"}`, async () => {
    // Use raw store reads for seed data; a derived snapshot is deliberately absent.
    const songs = Array.from(
      { length: 5 },
      (_, n) =>
        ({
          id: n + 1,
          title: `Known ${n}`,
          path: `/music/${n}.flac`,
          album: "Album",
          albumId: 1,
          artistId: 1,
          thumbPath: null,
          artworkPath: null,
          titleSort: `known ${n}`,
          artistSort: "seed",
          albumSort: "album",
          discNumber: null,
          trackNumber: n + 1,
          year: null,
          hasLyrics: false,
          explicit: "clean",
          artist: "Seed",
          artistIds: [1],
          durationMs: 180000,
          genre: "Metal",
          addedAt: n,
        }) satisfies SongRow,
    );
    const artist = {
      id: 1,
      name: "Seed",
      sort: "seed",
      trackCount: 5,
      albumCount: 1,
      thumbPath: null,
      artworkPath: null,
    };
    const radio: YtAlbumSong[] = Array.from({ length: 14 }, (_, n) => ({
      videoId: `v${n}`,
      title: n === 0 ? "Known 0" : `New ${n}`,
      artists: ["Seed"],
      durationMs: 180000,
      album: null,
      albumId: null,
      artworkUrl: null,
      explicit: false,
    }));
    const { library, matchRadios } = await Effect.runPromise(
      readMixBuildLibrary(
        null,
        {
          mixSongsPage: (after) => Effect.succeed(after === 0 ? songs : []),
          mixArtistsPage: (after) => Effect.succeed(after === 0 ? [artist] : []),
          countedPlays: () => Effect.succeed(new Map([[1, 10]])),
          streamedLibraryPlays: Effect.succeed(new Map()),
          playedEntityTotals: () =>
            Effect.succeed({
              albums: [],
              artists: [
                {
                  id: 1,
                  item: artist,
                  sortKey: "seed",
                  countedPlays: 10,
                  listenedMs: 1800000,
                  latestPlayAt: 1,
                },
              ],
            }),
          knownVideos: Effect.succeed(["v1"]),
          matchingSong: (song) =>
            cachedFinder
              ? Effect.die("the completed finder already resolves Library recordings")
              : Effect.succeed(song.title === "Known 0" ? songs[0]! : null),
        },
        Effect.void,
        cachedFinder ? (song) => (song.title === "Known 0" ? songs[0]! : null) : null,
      ),
    );
    assert.deepEqual(library.topArtists, [{ id: 1, name: "Seed", countedPlays: 10 }]);
    const artistSeeds = artistMixSeeds(
      {
        library: library.artists.map((a) => ({ ...a, songCount: a.trackCount })),
        played: library.topArtists,
      },
      () => 0,
    );
    const genreSeeds = genreMixSeeds(library);
    assert.equal(artistSeeds.length, 1);
    assert.equal(genreSeeds[0]?.name, "Metal");
    await Effect.runPromise(matchRadios(radio));
    for (const seed of [artistSeeds[0]!, genreSeeds[0]!]) {
      const mixes = discoverMixesOfRadios(
        [
          rankedDiscoverMixRead(seed, {
            pages: [{ id: "radio", artists: ["Seed"], songs: radio }],
          }),
        ],
        { library, known: library.known },
      );
      assert.equal(mixes.length, 1);
      assert.ok(mixes[0]!.songs.every((s) => s.videoId !== "v0" && s.videoId !== "v1"));
      assert.equal(mixes[0]!.songs[0]?.videoId, "v2");
    }
  });

const totals = (countedPlays: number) => ({ countedPlays, listenedMs: 0, latestPlayAt: 0 });

test("a cold build seeds from streamed plays as Stats ranks them", async () => {
  const song = {
    id: 1,
    title: "Granite",
    path: "/music/granite.flac",
    album: "Sundowning",
    albumId: 1,
    artistId: 1,
    thumbPath: null,
    artworkPath: null,
    titleSort: "granite",
    artistSort: "sleep token",
    albumSort: "sundowning",
    discNumber: null,
    trackNumber: 1,
    year: null,
    hasLyrics: false,
    explicit: "clean",
    artist: "Sleep Token",
    artistIds: [1],
    durationMs: 180000,
    genre: "Metal",
    addedAt: 0,
  } satisfies SongRow;
  const artist = {
    id: 1,
    name: "Sleep Token",
    sort: "sleep token",
    trackCount: 1,
    albumCount: 1,
    thumbPath: null,
    artworkPath: null,
  };
  const { library } = await Effect.runPromise(
    readMixBuildLibrary(
      null,
      {
        mixSongsPage: (after) => Effect.succeed(after === 0 ? [song] : []),
        mixArtistsPage: (after) => Effect.succeed(after === 0 ? [artist] : []),
        countedPlays: () => Effect.succeed(new Map([[1, 2]])),
        // Granite's downloaded video was streamed three times.
        streamedLibraryPlays: Effect.succeed(new Map([[1, 3]])),
        playedEntityTotals: () =>
          Effect.succeed({
            albums: [],
            artists: [
              {
                id: "artist:spiritbox",
                item: {
                  id: "artist:spiritbox",
                  name: "Spiritbox",
                  online: true,
                  thumbPath: null,
                  artworkPath: null,
                },
                sortKey: "spiritbox",
                ...totals(9),
              },
              { id: 1, item: artist, sortKey: "sleep token", ...totals(5) },
            ],
          }),
        knownVideos: Effect.succeed([]),
        matchingSong: () => Effect.succeed(null),
      },
      Effect.void,
    ),
  );
  assert.deepEqual(library.topArtists, [
    { id: "artist:spiritbox", name: "Spiritbox", countedPlays: 9 },
    { id: 1, name: "Sleep Token", countedPlays: 5 },
  ]);
  assert.deepEqual(
    library.plays.map(({ id, countedPlays }) => [id, countedPlays]),
    [[1, 5]],
  );
});
