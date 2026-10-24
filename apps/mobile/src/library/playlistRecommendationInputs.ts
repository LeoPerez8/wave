/**
 * A playlist's suggestion inputs (docs/spec.md, "Recommendation snapshot"):
 * the Library and the stars come from the shared recommendation snapshot;
 * the radios come apart (`playlistSuggestionRadios.ts`). Only the
 * playlist's own entries and feedback are
 * read per playlist. Membership and learning always belong to the requested
 * playlist.
 */
import {
  mapSteps,
  readPlaylistEntrySong,
  RECOMMENDATION_SNAPSHOT,
  snapshotVersionsAfter,
  sortSteps,
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
import { sharedRead } from "../lib/sharedRead.ts";
import { snapshotRead } from "../lib/snapshotRead.ts";
import { runSteps } from "../lib/stepped.ts";

type RecommendationSong = SongRow & { readonly genres?: readonly string[] };

export type RecommendationReads = Pick<
  LibraryStore["Service"],
  "recommendationEntriesPage" | "recommendationFeedbackPage"
>;

/** The snapshot's stars part: each song's star and video, and the starred videos the Library lacks. */
export interface RecommendationFavorites {
  readonly flags: readonly {
    readonly id: number;
    readonly videoId: string | null;
    readonly favorite: number;
  }[];
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
  {
    songs: sorted,
    artists,
  }: { readonly songs: readonly RecommendationSong[]; readonly artists: readonly ArtistRow[] },
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
 * indexes) and [favorites], and the [store] that reads a
 * playlist's own rows. The Library's tracks are derived once per snapshot
 * read and shared by every playlist; a write never discards an ask under way.
 */
export const sharePlaylistRecommendationInputs = <R>(
  {
    library,
    favorites,
    store,
    peek,
  }: {
    readonly library: Effect.Effect<
      { readonly songs: readonly RecommendationSong[]; readonly artists: readonly ArtistRow[] },
      unknown,
      R
    >;
    readonly favorites: Effect.Effect<RecommendationFavorites, unknown, R>;
    readonly store: Effect.Effect<RecommendationReads, never, R>;
    readonly peek?: () => {
      readonly library: {
        readonly songs: readonly RecommendationSong[];
        readonly artists: readonly ArtistRow[];
      } | null;
      readonly favorites: RecommendationFavorites | null;
    };
  },
  between: Effect.Effect<void>,
) => {
  // The latest derivation, kept while the snapshot hands back the same parts;
  // background readers keep the last completed tracks while a new mapping runs.
  let derived:
    | {
        readonly library: object;
        readonly favorites: object;
        readonly tracks: Effect.Effect<Effect.Success<ReturnType<typeof libraryTracks>>, unknown>;
      }
    | undefined;
  let completed: Effect.Success<ReturnType<typeof libraryTracks>> | null = null;
  const emptyStars: RecommendationFavorites = { flags: [], pending: new Set() };
  const emptyTracks = {
    library: [],
    librarySongs: [],
    byId: new Map<number, PlaylistRecommendationTrack>(),
    songById: new Map<string, SongRow>(),
  };
  const tracksFor = (
    indexes: {
      readonly songs: readonly RecommendationSong[];
      readonly artists: readonly ArtistRow[];
    },
    stars: RecommendationFavorites,
  ) => {
    if (derived?.library !== indexes || derived.favorites !== stars) {
      derived = {
        library: indexes,
        favorites: stars,
        tracks: sharedRead(
          libraryTracks(indexes, stars, between).pipe(
            Effect.tap((tracks) =>
              Effect.sync(() => {
                if (derived?.library === indexes && derived.favorites === stars) completed = tracks;
              }),
            ),
          ),
        ).get,
      };
    }
    return derived.tracks;
  };
  const warm = Effect.gen(function* () {
    const last = peek?.();
    if (last?.library != null) yield* tracksFor(last.library, last.favorites ?? emptyStars);
    yield* Effect.all(
      [
        Effect.gen(function* () {
          const indexes = yield* library;
          yield* tracksFor(indexes, peek?.().favorites ?? emptyStars);
        }),
        Effect.gen(function* () {
          const stars = yield* favorites;
          const indexes = peek?.().library;
          if (indexes != null) yield* tracksFor(indexes, stars);
        }),
      ],
      { concurrency: "unbounded" },
    );
  });
  const read = (id: number, background: boolean) =>
    Effect.gen(function* () {
      const indexes = background ? null : yield* library;
      const stars = background ? (peek?.().favorites ?? emptyStars) : yield* favorites;
      let selected = completed ?? emptyTracks;
      if (indexes === null) yield* Effect.forkDetach(Effect.ignore(warm));
      else selected = yield* tracksFor(indexes, stars);
      const { byId, ...tracks } = selected;
      const reads = yield* store;
      const raw = yield* collect(
        (after) => reads.recommendationEntriesPage(id, after, background),
        (row) => [row.orderKey, row.syncId] as const,
        between,
        null as readonly [string, string] | null,
      );
      const ordered = raw;
      const playlist: PlaylistRecommendationTrack[] = [];
      // Each entry carries when it joined this playlist, which the seed draw leans to.
      yield* runSteps(
        mapSteps(ordered, (row) => {
          if (row.song === null) {
            const track =
              row.local?.track ?? (row.trackId === null ? undefined : byId.get(row.trackId));
            if (track !== undefined) playlist.push({ ...track, addedAt: row.addedAt });
            return;
          }
          const entry = readPlaylistEntrySong(row.song);
          if (entry === null) return;
          playlist.push({ ...storedRecommendationTrack(entry, row.id), addedAt: row.addedAt });
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
      return { ...tracks, favoriteVideos: stars.pending, playlist, feedback };
    });
  return {
    /** Explicit full reads for desktop replays; app recommendations use latest. */
    get: (id: number) => read(id, false),
    /** Recommendations take the last completed indexes, including on a cold start. */
    latest: (id: number) => read(id, true),
  };
};

/**
 * The same inputs over a recommendation snapshot of their own, read from
 * [store] and counting [subscribe]'s Library changes as the app's snapshot
 * does (`home/recommendationSnapshot.ts`): for desktop replays and tests,
 * which can't load the app's. Released with dispose.
 */
export const observePlaylistRecommendationInputs = (
  store: Parameters<typeof readMixInputs>[0] &
    Parameters<typeof readRecommendationFavorites>[0] &
    RecommendationReads,
  between: Effect.Effect<void>,
  subscribe: (listener: (change: LibraryChange) => void) => () => void,
  now = Date.now,
) => {
  let versions: SnapshotVersions = {};
  const stop = subscribe((change) => {
    versions = snapshotVersionsAfter(versions, change.kind);
  });
  const options = { versions: () => versions, now };
  const library = snapshotRead(
    Effect.suspend(() => readMixInputs(store, between, now())),
    { ...options, part: RECOMMENDATION_SNAPSHOT.library },
  );
  const favorites = snapshotRead(readRecommendationFavorites(store, between), {
    ...options,
    part: RECOMMENDATION_SNAPSHOT.favorites,
  });
  const source = sharePlaylistRecommendationInputs(
    { library: library.get, favorites: favorites.get, store: Effect.succeed(store) },
    between,
  );
  return {
    ...source,
    dispose: () => {
      stop();
      library.dispose();
      favorites.dispose();
    },
  };
};
