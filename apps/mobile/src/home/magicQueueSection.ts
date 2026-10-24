/** Home draws nine random playable Library songs on each visit, independently of recommendations. */
import * as Effect from "effect/Effect";
import { useFocusEffect } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";

import { LibraryStore, type PlayableSongRow } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { libraryQuery, useLibraryQuery } from "@/library/sharedQueries";
import { showError } from "@/overlay/alert";
import { showToast } from "@/overlay/toast";
import { startMagicQueue } from "@/playback/MagicQueue";

import { randomMagicQueueRead } from "./randomMagicQueueRead";

export interface MagicQueueSection {
  readonly songs: readonly PlayableSongRow[];
  /** Brings another random set, with Undo. */
  readonly refresh: () => void;
}

/**
 * The same immediate local-query path as the rest of Home: no saved daily
 * picks, taste profile, recommendation deadline, settlement or free turns.
 * A focus after leaving Home draws again; ordinary re-renders and Now Playing
 * covering the screen keep this visit's songs.
 */
export const useMagicQueueSection = (): MagicQueueSection => {
  const [read, setRead] = useState(() => randomMagicQueueRead(Math.random));
  const opened = useRef(false);
  useFocusEffect(
    useCallback(() => {
      if (opened.current) setRead(randomMagicQueueRead(Math.random));
      opened.current = true;
    }, []),
  );
  const query = useMemo(
    () => libraryQuery(read.key, read.reads, Effect.flatMap(LibraryStore, read.read)),
    [read],
  );
  const answer = useLibraryQuery<readonly PlayableSongRow[] | null>(query, null);
  const [shown, setShown] = useState<readonly PlayableSongRow[]>([]);
  if (answer !== null && answer !== shown) setShown(answer);
  const songs = answer ?? shown;
  const refresh = () => {
    const previous = songs.map((song) => song.id);
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
  return { songs, refresh };
};

/** Starts the same seeded Magic Queue as the song's long-press menu, including queue Undo. */
export const startMagicQueueFrom = (song: PlayableSongRow): void => {
  appRuntime
    .runPromise(startMagicQueue({ kind: "track", id: String(song.id), title: song.title }, [song]))
    .catch((error: unknown) => showError("Couldn't start the Magic Queue", error));
};
