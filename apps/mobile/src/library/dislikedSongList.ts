import { dislikedSongRows, type DislikedSong, type DislikedSongRow } from "@wave/core";
import { useEffect, useMemo, useState } from "react";

import { useDislikedSongs } from "./dislikes";
import { LibraryStore } from "./LibraryStore";
import { appRuntime } from "./runtime";

/**
 * The disliked songs as last read, kept for the session so Settings ›
 * Disliked songs opens on them (#1352): one row per dislike, which the
 * page's own read replaces; `readyScreens.ts` reads it at startup.
 */
let keptList: readonly DislikedSong[] | null = null;

/** Reads the disliked songs, keeping what it read for the page's next opening. */
export const readDislikedSongs = (): Promise<readonly DislikedSong[]> =>
  appRuntime
    // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
    .runPromise(LibraryStore.use((store) => store.listDislikes))
    .then((read) => {
      keptList = read;
      return read;
    });

/**
 * Settings › Disliked songs' rows (Core's `dislikedSongRows`): the dislikes
 * the store keeps, the newest first, read again whenever the disliked songs
 * change. A dislike removed on the page leaves its row at once, ahead of the
 * read. Null until the first read ends, so the page doesn't say there are
 * none while it doesn't know.
 */
export const useDislikedSongList = (): readonly DislikedSongRow[] | null => {
  const disliked = useDislikedSongs();
  // The page opens on the list last read (#1352), then shows this visit's read in place.
  const [songs, setSongs] = useState<readonly DislikedSong[] | null>(() => keptList);
  useEffect(() => {
    let current = true;
    void readDislikedSongs().then(
      (read) => {
        if (current) setSongs(read);
      },
      () => {
        // A failed read lists none, as a failed read of the set does.
        if (current) setSongs((known) => known ?? []);
      },
    );
    return () => {
      current = false;
    };
  }, [disliked]);
  return useMemo(
    () => (songs === null ? null : dislikedSongRows(songs, disliked)),
    [songs, disliked],
  );
};
