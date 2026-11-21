import {
  DEFAULT_DISCOVER_MIX_LEVEL,
  DEFAULT_MIX_SLIDERS,
  magicQueuePages,
  NO_DISLIKES,
  redrawMagicQueuePage,
  type DiscoverMixLevel,
  type DislikedSongs,
  type LibraryReads,
  type MagicQueueSeed,
  type MagicQueueSeedId,
  type MixSliderStep,
  type RandomSource,
} from "@wave/core";
import * as Effect from "effect/Effect";
import type { LibraryStore } from "../library/LibraryStore.ts";
import type { PlayableSongRow } from "@wave/client";

/** What the pages are drawn as: fresh, keeping the pages shown, or the page at [index] drawn again. */
export type MagicQueuePagesPlan =
  | { readonly kind: "fresh" }
  | { readonly kind: "keep"; readonly pages: readonly (readonly MagicQueueSeedId[])[] }
  | {
      readonly kind: "redraw";
      readonly pages: readonly (readonly MagicQueueSeedId[])[];
      readonly index: number;
    };

/** Discover's levels as a draw takes them (New music, Popularity). */
export interface MagicQueuePagesLevels {
  readonly level: DiscoverMixLevel;
  readonly popularity: MixSliderStep;
}

/** What a draw reads beside the store, each with a default for none. */
export interface MagicQueuePagesSources<E, R> {
  /** The playlists' YT Music entries' video ids, none the Library has as a file. */
  readonly entryVideoIds: Effect.Effect<readonly string[], E, R>;
  /** The disliked songs: never drawn. */
  readonly disliked?: Effect.Effect<DislikedSongs, never, R>;
  /** How much of a hit each song of the pool is, 0 to 1 (Core's `MagicQueuePagesPool`). */
  readonly popularity?: Effect.Effect<(id: MagicQueueSeedId) => number, never, R>;
  /** Discover's levels now, read at each draw. */
  readonly levels?: () => MagicQueuePagesLevels;
  /** Now, for the plays read. */
  readonly now?: () => number;
}

const DEFAULT_LEVELS: MagicQueuePagesLevels = {
  level: DEFAULT_DISCOVER_MIX_LEVEL,
  popularity: DEFAULT_MIX_SLIDERS.popularity,
};

let nextRead = 0;

/**
 * Home's Magic Queue pages (Core's `magicQueuePages`, `redrawMagicQueuePage`)
 * as a read of the phone's database: the pool's ids (the Library's files,
 * the playlists' YT Music entries), which of them were ever played, then the
 * metadata of the songs drawn. Discover's levels are read at the draw. A
 * video whose stored song can't be read leaves the pool until the next draw,
 * and its place is drawn again. After its first answer the read keeps its
 * pages: a later run (the Library changed) keeps the songs still in the pool
 * in their places.
 */
export const magicQueuePagesRead = (random: RandomSource, plan: MagicQueuePagesPlan) => {
  let current = plan;
  const unreadable = new Set<string>();
  return {
    key: `magicQueuePages:${++nextRead}`,
    reads: { tracks: true, favorites: true, playlists: true } satisfies LibraryReads,
    read: <E, R>(store: LibraryStore["Service"], sources: MagicQueuePagesSources<E, R>) =>
      Effect.gen(function* () {
        const trackIds = yield* store.playableSongIds;
        const videoIds = yield* sources.entryVideoIds;
        const disliked = yield* sources.disliked ?? Effect.succeed(NO_DISLIKES);
        const popularityOf = yield* sources.popularity ?? Effect.succeed(() => 0);
        const levels = sources.levels?.() ?? DEFAULT_LEVELS;
        const totals = yield* store.songPlayTotals({
          from: null,
          to: sources.now?.() ?? Date.now(),
        });
        const played = new Set<MagicQueueSeedId>();
        for (const { song, countedPlays } of totals)
          if (countedPlays > 0) played.add(song.kind === "library" ? song.id : song.videoId);
        for (;;) {
          const pool = {
            trackIds,
            videoIds: videoIds.filter((id) => !unreadable.has(id)),
            disliked,
            played,
            popularityOf,
          };
          const draw = { ...levels, random };
          const picked =
            current.kind === "redraw"
              ? redrawMagicQueuePage(pool, draw, current.pages, current.index)
              : magicQueuePages(pool, draw, current.kind === "keep" ? current.pages : []);
          current = { kind: "keep", pages: picked };
          const ids = picked.flat();
          const files = yield* store.songsByIds(
            ids.filter((id): id is number => typeof id === "number"),
          );
          const pickedVideos = ids.filter((id): id is string => typeof id === "string");
          const entries =
            pickedVideos.length === 0 ? [] : yield* store.playlistEntrySongs(pickedVideos);
          const seeds = new Map<MagicQueueSeedId, MagicQueueSeed<PlayableSongRow>>();
          for (const song of files) seeds.set(song.id, { source: "library", song });
          for (const song of entries) seeds.set(song.videoId, { source: "stream", song });
          const lost = pickedVideos.filter((id) => !seeds.has(id));
          if (lost.length === 0)
            return picked.map((page) => page.flatMap((id) => seeds.get(id) ?? []));
          for (const id of lost) unreadable.add(id);
        }
      }),
  };
};
