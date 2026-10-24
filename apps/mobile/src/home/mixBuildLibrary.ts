/** Mix builds use a completed index or direct local seed reads on a cold start. */
import { artistPlayTotals, rankPlaysSteps, type YtAlbumSong, type YtSong } from "@wave/core";
import * as Effect from "effect/Effect";
import type { ArtistRow, LibraryStore, SongRow } from "../library/LibraryStore.ts";
import { runSteps } from "../lib/stepped.ts";
import type { MixIndexes, MixSong } from "./mixKnown.ts";

const radioSongKey = (song: Pick<YtSong, "title" | "artists" | "durationMs">): string =>
  JSON.stringify([song.title, song.artists, song.durationMs]);

/** Direct reads supply seeds, without paging play history or deriving a Library matcher. */
export const readMixBuildLibrary = (
  latest: MixIndexes | null,
  store: Pick<
    LibraryStore["Service"],
    | "mixSongsPage"
    | "mixArtistsPage"
    | "countedPlays"
    | "creditedPlayTotals"
    | "knownVideos"
    | "matchingSong"
  >,
  between: Effect.Effect<void>,
  find: ((song: YtSong) => SongRow | null) | null = null,
) =>
  Effect.gen(function* () {
    if (latest !== null)
      return { library: latest, matchRadios: (_songs: readonly YtAlbumSong[]) => Effect.void };
    const songs: MixSong[] = [];
    let after = 0;
    for (;;) {
      yield* between;
      const page = yield* store.mixSongsPage(after);
      if (page.length === 0) break;
      songs.push(...page);
      after = page.at(-1)!.id;
    }
    const artists: ArtistRow[] = [];
    after = 0;
    for (;;) {
      yield* between;
      const page = yield* store.mixArtistsPage(after);
      if (page.length === 0) break;
      artists.push(...page);
      after = page.at(-1)!.id;
    }
    const counts = yield* store.countedPlays(songs.map((song) => song.id));
    const credits = yield* store.creditedPlayTotals({ from: null, to: Date.now() });
    const ranked = yield* runSteps(rankPlaysSteps(artistPlayTotals(credits), 20), between);
    const byId = new Map(artists.map((artist) => [artist.id, artist]));
    const videos = new Set(yield* store.knownVideos);
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
      topArtists: ranked.flatMap((total) => {
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
      // Reuse the completed finder, or match only radio songs through indexed
      // SQL lookups. No full-Library recording index is needed.
      matchRadios: (radio: readonly YtAlbumSong[]) =>
        Effect.gen(function* () {
          for (const song of radio) {
            if (matches.has(radioSongKey(song))) continue;
            yield* between;
            matches.set(
              radioSongKey(song),
              find === null ? yield* store.matchingSong(song) : find(song),
            );
          }
        }),
    };
  });
