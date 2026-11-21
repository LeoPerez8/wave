import type { DislikedSongs } from "@wave/core";
import { Effect } from "effect";
import { useEffect, useSyncExternalStore } from "react";

import type { DislikedTrack } from "@wave/client/db/dislikes";

import { createDislikeSet, type DislikeToKeep } from "./dislikeSet";
import {
  onLibraryChange,
  onSavedStars,
  onUndisliked,
  publishDisliked,
  publishUndisliked,
} from "./libraryChanges";
import { LibraryStore } from "./LibraryStore";
import { appRuntime } from "./runtime";

/**
 * The disliked songs (docs/spec.md, Dislike), held in memory so every menu
 * shows a dislike the moment it's set and every picker (the Magic Queue, the
 * mixes, Discover's row) filters by the same set. The set holds every key of
 * each disliked song, its video and its Track id (Core's `dislikedSongs`), so
 * a song disliked while streamed is disliked as the Library's song too. The
 * store keeps them (`dislikes`), so they survive a restart, and they sync
 * with the Wave account (`startSync`). Core's `dislikes.ts` decides what a
 * dislike changes; `dislikeSongs.ts` runs it; `dislikeSet.ts` is the set.
 */
const run = <A>(use: (store: LibraryStore["Service"]) => Effect.Effect<A, unknown>): Promise<A> =>
  // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
  appRuntime.runPromise(LibraryStore.use(use));

/** While the set itself says dislikes are gone (`publishUndisliked` runs its listeners at once). */
let announcing = false;

const dislikes = createDislikeSet({
  read: () =>
    run((store) =>
      Effect.all({
        keys: Effect.map(store.listDislikes, (songs) => songs.map((song) => song.key)),
        tracks: store.dislikedTracks,
      }),
    ),
  keep: (songs) => run((store) => store.setDislikes(songs)),
  forget: (keys) => run((store) => store.removeDislikes(keys)),
  disliked: publishDisliked,
  undisliked: (keys) => {
    announcing = true;
    try {
      publishUndisliked(keys);
    } finally {
      announcing = false;
    }
  },
});

// A file that arrives for a disliked video is the disliked song from then on.
onLibraryChange((change) => {
  if (change.kind === "tracks") void dislikes.tracksChanged();
});

// A star removes its song's dislike, whoever sets it: a removal announced from outside this
// file leaves the set here. One the set announces itself is out of it by then, and the song
// may have been disliked again since.
onUndisliked((keys) => {
  if (!announcing) dislikes.dropped(keys);
});

// A download or scan that stars a pending favorite as it saves the song changes the marks in
// the store: the set is read again.
onSavedStars(() => void dislikes.reload());

/** Reads the dislikes once; resolves when they're read, or the read failed. */
export const loadDislikes = dislikes.load;

/**
 * Reads the dislikes again after the Wave account changed them (a pull).
 * Nothing to do before the first read, which reads them as they are by then.
 */
export const reloadDislikes = dislikes.reload;

/** Calls [listener] whenever a dislike set or removed here has been saved (sync follows it); returns how to stop. */
export const onDislikesSaved = dislikes.onSaved;

/** The disliked songs as this phone knows them now, unfollowed; none before they're read. */
export const dislikedSongsNow = dislikes.now;

/**
 * The disliked songs, read first if they haven't been: what a picker filters
 * its pool by (Core's `withoutDisliked`). A failed read gives none, so a pick
 * is never held back by it.
 */
export const currentDislikedSongs = (): Promise<DislikedSongs> =>
  loadDislikes().then(dislikedSongsNow);

/** The disliked songs, followed as they change: for menus, and lists Wave picked. */
export const useDislikedSongs = (active = true): DislikedSongs => {
  useEffect(() => {
    if (active) void loadDislikes();
  }, [active]);
  return useSyncExternalStore(dislikes.subscribe, dislikedSongsNow);
};

/** How many songs are disliked, followed: each once, whatever keys it is found by. */
export const useDislikeCount = (): number => {
  useEffect(() => {
    void loadDislikes();
  }, []);
  return useSyncExternalStore(dislikes.subscribe, dislikes.count);
};

/** Calls [listener] with the disliked songs whenever they change; returns how to stop. */
export const onDislikesChanged = dislikes.onChanged;

/**
 * Keeps [songs] as disliked: the set has them at once, with the Library songs
 * they are ([tracks]), and the store keeps them. Only the dislikes: what else
 * a dislike changes (the favorite, the toast) is `dislikeSongs`'s, which is
 * what menus and buttons call. Rejects when the save failed.
 */
export const keepDislikes = (
  songs: readonly DislikeToKeep[],
  tracks: readonly DislikedTrack[] = [],
): Promise<void> => dislikes.keep(songs, tracks);

/**
 * Removes the dislikes of the songs under [keys], whichever key each is kept
 * under: the set loses them at once, then the store. Rejects when the save
 * failed.
 */
export const forgetDislikes = (keys: readonly string[]): Promise<void> => dislikes.forget(keys);
