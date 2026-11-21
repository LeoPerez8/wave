import {
  NO_DISLIKES,
  dislikedSongs,
  dislikesToForget,
  type DislikedSong,
  type DislikedSongs,
} from "@wave/core";

import type { DislikedTrack } from "@wave/client/db/dislikes";
import { makeExternalStore } from "@wave/client/externalStore";

/**
 * The disliked songs in memory (docs/spec.md, Dislike), free of the app's
 * runtime so its rules are tested: the keys the store keeps, the Library's
 * songs they are about, and Core's `dislikedSongs` of both, which is what
 * every menu and picker reads. `dislikes.ts` wires it to the store.
 */

/** A song to keep as disliked, as the store takes it. */
export type DislikeToKeep = Omit<DislikedSong, "dislikedAt">;

/** What the set reads and writes through. */
export interface DislikeSetPorts {
  /** The keys the dislikes are kept under, and the Library's songs they are about. */
  readonly read: () => Promise<{
    readonly keys: readonly string[];
    readonly tracks: readonly DislikedTrack[];
  }>;
  readonly keep: (songs: readonly DislikeToKeep[]) => Promise<unknown>;
  readonly forget: (keys: readonly string[]) => Promise<unknown>;
  /** The owner disliked [songs]: the taste profile learns it. */
  readonly disliked: (songs: readonly DislikeToKeep[]) => void;
  /** The dislikes under [keys] are gone, or were never saved. */
  readonly undisliked: (keys: readonly string[]) => void;
}

interface State {
  /** The keys the store keeps dislikes under. */
  readonly kept: ReadonlySet<string>;
  /** The Library's songs the dislikes are about, each with its video. */
  readonly tracks: readonly DislikedTrack[];
  /** Core's `dislikedSongs` of both: every key of every disliked song. */
  readonly keys: DislikedSongs;
  readonly loaded: boolean;
  /** Bumped when dislikes are set, so a read that raced them reads again. */
  readonly edits: number;
}

const sameKeys = (a: DislikedSongs, b: DislikedSongs): boolean =>
  a.size === b.size && [...a].every((key) => b.has(key));

/** [state] keeping [kept] about [tracks]; the set it had stays when it holds the same keys. */
const keeping = (
  state: State,
  kept: ReadonlySet<string>,
  tracks: readonly DislikedTrack[],
): State => {
  const keys = dislikedSongs(kept, tracks);
  return { ...state, kept, tracks, keys: sameKeys(keys, state.keys) ? state.keys : keys };
};

