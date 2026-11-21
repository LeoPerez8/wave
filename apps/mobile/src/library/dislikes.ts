import { NO_DISLIKES, type DislikedSong, type DislikedSongs } from "@wave/core";
import { useEffect, useSyncExternalStore } from "react";

import { makeExternalStore } from "@wave/client/externalStore";

import { publishDisliked, publishUndisliked } from "./libraryChanges";
import { LibraryStore } from "./LibraryStore";
import { appRuntime } from "./runtime";

/**
 * The disliked songs (docs/spec.md, Dislike), by Core's `dislikeKey`, held in
 * memory so every menu shows a dislike the moment it's set and every picker
 * (the Magic Queue, the mixes, Discover's row) filters by the same set. The
 * store keeps them (`dislikes`), so they survive a restart, and they sync
 * with the Wave account (`startSync`). Core's
 * `dislikes.ts` decides what a dislike changes; `dislikeSongs.ts` runs it.
 */
interface DislikesState {
  readonly keys: DislikedSongs;
  readonly loaded: boolean;
  /** Bumped when dislikes are set, so a read that raced them reads again. */
  readonly edits: number;
}

const dislikes = makeExternalStore<DislikesState>({ keys: NO_DISLIKES, loaded: false, edits: 0 });

let reading: Promise<void> | null = null;

/** Reads the dislikes from the store: at first use, and after a write failed. */
const readDislikes = (): Promise<void> => {
  if (reading !== null) return reading;
  const edits = dislikes.get().edits;
  const read: Promise<void> = appRuntime
    // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
    .runPromise(LibraryStore.use((store) => store.listDislikes))
    .then((songs) => {
      reading = null;
      // A dislike set while reading may not be in the result; read again.
      if (dislikes.get().edits !== edits) return readDislikes();
      dislikes.update((state) => ({
        ...state,
        keys: new Set(songs.map((song) => song.key)),
        loaded: true,
      }));
    })
    .catch(() => {
      reading = null;
    });
  reading = read;
  return read;
};

/** Reads the dislikes once; resolves when they're read, or the read failed. */
export const loadDislikes = (): Promise<void> =>
  dislikes.get().loaded ? Promise.resolve() : readDislikes();

/**
 * Reads the dislikes again after the Wave account changed them (a pull).
 * Nothing to do before the first read, which reads them as they are by then.
 */
export const reloadDislikes = (): Promise<void> => {
  if (!dislikes.get().loaded) return Promise.resolve();
  // A read on its way may have read before the pull: it reads again.
  dislikes.update((state) => ({ ...state, edits: state.edits + 1 }));
  return readDislikes();
};

const savedListeners = new Set<() => void>();

/** Calls [listener] whenever a dislike set or removed here has been saved (sync follows it); returns how to stop. */
export const onDislikesSaved = (listener: () => void): (() => void) => {
  savedListeners.add(listener);
  return () => {
    savedListeners.delete(listener);
  };
};

const saved = (): void => {
  for (const listener of savedListeners) listener();
};

/** The disliked songs as this phone knows them now, unfollowed; none before they're read. */
export const dislikedSongsNow = (): DislikedSongs => dislikes.get().keys;

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

/** Calls [listener] with the disliked songs whenever they change; returns how to stop. */
export const onDislikesChanged = (listener: (disliked: DislikedSongs) => void): (() => void) => {
  let keys = dislikes.get().keys;
  return dislikes.subscribe(() => {
    if (dislikes.get().keys === keys) return;
    keys = dislikes.get().keys;
    listener(keys);
  });
};

/**
 * Changes the set at once ([keys] in or out of it), then runs [write]; should
 * it fail, the set goes back to what the store holds.
 */
const write = (
  keys: readonly string[],
  on: boolean,
  run: (store: LibraryStore["Service"]) => ReturnType<LibraryStore["Service"]["removeDislikes"]>,
): Promise<void> => {
  if (keys.length === 0) return Promise.resolve();
  dislikes.update((state) => {
    const next = new Set(state.keys);
    for (const key of keys) {
      if (on) next.add(key);
      else next.delete(key);
    }
    return { ...state, keys: next, edits: state.edits + 1 };
  });
  return (
    appRuntime
      // oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
      .runPromise(LibraryStore.use(run))
      .then(saved, readDislikes)
  );
};

/**
 * Keeps [songs] as disliked: the set has them at once, and the store keeps
 * them. Only the dislikes: what else a dislike changes (the favorite, the
 * toast) is `dislikeSongs`'s, which is what menus and buttons call.
 */
export const keepDislikes = (songs: readonly Omit<DislikedSong, "dislikedAt">[]): Promise<void> => {
  // Before the write, as a star is: the taste profile learns it at once.
  publishDisliked(songs);
  return write(
    songs.map((song) => song.key),
    true,
    (store) => store.setDislikes(songs),
  );
};

/** Forgets the dislikes kept under [keys]: the set loses them at once, then the store. */
export const forgetDislikes = (keys: readonly string[]): Promise<void> =>
  // After the write: the taste profile derived again must not read them back.
  write(keys, false, (store) => store.removeDislikes(keys)).then(() => publishUndisliked(keys));
