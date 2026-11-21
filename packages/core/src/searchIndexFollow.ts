/**
 * When Search's index reads the Library (#1354): the index is kept in memory
 * for the whole session, so opening Search and typing read nothing, and it
 * follows every Library change instead.
 *
 * - First every source is read once, in the order given.
 * - An edit (a change that isn't a burst: a tag edit, a deletion, a playlist
 *   edit, a sync pull) re-reads each source it reaches at once.
 * - A burst (scan batches, downloads landing, an import filling a playlist)
 *   that names its songs patches just those songs into the patchable source
 *   (`patch`); the other sources it reaches, and a burst naming no songs,
 *   re-read at most once per [throttleMs].
 * - One job at a time. A change reaching a source while it is read reads it
 *   again after; songs landing while the songs are read are patched in after
 *   that read, and those landing before it starts are left to it.
 * - A failed read is tried again after [throttleMs]; a failed patch reads the
 *   whole source again.
 * - Changes no source reads (favorites, plays) ask nothing.
 */

import { libraryChangeAffects, type LibraryChange, type LibraryReads } from "./libraryQueries.ts";

export type SearchIndexJob<S extends string> =
  | { readonly kind: "read"; readonly source: S }
  | { readonly kind: "patch"; readonly source: S; readonly ids: readonly number[] };

export interface SearchIndexFollower<S extends string> {
  /** Something in the Library changed, at [now] (ms). */
  readonly change: (change: LibraryChange, now: number) => void;
  /**
   * The job to run at [now]; `{ wait }` when the next is due in that many ms;
   * null when nothing is due, or a job is under way.
   */
  readonly next: (now: number) => SearchIndexJob<S> | { readonly wait: number } | null;
  /** The job [next] gave ended at [now], [ok] or failed. */
  readonly done: (job: SearchIndexJob<S>, now: number, ok: boolean) => void;
  /** Whether every source has been read once. */
  readonly ready: () => boolean;
}

/** How out of date a source is. */
const Stale = { none: 0, burst: 1, edit: 2 } as const;
type Stale = (typeof Stale)[keyof typeof Stale];

interface SourceState {
  readonly reads: LibraryReads;
  read: boolean;
  stale: Stale;
  /** How out of date it was when the read under way started. */
  reading: Stale;
  /** When a read for bursts may next start. */
  dueAt: number;
  /** After a failed read, when it may be tried again. */
  retryAt: number;
}

export const createSearchIndexFollower = <S extends string>(options: {
  readonly sources: Readonly<Record<S, LibraryReads>>;
  /** The source whose rows a burst naming them patches in (the songs, by Track id). */
  readonly patchable: S;
  readonly throttleMs: number;
}): SearchIndexFollower<S> => {
  const { patchable, throttleMs } = options;
  const names = Object.keys(options.sources) as S[];
  const states = new Map<S, SourceState>(
    names.map((name) => [
      name,
      {
        reads: options.sources[name],
        read: false,
        stale: Stale.edit,
        reading: Stale.none,
        dueAt: 0,
        retryAt: 0,
      },
    ]),
  );
  const state = (name: S): SourceState => states.get(name)!;
  /** Songs to patch in, in the order they landed. */
  let patchIds: number[] = [];
  let running: SearchIndexJob<S> | null = null;

  const mark = (source: SourceState, stale: Stale): void => {
    if (stale > source.stale) source.stale = stale;
  };

  const startRead = (name: S): SearchIndexJob<S> => {
    const source = state(name);
    source.reading = source.stale;
    source.stale = Stale.none;
    running = { kind: "read", source: name };
    return running;
  };

  return {
    change: (change, _now) => {
      for (const name of names) {
        const source = state(name);
        if (!libraryChangeAffects(source.reads, change)) continue;
        const patch =
          name === patchable &&
          change.burst === true &&
          change.kind === "tracks" &&
          change.ids !== undefined;
        if (patch) {
          // Before the first read starts, that read holds them.
          if (!source.read && running?.source !== name) continue;
          for (const id of change.ids!) if (!patchIds.includes(id)) patchIds.push(id);
        } else mark(source, change.burst === true ? Stale.burst : Stale.edit);
      }
    },
    next: (now) => {
      if (running !== null) return null;
      let wait = Number.POSITIVE_INFINITY;
      for (const name of names) {
        const source = state(name);
        if (source.stale !== Stale.edit) continue;
        if (source.retryAt <= now) return startRead(name);
        wait = Math.min(wait, source.retryAt - now);
      }
      const songs = state(patchable);
      if (patchIds.length > 0 && songs.read) {
        running = { kind: "patch", source: patchable, ids: patchIds };
        patchIds = [];
        return running;
      }
      for (const name of names) {
        const source = state(name);
        if (source.stale !== Stale.burst) continue;
        const at = Math.max(source.dueAt, source.retryAt);
        if (at <= now) return startRead(name);
        wait = Math.min(wait, at - now);
      }
      return wait === Number.POSITIVE_INFINITY ? null : { wait };
    },
    done: (job, now, ok) => {
      if (running === job) running = null;
      const source = state(job.source);
      if (job.kind === "patch") {
        if (!ok) mark(source, Stale.edit);
        return;
      }
      const reading = source.reading;
      source.reading = Stale.none;
      if (ok) {
        source.read = true;
        if (reading === Stale.burst) source.dueAt = now + throttleMs;
      } else {
        // Tried again once the throttle has passed (a first read too).
        mark(source, reading);
        source.retryAt = now + throttleMs;
      }
    },
    ready: () => {
      for (const source of states.values()) if (!source.read) return false;
      return true;
    },
  };
};

/** What orders a song as the Library's songs list reads them. */
export interface SongReadKeys {
  readonly titleSort: string;
  readonly artistSort: string;
  readonly path: string | null;
}

const compareBinary = (a: string | null, b: string | null): number => {
  if (a === b) return 0;
  // SQLite puts NULL first in ascending order.
  if (a === null) return -1;
  if (b === null) return 1;
  return a < b ? -1 : 1;
};

/**
 * The order the songs list is read in (the client's `BY_TITLE`: title sort
 * key, artist sort key, path), so songs patched into the index (`patch`) sit
 * where a whole read would put them and ties rank the same.
 */
export const compareSongReadOrder = (a: SongReadKeys, b: SongReadKeys): number =>
  compareBinary(a.titleSort, b.titleSort) ||
  compareBinary(a.artistSort, b.artistSort) ||
  compareBinary(a.path, b.path);
