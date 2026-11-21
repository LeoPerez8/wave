import { currentLocalisation } from "@/localisation/localisation";
/**
 * Home draws nine random seeds when it first opens, from the Library's playable
 * songs and the playlists' YT Music entries together, independently of
 * recommendations; with neither, nine streamed songs of the Artist mixes
 * (Core's `magicQueueRow`).
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
import { useMemo, useState } from "react";

import { freeTurnEffect } from "@/lib/backgroundWork";
import { currentDislikedSongs, useDislikedSongs } from "@/library/dislikes";
import { onLibraryChange } from "@/library/libraryChanges";
import { LibraryStore } from "@/library/LibraryStore";
import { type PlayableSongRow } from "@wave/client";
import { libraryQuery, useLibraryQuery } from "@/library/sharedQueries";
import { showToast } from "@/overlay/toast";
import { startMagicQueue } from "@/playback/MagicQueue";
import { runMagicQueueStart, startMagicQueueFromStream } from "@/playback/magicQueueStart";
import { appRuntime } from "@/library/runtime";

import { createPlaylistSeedIdsRead, readPlaylistSeedIds } from "./playlistSeedIds";
import { randomMagicQueueRead } from "./randomMagicQueueRead";
import { startFromLibraryMatch } from "./streamedMagicQueueStart";

/** What the row draws (Core's `magicQueueShown`), its mixes' songs picked. */
export type MagicQueueShown = CoreMagicQueueShown<PlayableSongRow>;

export interface MagicQueueSection {
  readonly shown: MagicQueueShown;
  /** Brings another random set, with Undo. */
  readonly refresh: () => void;
}

/** The row's playlist entries, read in pages between free turns: it's waiting to be shown. */
const seedIds = createPlaylistSeedIdsRead(
  Effect.flatMap(LibraryStore, (store) => readPlaylistSeedIds(store, freeTurnEffect)).pipe(
    namedWork("Home Magic Queue seeds"),
  ),
);
onLibraryChange(seedIds.change);

const videoIdsOf = (songs: readonly YtAlbumSong[]): string[] => songs.map((song) => song.videoId);

/** A seed of the row: a Library song, or a playlist's YT Music entry. */
type Seed = MagicQueueSeed<PlayableSongRow>;

/**
 * Nine random seeds (Library songs and playlist entries) through the same
 * immediate local-query path as the rest of Home: no saved daily picks,
 * taste profile, recommendation deadline, settlement or free turns. Null
 * until they're first read. Only the owner's refresh draws again: re-renders,
 * Now Playing covering the screen, and leaving Home for another screen and
 * coming back keep the seeds (#1251).
 */
const usePoolPicks = (enabled: boolean) => {
  const [read, setRead] = useState(() => randomMagicQueueRead(Math.random));
  const query = useMemo(
    () =>
      libraryQuery(
        read.key,
        read.reads,
        Effect.flatMap(LibraryStore, (store) =>
          read.read(store, seedIds.get.pipe(Effect.orDie), Effect.promise(currentDislikedSongs)),
        ),
      ),
    [read],
  );
  const answer = useLibraryQuery<readonly Seed[] | null>(enabled ? query : null, null);
  const [shown, setShown] = useState<readonly Seed[] | null>(null);
  if (answer !== null && answer !== shown) setShown(answer);
  // A seed disliked while the row shows leaves it at once; the next draw fills its place.
  const disliked = useDislikedSongs(enabled);
  const drawn = answer ?? shown;
  const seeds = useMemo(
    () =>
      drawn === null
        ? null
        : withoutDisliked(drawn, disliked, (seed) =>
            seed.source === "library" ? { id: seed.song.id } : { videoId: seed.song.videoId },
          ),
    [drawn, disliked],
  );
  return { seeds, setRead };
};

/**
 * The row's songs and their refresh: nine seeds of the Library's songs with
 * a file and the playlists' YT Music entries when there are any, else nine
 * of [artistMixes]' streamed songs (what the Artist mixes row shows), drawn
 * once when Home first opens and kept in their places while the mixes
 * rebuild or re-rank. Hidden while [ytMusic] is off.
 */
export const useMagicQueueSection = (
  ytMusic: boolean,
  artistMixes: DiscoverMixesSection,
): MagicQueueSection => {
  const { seeds, setRead } = usePoolPicks(ytMusic);
  // Null until the mixes are first drawn from.
  const [mixPicks, setMixPicks] = useState<MagicQueueMixPicks | null>(null);
  const row = magicQueueRow({ ytMusic, seeds, artistMixes });
  const { shown, picks } = magicQueueShown(row, mixPicks, Math.random);
  // Kept for the next render: the same mixes keep these songs.
  if (picks !== mixPicks) setMixPicks(picks);
  const refresh = () => {
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
    const previous = (seeds ?? []).map(magicQueueSeedId);
    const next = randomMagicQueueRead(Math.random);
    setRead(next);
    void showToast(strings.discover.newSongs, {
      label: strings.discover.undo,
      run: () => {
        setRead((current) =>
          current === next ? randomMagicQueueRead(Math.random, previous) : current,
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
