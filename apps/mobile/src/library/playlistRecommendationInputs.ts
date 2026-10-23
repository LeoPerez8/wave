/** One shared Library/catalog version; membership and learning always belong to the requested playlist. */
import {
  mapSteps,
  readPlaylistEntrySong,
  type PlaylistRecommendationTrack,
  type LibraryChange,
} from "@wave/core";
import * as Effect from "effect/Effect";
import type { LibraryStore, SongRow } from "./LibraryStore.ts";
import {
  libraryRecommendationTrack,
  storedRecommendationTrack,
} from "./playlistRecommendationTracks.ts";
import { readMixCatalog } from "../home/readMixCatalog.ts";
import { sharedRead } from "../lib/sharedRead.ts";
import { runSteps } from "../lib/stepped.ts";

export type RecommendationReads = Pick<
  LibraryStore["Service"],
  | "mixSongsPage"
  | "mixArtistsPage"
  | "mixCatalogPage"
  | "graphRadioPage"
  | "recommendationFlagsPage"
  | "recommendationPendingPage"
  | "recommendationEntriesPage"
  | "recommendationFeedbackPage"
>;

const collect = <A, E, C = number>(
  page: (after: C) => Effect.Effect<readonly A[], E>,
  cursor: (row: A) => C,
  between: Effect.Effect<void>,
  initial: C = 0 as C,
) =>
  Effect.gen(function* () {
    const rows: A[] = [];
    let after = initial;
    for (;;) {
      yield* between;
      const next = yield* page(after);
      if (next.length === 0) return rows;
      for (const row of next) rows.push(row);
      after = cursor(next.at(-1)!);
    }
  });

/** At most one completed or in-flight snapshot, lazily evicted after 60 seconds. A forget aborts the old read; its waiters wait on the next. */
export const sharePlaylistRecommendationInputs = (
  store: RecommendationReads,
  between: Effect.Effect<void>,
  now = Date.now,
) => {
  const shared = sharedRead(
    Effect.gen(function* () {
      const artists = yield* collect(store.mixArtistsPage, (row) => row.id, between);
      const names = new Map<number, string>();
      yield* runSteps(
        mapSteps(artists, (row) => {
          names.set(row.id, row.name);
        }),
        between,
      );
      const flags = yield* collect(store.recommendationFlagsPage, (row) => row.id, between);
      const byFlags = new Map<number, (typeof flags)[number]>();
      yield* runSteps(
        mapSteps(flags, (row) => {
          byFlags.set(row.id, row);
        }),
        between,
      );
      // Historical recommendation trackQuery used the tracks table's id order, unlike listSongs.
      const librarySongs: (SongRow & { readonly genres?: readonly string[] })[] = yield* collect(
        store.mixSongsPage,
        (row) => row.id,
        between,
      );
      const local = (
        song: SongRow & { readonly genres?: readonly string[] },
      ): PlaylistRecommendationTrack => {
        const flag = byFlags.get(song.id);
        return libraryRecommendationTrack(song, names, {
          favorite: flag?.favorite === 1,
          downloaded: flag?.videoId != null && song.path !== null,
          videoId: flag?.videoId ?? "",
          genres: song.genres,
        });
      };
      const library = yield* runSteps(mapSteps(librarySongs, local), between);
      const byId = new Map<number, PlaylistRecommendationTrack>();
      const songById = new Map<string, SongRow>();
      yield* runSteps(
        mapSteps(librarySongs, (song) => {
          songById.set(String(song.id), song);
        }),
        between,
      );
      yield* runSteps(
        mapSteps(library, (track) => {
          byId.set(Number(track.id), track);
        }),
        between,
      );
      // Keep SongRows byte-equivalent to the historical API (multi-genres live on Core tracks).
      const songs = yield* runSteps(
        mapSteps(librarySongs, ({ genres: _genres, ...song }) => song),
        between,
      );
      const pending = yield* collect(store.recommendationPendingPage, (row) => row.cursor, between);
      const favoriteVideos = new Set<string>();
      yield* runSteps(
        mapSteps(pending, (row) => {
          favoriteVideos.add(row.videoId);
        }),
        between,
      );
      const catalog = yield* readMixCatalog(store, between);
      return { library, librarySongs: songs, favoriteVideos, catalog, byId, songById };
    }),
    { keepMs: 60_000, now },
  );
  return {
    forget: shared.forget,
    dispose: shared.dispose,
    get: (id: number) =>
      Effect.gen(function* () {
        const { byId, ...source } = yield* shared.get;
        const raw = yield* collect(
          (after) => store.recommendationEntriesPage(id, after),
          (row) => [row.orderKey, row.syncId] as const,
          between,
          null as readonly [string, string] | null,
        );
        const ordered = raw;
        const playlist: PlaylistRecommendationTrack[] = [];
        yield* runSteps(
          mapSteps(ordered, (row) => {
            if (row.song === null) {
              const track = row.trackId === null ? undefined : byId.get(row.trackId);
              if (track !== undefined) playlist.push(track);
              return;
            }
            const entry = readPlaylistEntrySong(row.song);
            if (entry === null) return;
            playlist.push(storedRecommendationTrack(entry, row.id));
          }),
          between,
        );
        const feedbackRows = yield* collect(
          (after) => store.recommendationFeedbackPage(id, after),
          (row) => row.offerKey,
          between,
          null as string | null,
        );
        const feedbackOrdered = feedbackRows;
        const feedback = yield* runSteps(
          mapSteps(feedbackOrdered, ({ track, value }) => ({ track, value })),
          between,
        );
        return { ...source, playlist, feedback };
      }),
  };
};

/** Installs one invalidation listener per shared source, released with dispose. */
export const observePlaylistRecommendationInputs = (
  store: RecommendationReads,
  between: Effect.Effect<void>,
  subscribe: (listener: (change: LibraryChange) => void) => () => void,
  catalog: (listener: () => void) => () => void,
) => {
  const source = sharePlaylistRecommendationInputs(store, between);
  const stop = subscribe((change) => {
    if (change.kind === "tracks" || change.kind === "favorites") source.forget();
  });
  const stopCatalog = catalog(source.forget);
  return {
    ...source,
    dispose: () => {
      stop();
      stopCatalog();
      source.dispose();
    },
  };
};
