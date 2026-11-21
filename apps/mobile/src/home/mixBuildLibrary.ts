/** Mix builds use a completed index or direct local seed reads on a cold start. */
import {
  rankEntityPlaysSteps,
  type PlayedSeedArtist,
  type YtAlbumSong,
  type YtSong,
} from "@wave/core";
import * as Effect from "effect/Effect";
import type { LibraryStore } from "../library/LibraryStore.ts";
import type { ArtistRow, SongRow } from "@wave/client";
import { runSteps } from "../lib/stepped.ts";
import { readKnownVideos } from "./knownVideosRead.ts";
import type { MixIndexes, MixSong } from "./mixKnown.ts";

const radioSongKey = (song: Pick<YtSong, "title" | "artists" | "durationMs">): string =>
  JSON.stringify([song.title, song.artists, song.durationMs]);

/** Direct reads supply seeds, without paging play history or deriving a Library matcher. */
export const readMixBuildLibrary = (
  latest: MixIndexes | null,
  store: Pick<
    LibraryStore["Service"],
    | "mixSongs"
    | "mixArtists"
    | "countedPlays"
    | "streamedLibraryPlays"
    | "playedEntityTotals"
    | "knownVideos"
    | "matchingSongs"
  >,
  between: Effect.Effect<void>,
  find: ((song: YtSong) => SongRow | null) | null = null,
) =>
  Effect.gen(function* () {
    if (latest !== null)
      return { library: latest, matchRadios: (_songs: readonly YtAlbumSong[]) => Effect.void };
    yield* between;
    const songs: readonly MixSong[] = yield* store.mixSongs;
    yield* between;
    const artists: readonly ArtistRow[] = yield* store.mixArtists;
    const ids = songs.map((song) => song.id);
    const counts = new Map(yield* store.countedPlays(ids));
    // A Library song's streamed plays are its own (`streamedTrack`), as Stats counts them.
    const songIds = new Set(ids);
    for (const [id, plays] of yield* store.streamedLibraryPlays)
      if (songIds.has(id)) counts.set(id, (counts.get(id) ?? 0) + plays);
    // The artists Stats ranks, streamed credits and artists only streamed included.
    const played = yield* store.playedEntityTotals({ from: null, to: Date.now() });
    const ranked = yield* runSteps(rankEntityPlaysSteps(played.artists, 20), between);
    const byId = new Map(artists.map((artist) => [artist.id, artist]));
    yield* between;
    const videos = new Set(yield* readKnownVideos(store));
    const matches = new Map<string, SongRow | null>();
    const inLibrary: MixIndexes["known"]["inLibrary"] = (song) =>
      matches.get(radioSongKey(song)) ?? null;
    const library: MixIndexes = {
      songs,
      artists,
      plays: [...counts].map(([id, countedPlays]) => ({
        id,
        countedPlays,
        listenedMs: 0,
        latestPlayAt: 0,
        sortKey: "",
      })),
      topArtists: ranked.flatMap((total): PlayedSeedArtist[] => {
        if (typeof total.id === "string")
          return [{ id: total.id, name: total.item.name, countedPlays: total.countedPlays }];
        const artist = byId.get(total.id);
        return artist === undefined
          ? []
          : [{ id: artist.id, name: artist.name, countedPlays: total.countedPlays }];
      }),
      known: {
        inLibrary,
        known: (song) => videos.has(song.videoId) || inLibrary(song) !== null,
        nonD: [],
      },
    };
    return {
      library,
      // Reuse the completed finder, or match only radio songs through one
      // indexed SQL read for all of them. No full-Library recording index is needed.
      matchRadios: (radio: readonly YtAlbumSong[]) =>
        Effect.gen(function* () {
          const wanted = new Map<string, YtAlbumSong>();
          for (const song of radio)
            if (!matches.has(radioSongKey(song))) wanted.set(radioSongKey(song), song);
          if (wanted.size === 0) return;
          const songs = [...wanted.values()];
          yield* between;
          if (find === null) {
            const found = yield* store.matchingSongs(songs);
            songs.forEach((song, i) => matches.set(radioSongKey(song), found[i] ?? null));
          } else
            yield* runSteps(
              (function* () {
                for (const song of songs) {
                  matches.set(radioSongKey(song), find(song));
                  yield;
                }
              })(),
              between,
            );
        }),
    };
  });
