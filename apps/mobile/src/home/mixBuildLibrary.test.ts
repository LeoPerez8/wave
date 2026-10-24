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
          creditedPlayTotals: () =>
            Effect.succeed([
              {
                albumId: 1,
                albumSort: "album",
                artistId: 1,
                artistSort: "seed",
                primary: true,
                countedPlays: 10,
                listenedMs: 1800000,
                latestPlayAt: 1,
              },
            ]),
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
