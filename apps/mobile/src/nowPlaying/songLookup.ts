import { parseTrackId, type LibraryChange, type YtSong } from "@wave/core";
import type { SongRow } from "../library/LibraryStore.ts";

/** The song captured by a render/gesture, even if playback moves on while it resolves. */
export interface PlayingSongTarget {
  readonly trackId: string;
  readonly song: YtSong | null;
}
export interface PlayingSongAnswer {
  readonly track: SongRow | null;
  readonly favorite: boolean;
  readonly pendingFavorite: boolean;
}
export const playingSongKey = (target: PlayingSongTarget): string => JSON.stringify(target);

interface Entry {
  readonly target: PlayingSongTarget;
  answer: PlayingSongAnswer | undefined;
  version: number;
  stale: boolean;
  actions: number;
  job: { controller: AbortController; promise: Promise<PlayingSongAnswer> } | undefined;
}

/**
 * One answer for the sheet's controls. Showing it only selects a song; settlement
 * or a gesture acquires it. An old gesture retains its own song across close/skip.
 */
export const createNowPlayingSongLookup = (ports: {
  readonly read: (target: PlayingSongTarget, signal: AbortSignal) => Promise<PlayingSongAnswer>;
}) => {
  const entries = new Map<string, Entry>();
  const listeners = new Set<() => void>();
  let current: Entry | undefined;
  let settled = false;
  const emit = () => {
    for (const listener of listeners) listener();
  };
  const entry = (target: PlayingSongTarget): Entry => {
    const key = playingSongKey(target);
    let found = entries.get(key);
    if (found === undefined) {
      found = { target, answer: undefined, version: 0, stale: true, actions: 0, job: undefined };
      entries.set(key, found);
    }
    return found;
  };
  const cancel = (e: Entry): void => {
    if (e.actions > 0) return;
    e.job?.controller.abort();
    e.job = undefined;
  };
  const prune = (): void => {
    for (const [key, e] of entries) {
      if (e === current || e.actions > 0) continue;
      cancel(e);
      entries.delete(key);
    }
  };
  const ensure = (e: Entry): Promise<PlayingSongAnswer> => {
    if (e.answer !== undefined && !e.stale) return Promise.resolve(e.answer);
    if (e.job !== undefined) return e.job.promise;
    const controller = new AbortController();
    const { signal } = controller;
    const promise = Promise.resolve()
      .then(async () => {
        for (;;) {
          signal.throwIfAborted();
          const version = e.version;
          const answer = await ports.read(e.target, signal);
          signal.throwIfAborted();
          if (version !== e.version) continue;
          e.answer = answer;
          e.stale = false;
          emit();
          return answer;
        }
      })
      .finally(() => {
        if (e.job?.controller === controller) e.job = undefined;
      });
    e.job = { controller, promise };
    return promise;
  };
  const prepare = (): void => {
    if (current !== undefined && settled) void ensure(current).catch(() => {});
  };
  return {
    subscribe(listener: () => void): () => void {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: (target: PlayingSongTarget | null): PlayingSongAnswer | undefined =>
      target === null ? undefined : entries.get(playingSongKey(target))?.answer,
    update(target: PlayingSongTarget | null, shown: boolean, ready: boolean): void {
      const previous = current;
      current = target === null ? undefined : entry(target);
      settled = shown && ready;
      if (previous !== undefined && (previous !== current || !settled)) cancel(previous);
      prune();
      prepare();
    },
    async acquire(target: PlayingSongTarget): Promise<PlayingSongAnswer> {
      const e = entry(target);
      e.actions++;
      try {
        return await ensure(e);
      } finally {
        e.actions--;
        prune();
      }
    },
    change(change: LibraryChange): void {
      for (const e of entries.values()) {
        if (change.kind !== "tracks" && change.kind !== "favorites") continue;
        const ref = parseTrackId(e.target.trackId);
        const id = ref?.kind === "library" ? ref.id : e.answer?.track?.id;
        if (
          change.ids !== undefined &&
          (change.kind === "favorites" || ref?.kind === "library") &&
          (id === undefined || !change.ids.includes(id))
        )
          continue;
        e.version++;
        e.stale = true;
      }
      emit();
      prepare();
    },
  };
};