export const createDislikeSet = (ports: DislikeSetPorts) => {
  const state = makeExternalStore<State>({
    kept: NO_DISLIKES,
    tracks: [],
    keys: NO_DISLIKES,
    loaded: false,
    edits: 0,
  });
  const savedListeners = new Set<() => void>();
  let reading: Promise<void> | null = null;

  /** Reads the dislikes from the store: at first use, after a write failed, after a pull. */
  const read = (): Promise<void> => {
    if (reading !== null) return reading;
    const edits = state.get().edits;
    const run: Promise<void> = ports
      .read()
      .then(({ keys, tracks }) => {
        reading = null;
        // A dislike set while reading may not be in the result; read again.
        if (state.get().edits !== edits) return read();
        state.update((held) => ({ ...keeping(held, new Set(keys), tracks), loaded: true }));
      })
      .catch(() => {
        reading = null;
      });
    reading = run;
    return run;
  };

  const load = (): Promise<void> => (state.get().loaded ? Promise.resolve() : read());

  const reload = (): Promise<void> => {
    if (!state.get().loaded) return Promise.resolve();
    // A read on its way may have read before the change: it reads again.
    state.update((held) => ({ ...held, edits: held.edits + 1 }));
    return read();
  };

  /**
   * Changes the set at once ([keys] in or out of it), then runs [run]. Should
   * it fail, the set goes back to what the store holds and the failure is
   * passed on, so nothing after it takes the change for saved.
   */
  const write = (
    keys: readonly string[],
    on: boolean,
    tracks: readonly DislikedTrack[],
    run: () => Promise<unknown>,
  ): Promise<void> => {
    if (keys.length === 0) return Promise.resolve();
    state.update((held) => {
      const kept = new Set(held.kept);
      for (const key of keys) {
        if (on) kept.add(key);
        else kept.delete(key);
      }
      const about =
        tracks.length === 0
          ? held.tracks
          : [...new Map([...held.tracks, ...tracks].map((track) => [track.id, track])).values()];
      return { ...keeping(held, kept, about), edits: held.edits + 1 };
    });
    return run().then(
      () => {
        for (const listener of savedListeners) listener();
      },
      (error: unknown) =>
        read().then(() => {
          throw error;
        }),
    );
  };

  return {
    /** Reads the dislikes once; resolves when they're read, or the read failed. */
    load,
    /**
     * Reads the dislikes again after the Wave account changed them (a pull).
     * Nothing to do before the first read, which reads them as they are by then.
     */
    reload,
    /**
     * The Library's songs changed: a disliked video's file may have arrived,
     * and reads disliked as the Library's song from now on. Nothing to read
     * while nothing is disliked.
     */
    tracksChanged: (): Promise<void> =>
      state.get().kept.size === 0 ? Promise.resolve() : reload(),
    /**
     * The store removed the dislikes under [keys] itself (a star set there
     * takes its song's dislike with it): the set loses them. A read on its
     * way may have read before that: it reads again.
     */
    dropped: (keys: readonly string[]): void => {
      state.update((held) => {
        const kept = new Set(held.kept);
        for (const key of keys) kept.delete(key);
        return { ...keeping(held, kept, held.tracks), edits: held.edits + 1 };
      });
    },
    /** The disliked songs as known now, unfollowed; none before they're read. */
    now: (): DislikedSongs => state.get().keys,
    /** How many dislikes are kept: a song counts once, whatever keys it has. */
    count: (): number => state.get().kept.size,
    subscribe: state.subscribe,
    /** Calls [listener] with the disliked songs whenever they change; returns how to stop. */
    onChanged: (listener: (disliked: DislikedSongs) => void): (() => void) => {
      let keys = state.get().keys;
      return state.subscribe(() => {
        if (state.get().keys === keys) return;
        keys = state.get().keys;
        listener(keys);
      });
    },
    /** Calls [listener] whenever a dislike set or removed here has been saved; returns how to stop. */
    onSaved: (listener: () => void): (() => void) => {
      savedListeners.add(listener);
      return () => {
        savedListeners.delete(listener);
      };
    },
    /**
     * Keeps [songs] as disliked: the set has them at once, with the Library
     * songs they are ([tracks]), and the store keeps them. Rejects when the
     * save failed, the set back as the store has it.
     */
    keep: (
      songs: readonly DislikeToKeep[],
      tracks: readonly DislikedTrack[] = [],
    ): Promise<void> => {
      const keys = songs.map((song) => song.key);
      // Before the write, as a star is: the taste profile learns it at once.
      ports.disliked(songs);
      return write(keys, true, tracks, () => ports.keep(songs)).catch((error: unknown) => {
        // Never saved: the profile forgets what it learned.
        ports.undisliked(keys);
        throw error;
      });
    },
    /**
     * Removes the dislikes of the songs under [keys], whichever key each is
     * kept under (Core's `dislikesToForget`): the set loses them at once,
     * then the store. Rejects when the save failed.
     */
    forget: (keys: readonly string[]): Promise<void> => {
      const run = (): Promise<void> => {
        const all = dislikesToForget(keys, state.get().tracks);
        // After the write: the taste profile derived again must not read them back.
        return write(all, false, [], () => ports.forget(all)).then(() => ports.undisliked(all));
      };
      // The songs' other keys are known once the dislikes are read.
      return state.get().loaded ? run() : load().then(run);
    },
  };
};
