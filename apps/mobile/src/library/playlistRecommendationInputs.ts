/**
 * A playlist's suggestion inputs (docs/spec.md, "Recommendation snapshot"):
 * the Library, the candidate catalog and the stars come from the shared
 * recommendation snapshot; only the playlist's own entries and feedback are
 * read per playlist. Membership and learning always belong to the requested
 * playlist.
 */
import {
  mapSteps,
  readPlaylistEntrySong,
  RECOMMENDATION_SNAPSHOT,
  snapshotVersionsAfter,
  sortSteps,
  type CatalogSong,
  type LibraryChange,
  type PlaylistRecommendationTrack,
  type SnapshotVersions,
} from "@wave/core";
import * as Effect from "effect/Effect";
import type { ArtistRow, LibraryStore, SongRow } from "./LibraryStore.ts";
import {
  libraryRecommendationTrack,
  storedRecommendationTrack,
} from "./playlistRecommendationTracks.ts";
import { readMixInputs } from "../home/mixInputs.ts";
import { readMixCatalog } from "../home/readMixCatalog.ts";
import { snapshotRead } from "../lib/snapshotRead.ts";
import { runSteps } from "../lib/stepped.ts";

type RecommendationSong = SongRow & { readonly genres?: readonly string[] };

export type RecommendationReads = Pick<
  LibraryStore["Service"],
  "recommendationEntriesPage" | "recommendationFeedbackPage"
>;

/** The snapshot's stars part: each song's star and video, and the starred videos the Library lacks. */
export interface RecommendationFavorites {
  readonly flags: readonly { readonly id: number; readonly videoId: string | null; readonly favorite: number }[];
  readonly pending: ReadonlySet<string>;
}

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

/** The stars part's read, as the recommendation snapshot keeps it. */
export const readRecommendationFavorites = (
  store: Pick<LibraryStore["Service"], "recommendationFlagsPage" | "recommendationPendingPage">,
  between: Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const flags = yield* collect(store.recommendationFlagsPage, (row) => row.id, between);
    const rows = yield* collect(store.recommendationPendingPage, (row) => row.cursor, between);
    const pending = new Set<string>();
    yield* runSteps(
      mapSteps(rows, (row) => {
        pending.add(row.videoId);
      }),
      between,
    );
    const favorites: RecommendationFavorites = { flags, pending };
    return favorites;
  });

/** The Library as the suggestions rank it, derived from one snapshot's Library and stars. */
const libraryTracks = (
  { songs: sorted, artists }: { readonly songs: readonly RecommendationSong[]; readonly artists: readonly ArtistRow[] },
  { flags }: RecommendationFavorites,
  between: Effect.Effect<void>,
) =>
  Effect.gen(function* () {
    const names = new Map<number, string>();
    yield* runSteps(
      mapSteps(artists, (row) => {
        names.set(row.id, row.name);
      }),
      between,
    );
    const byFlags = new Map<number, RecommendationFavorites["flags"][number]>();
    yield* runSteps(
      mapSteps(flags, (row) => {
        byFlags.set(row.id, row);
      }),
      between,
    );
    // Historical recommendation trackQuery used the tracks table's id order, unlike Home's mixes.
    const librarySongs = yield* runSteps(
      sortSteps([...sorted], (a, b) => a.id - b.id),
      between,
    );
    const local = (song: RecommendationSong): PlaylistRecommendationTrack => {
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
    return { library, librarySongs: songs, byId, songById };
  });

/**
 * Suggestion inputs over the snapshot's parts: [library] (Home's mix
 * indexes), [catalog] and [favorites], and the [store] that reads a
 * playlist's own rows. The Library's tracks are derived once per snapshot
 * read and shared by every playlist; a write never discards an ask under way.
 */
export const sharePlaylistRecommendationInputs = <R>(
  {
    library,
    catalog,
    favorites,
    store,
  }: {
    readonly library: Effect.Effect<
      { readonly songs: readonly RecommendationSong[]; readonly artists: readonly ArtistRow[] },
      unknown,
      R
    >;
    readonly catalog: Effect.Effect<readonly CatalogSong[], unknown, R>;
    readonly favorites: Effect.Effect<RecommendationFavorites, unknown, R>;
    readonly store: Effect.Effect<RecommendationReads, never, R>;
  },
  between: Effect.Effect<void>,
) => {
  // The latest derivation, kept while the snapshot hands back the same parts.
  let derived:
    | {
        readonly library: object;
        readonly favorites: object;
        readonly tracks: Effect.Effect.Success<ReturnType<typeof libraryTracks>>;
      }
    | undefined;
  return {
    get: (id: number) =>
      Effect.gen(function* () {
        const indexes = yield* library;
        const stars = yield* favorites;
        const songs = yield* catalog;
        let latest = derived;
        if (latest?.library !== indexes || latest.favorites !== stars) {
          latest = {
            library: indexes,
            favorites: stars,
            tracks: yield* libraryTracks(indexes, stars, between),
          };
          derived = latest;
        }
        const { byId, ...tracks } = latest.tracks;
        const reads = yield* store;
        const raw = yield* collect(
          (after) => reads.recommendationEntriesPage(id, after),
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
          (after) => reads.recommendationFeedbackPage(id, after),
          (row) => row.offerKey,
          between,
          null as string | null,
        );
        const feedbackOrdered = feedbackRows;
        const feedback = yield* runSteps(
          mapSteps(feedbackOrdered, ({ track, value }) => ({ track, value })),
          between,
        );
        return { ...tracks, favoriteVideos: stars.pending, catalog: songs, playlist, feedback };
      }),
  };
};

/**
 * The same inputs over a recommendation snapshot of their own, read from
 * [store] and counting [subscribe]'s Library changes and [catalog]'s writes
 * as the app's snapshot does (`home/recommendationSnapshot.ts`): for desktop
 * replays and tests, which can't load the app's. Released with dispose.
 */
export const observePlaylistRecommendationInputs = (
  store: Parameters<typeof readMixInputs>[0] &
    Parameters<typeof readMixCatalog>[0] &
    Parameters<typeof readRecommendationFavorites>[0] &
    RecommendationReads,
  between: Effect.Effect<void>,
  subscribe: (listener: (change: LibraryChange) => void) => () => void,
  catalog: (listener: () => void) => () => void,
  now = Date.now,
) => {
  let versions: SnapshotVersions = {};
  const stop = subscribe((change) => {
    versions = snapshotVersionsAfter(versions, change.kind);
  });
  const stopCatalog = catalog(() => {
    versions = snapshotVersionsAfter(versions, "catalog");
  });
  const options = { versions: () => versions, now };
  const library = snapshotRead(
    Effect.suspend(() => readMixInputs(store, between, now())),
    { ...options, part: RECOMMENDATION_SNAPSHOT.library },
  );
  const songs = snapshotRead(readMixCatalog(store, between), {
    ...options,
    part: RECOMMENDATION_SNAPSHOT.catalog,
  });
  const favorites = snapshotRead(readRecommendationFavorites(store, between), {
    ...options,
    part: RECOMMENDATION_SNAPSHOT.favorites,
  });
  const source = sharePlaylistRecommendationInputs(
    {
      library: library.get,
      catalog: songs.get,
      favorites: favorites.get,
      store: Effect.succeed(store),
    },
    between,
  );
  return {
    ...source,
    dispose: () => {
      stop();
      stopCatalog();
      library.dispose();
      songs.dispose();
      favorites.dispose();
    },
  };
};
