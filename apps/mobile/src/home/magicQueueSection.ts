/**
 * Home draws nine random playable Library songs on each visit, independently
 * of recommendations; with none in the Library, nine streamed songs of the
 * Artist mixes (Core's `magicQueueRow`).
 */
import {
  magicQueueMixPicks,
  magicQueueRow,
  magicQueueShown,
  type DiscoverMixesSection,
  type MagicQueueMixPicks,
  type MagicQueueShown as CoreMagicQueueShown,
  type YtAlbumSong,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";

import { LibraryStore, type PlayableSongRow } from "@/library/LibraryStore";
import { libraryQuery, useLibraryQuery } from "@/library/sharedQueries";
import { showToast } from "@/overlay/toast";
import { startMagicQueue, startStreamedMagicQueue } from "@/playback/MagicQueue";
import { runMagicQueueStart } from "@/playback/magicQueueStart";

import { randomMagicQueueRead } from "./randomMagicQueueRead";

/** What the row draws (Core's `magicQueueShown`), its mixes' songs picked. */
export type MagicQueueShown = CoreMagicQueueShown<PlayableSongRow>;

export interface MagicQueueSection {
  readonly shown: MagicQueueShown;
  /** Brings another random set, with Undo. */
  readonly refresh: () => void;
}

const videoIdsOf = (songs: readonly YtAlbumSong[]): string[] => songs.map((song) => song.videoId);

/**
 * Nine random Library songs through the same immediate local-query path as
 * the rest of Home: no saved daily picks, taste profile, recommendation
 * deadline, settlement or free turns. Null until the Library is first read.
 * A focus after leaving Home draws again; ordinary re-renders and Now Playing
 * covering the screen keep this visit's songs.
 */
const useLibraryPicks = () => {
  const [read, setRead] = useState(() => randomMagicQueueRead(Math.random));
  const query = useMemo(
    () => libraryQuery(read.key, read.reads, Effect.flatMap(LibraryStore, read.read)),
    [read],
  );
  const answer = useLibraryQuery<readonly PlayableSongRow[] | null>(query, null);
  const [shown, setShown] = useState<readonly PlayableSongRow[] | null>(null);
  if (answer !== null && answer !== shown) setShown(answer);
  return { songs: answer ?? shown, setRead };
};

/**
 * The row's songs and their refresh: the Library's when it has songs with a
 * file, else nine of [artistMixes]' streamed songs (what the Artist mixes
 * row shows), drawn again on each visit and kept in their places while the
 * mixes rebuild or re-rank. Hidden while [ytMusic] is off.
 */
export const useMagicQueueSection = (
  ytMusic: boolean,
  artistMixes: DiscoverMixesSection,
): MagicQueueSection => {
  const { songs: librarySongs, setRead } = useLibraryPicks();
  // Null: draw afresh from the mixes on the next render.
  const [mixPicks, setMixPicks] = useState<MagicQueueMixPicks | null>(null);
  const opened = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (opened.current) {
        setRead(randomMagicQueueRead(Math.random));
        setMixPicks(null);
      }
      opened.current = true;
    }, [setRead]),
  );
  const row = magicQueueRow({ ytMusic, library: librarySongs, artistMixes });
  const { shown, picks } = magicQueueShown(row, mixPicks, Math.random);
  // Kept for the next render: the same mixes keep these songs.
  if (picks !== mixPicks) setMixPicks(picks);
  const refresh = () => {
    if (row.kind === "mixes") {
      const { mixes } = row;
      const previous = videoIdsOf(picks?.songs ?? []);
      const next: MagicQueueMixPicks = { mixes, songs: magicQueueMixPicks(mixes, Math.random) };
      setMixPicks(next);
      void showToast("New songs", {
        label: "Undo",
        run: () =>
          setMixPicks((current) =>
            current === next
              ? { mixes, songs: magicQueueMixPicks(mixes, Math.random, previous) }
              : current,
          ),
      });
      return;
    }
    const previous = (librarySongs ?? []).map((song) => song.id);
    const next = randomMagicQueueRead(Math.random);
    setRead(next);
    void showToast("New songs", {
      label: "Undo",
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

/** Starts a Magic Queue from a mix's streamed [song], as its long-press menu's Magic Queue does. */
export const startStreamedMagicQueueFrom = (song: YtAlbumSong): void =>
  runMagicQueueStart(startStreamedMagicQueue(song));
