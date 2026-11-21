import { currentLocalisation } from "@/localisation/localisation";
/**
 * Home draws the Magic Queue row's three pages when it first opens, from the
 * Library's playable songs and the playlists' YT Music entries together, by
 * Discover's New music and Popularity (Core's `magicQueuePages`); with
 * neither, nine streamed songs of the Artist mixes (Core's `magicQueueRow`).
 */
import { namedWork } from "@/lib/stepped";
import {
  magicQueueMixPicks,
  magicQueueRow,
  magicQueueSeedId,
  magicQueueShown,
  withoutDisliked,
  type DiscoverMixesSection,
  type MagicQueueMixPicks,
  type MagicQueueSeed,
  type MagicQueueShown as CoreMagicQueueShown,
  type YtAlbumSong,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { useEffect, useMemo, useState } from "react";

import { freeTurnEffect } from "@/lib/backgroundWork";
import { discoverLevel, discoverSliders } from "@/lib/discoverSettings";
import { recommendationTurnEffect } from "@/lib/recommendationWork";
import { currentDislikedSongs, useDislikedSongs } from "@/library/dislikes";
import { onLibraryChange } from "@/library/libraryChanges";
import { LibraryStore } from "@/library/LibraryStore";
import { type PlayableSongRow } from "@wave/client";
import { libraryQuery, useLibraryQuery } from "@/library/sharedQueries";
import { showToast } from "@/overlay/toast";
import { startMagicQueue } from "@/playback/MagicQueue";
import { runMagicQueueStart, startMagicQueueFromStream } from "@/playback/magicQueueStart";
import { appRuntime } from "@/library/runtime";

import { magicQueuePagesRead, type MagicQueuePagesPlan } from "./magicQueuePagesRead";
import { magicQueuePopularity } from "./magicQueuePopularity";
import { snapshotSection, useSnapshotted } from "./homeSnapshot";
import { createPlaylistSeedIdsRead, readPlaylistSeedIds } from "./playlistSeedIds";
import { homeRecommendationSnapshot } from "./recommendationSnapshot";
import { homeTurnOf } from "./homeWork";
import { startFromLibraryMatch } from "./streamedMagicQueueStart";

/** What the row draws (Core's `magicQueueShown`), its mixes' songs picked. */
export type MagicQueueShown = CoreMagicQueueShown<PlayableSongRow>;

export interface MagicQueueSection {
  readonly shown: MagicQueueShown;
  /**
   * Draws the page at [index] again (the mixes' songs, with an empty pool),
   * with a "New songs" toast and Undo.
   */
  readonly refresh: (index: number) => void;
}

/** The row's playlist entries, in one read on a free turn: it's waiting to be shown. */
const seedIds = createPlaylistSeedIdsRead(
  Effect.andThen(
    homeTurnOf(freeTurnEffect),
    Effect.flatMap(LibraryStore, (store) => readPlaylistSeedIds(store)),
  ).pipe(namedWork("Home Magic Queue seeds")),
);
onLibraryChange(seedIds.change);

const videoIdsOf = (songs: readonly YtAlbumSong[]): string[] => songs.map((song) => song.videoId);

/** A seed of the row: a Library song, or a playlist's YT Music entry. */
type Seed = MagicQueueSeed<PlayableSongRow>;

/** How much of a hit each song of the pool is, kept per snapshot Library and catalog. */
const popularity = magicQueuePopularity({
  library: homeRecommendationSnapshot.library,
  catalog: homeRecommendationSnapshot.catalog,
  between: homeTurnOf(recommendationTurnEffect),
});

/** What each draw reads beside the store, Discover's levels as they are at that draw. */
const sources = {
  entryVideoIds: seedIds.get.pipe(Effect.orDie),
  disliked: Effect.promise(currentDislikedSongs),
  popularity,
  levels: () => ({ level: discoverLevel.get(), popularity: discoverSliders.get().popularity }),
};

/**
 * The pages the row last showed this session: Home mounting again finds
 * them. Null before the first draw, when a cold start draws the snapshot's
 * (#1353).
 */
let keptPages: readonly (readonly Seed[])[] | null = null;

/** The first draw keeps the pages Home showed last (this session's, or the snapshot's) in place. */
const firstPlan = (): MagicQueuePagesPlan => {
  const pages = keptPages ?? snapshotSection("magicQueue") ?? null;
  return pages === null
    ? { kind: "fresh" }
    : { kind: "keep", pages: pages.map((page) => page.map(magicQueueSeedId)) };
};

/**
 * The row's pages (Core's `magicQueuePages`) through Home's local-query path:
 * no saved picks or taste profile. Null until they're first read. Only the
 * owner's refresh draws again: re-renders, Now Playing covering the screen,
 * and leaving Home for another screen and coming back keep the pages
 * (#1251). Home's first frame draws the pages it showed last, which the
 * first read keeps in their places.
 */
const usePoolPages = (enabled: boolean) => {
  const [read, setRead] = useState(() => magicQueuePagesRead(Math.random, firstPlan()));
  const query = useMemo(
    () =>
      libraryQuery(
        read.key,
        read.reads,
        Effect.flatMap(LibraryStore, (store) => read.read(store, sources)),
      ),
    [read],
  );
  const answer = useLibraryQuery<readonly (readonly Seed[])[] | null>(enabled ? query : null, null);
  const [shown, setShown] = useState<readonly (readonly Seed[])[] | null>(
    () => keptPages ?? snapshotSection("magicQueue") ?? null,
  );
  if (answer !== null && answer !== shown) setShown(answer);
  // Kept for the session, and noted for the next snapshot once read.
  useSnapshotted("magicQueue", answer ?? undefined);
  useEffect(() => {
    if (answer !== null) keptPages = answer;
  }, [answer]);
  // A seed disliked while the row shows leaves it at once; the next draw fills its place.
  const disliked = useDislikedSongs(enabled);
  const drawn = answer ?? shown;
  const pages = useMemo(
    () =>
      drawn === null
        ? null
        : drawn.map((page) =>
            withoutDisliked(page, disliked, (seed) =>
              seed.source === "library" ? { id: seed.song.id } : { videoId: seed.song.videoId },
            ),
          ),
    [drawn, disliked],
  );
  return { pages, setRead };
};

/**
 * The row's songs and their refresh: three pages of nine of the Library's
 * songs with a file and the playlists' YT Music entries when there are any,
 * else nine of [artistMixes]' streamed songs (what the Artist mixes row
 * shows), drawn once when Home first opens and kept in their places while
 * the mixes rebuild or re-rank. Hidden while [ytMusic] is off.
 */
export const useMagicQueueSection = (
  ytMusic: boolean,
  artistMixes: DiscoverMixesSection,
): MagicQueueSection => {
  const { pages, setRead } = usePoolPages(ytMusic);
  // Null until the mixes are first drawn from.
  const [mixPicks, setMixPicks] = useState<MagicQueueMixPicks | null>(null);
  const row = magicQueueRow({ ytMusic, pages, artistMixes });
  const { shown, picks } = magicQueueShown(row, mixPicks, Math.random);
  // Kept for the next render: the same mixes keep these songs.
  if (picks !== mixPicks) setMixPicks(picks);
  const refresh = (index: number) => {
    const { strings } = currentLocalisation();
    if (row.kind === "mixes") {
      const { mixes } = row;
      const previous = videoIdsOf(picks?.songs ?? []);
      const next: MagicQueueMixPicks = { mixes, songs: magicQueueMixPicks(mixes, Math.random) };
      setMixPicks(next);
      void showToast(strings.discover.newSongs, {
        label: strings.discover.undo,
        run: () =>
          setMixPicks((current) =>
            current === next
              ? { mixes, songs: magicQueueMixPicks(mixes, Math.random, previous) }
              : current,
          ),
      });
      return;
    }
    const previous = (pages ?? []).map((page) => page.map(magicQueueSeedId));
    const plan: MagicQueuePagesPlan = { kind: "redraw", pages: previous, index };
    const next = magicQueuePagesRead(Math.random, plan);
    setRead(next);
    void showToast(strings.discover.newSongs, {
      label: strings.discover.undo,
      run: () => {
        setRead((current) =>
          current === next
            ? magicQueuePagesRead(Math.random, { kind: "keep", pages: previous })
            : current,
        );
      },
    });
  };
  return { shown, refresh };
};

/** Starts the same seeded Magic Queue as the song's long-press menu, including queue Undo. */
export const startMagicQueueFrom = (song: PlayableSongRow): void =>
  runMagicQueueStart(
    startMagicQueue({ kind: "track", id: String(song.id), title: song.title }, [song]),
  );

/** Starts a Magic Queue from a streamed [song] (a mix's or a playlist's), as its long-press menu's Magic Queue does. */
export const startStreamedMagicQueueFrom = (song: YtAlbumSong): void =>
  void startFromLibraryMatch(
    appRuntime.runPromise(Effect.flatMap(LibraryStore, (store) => store.matchingSong(song))),
    (found) => startMagicQueueFromStream(song, found),
  );
