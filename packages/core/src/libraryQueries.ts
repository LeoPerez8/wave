/**
 * Shared Library queries: what changed in the Library, which queries that
 * reaches, and one registry that reads each query once for every screen
 * showing it, pauses the ones only hidden screens show, and keeps a bounded
 * number of results nobody shows for a quick return.
 */

/** The kinds of Library data a change can touch, and a query can read. */
export type LibraryDataKind =
  /** Tracks, and what's derived from them: albums, artists, genres, counts, missing songs. */
  | "tracks"
  /** Music folders and excluded folders. */
  | "folders"
  /** Stars. */
  | "favorites"
  /** Playlists and their entries. */
  | "playlists"
  /** The play history. */
  | "plays";

/**
 * What changed in the Library. Every write that other screens should see
 * announces one (the app's `publishLibraryChange`).
 */
export interface LibraryChange {
  readonly kind: LibraryDataKind;
  /**
   * The items changed, when the writer knows them: track ids for `tracks`,
   * `favorites` and `plays`, playlist ids for `playlists`. Absent: any of them.
   */
  readonly ids?: readonly number[];
  /**
   * One of a stream of changes that only add to or update what screens show
   * (scan batches, an import filling a playlist, plays): screens in sight
   * take several at once, at most one read per `throttleMs`, and hidden ones
   * wait until they're shown again.
   *
   * Absent: an edit that may remove or alter items (deleted songs, a tag
   * edit, a scan's end dropping gone files, a star, a playlist edit). Every
   * screen showing a query it reaches re-reads at once, hidden ones too, so
   * none shows a removed item when it comes back.
   */
  readonly burst?: boolean;
}

/**
 * What a query reads, per kind: `true` for any item of that kind, or the ids
 * it reads (a playlist screen reads its playlist). Kinds left out don't
 * concern it.
 */
export type LibraryReads = { readonly [K in LibraryDataKind]?: true | readonly number[] };

/** Whether [change] can change what a query reading [reads] returns. */
export const libraryChangeAffects = (reads: LibraryReads, change: LibraryChange): boolean => {
  const read = reads[change.kind];
  if (read === undefined) return false;
  if (read === true || change.ids === undefined) return true;
  return change.ids.some((id) => read.includes(id));
};

/** How the registry paces reads and how much it keeps that nobody shows. */
export interface LibraryQueryLimits {
  /** A query re-reads for `burst` changes at most this often. */
  readonly throttleMs: number;
  /** A result nobody shows is kept this long for a screen that comes back to it. */
  readonly retainMs: number;
  /** At most this many results nobody shows are kept; the least recently shown go first. */
  readonly maxRetained: number;
}

export const LIBRARY_QUERY_LIMITS: LibraryQueryLimits = {
  throttleMs: 1500,
  retainMs: 30_000,
  maxRetained: 8,
};

/** How a read ended: its result, or a failure (the last result stands). */
export type LibraryQueryOutcome<V> =
  | { readonly ok: true; readonly value: V }
  | { readonly ok: false };

/** A query's result, boxed so a result that is itself `undefined` still reads as one. */
export interface LibraryQueryResult<V> {
  readonly value: V;
}

/** One screen (or component) showing a query. */
export interface LibraryQueryConsumer {
  /** The screen came into sight: a result it missed while hidden reaches it now. */
  readonly show: () => void;
  /** The screen went out of sight (another tab, a pushed screen, Now Playing over it). */
  readonly hide: () => void;
  /** Re-reads now, whatever the query's reads say (an edit the registry wasn't told of). */
  readonly refresh: () => void;
  /** The screen no longer shows the query. Call once. */
  readonly detach: () => void;
}

/** What the registry did so far, for the perf build's flushes. */
export interface LibraryQueryStats {
  /** Queries with a consumer or a kept result. */
  readonly entries: number;
  /** Of those, kept results nobody shows. */
  readonly retained: number;
  readonly consumers: number;
  /** Reads started. */
  readonly reads: number;
  /** Consumers that started from a current result, or joined a read under way, instead of reading. */
  readonly shared: number;
  /** Changes that reached a query only hidden screens show, which waited for one to come back. */
  readonly paused: number;
  /** Results dropped because an edit landed while they were read. */
  readonly discarded: number;
  /** Kept results dropped: changed, too old, or over `maxRetained`. */
  readonly evicted: number;
}

export interface LibraryQueries<V> {
  /**
   * Starts showing query [key], which reads [reads]. Queries are identified by
   * [key] alone: the same key must always read the same thing. [onChange] is
   * called when the result changes (while hidden, once it's shown again).
   */
  readonly attach: (
    key: string,
    reads: LibraryReads,
    options: { readonly visible: boolean; readonly onChange: () => void },
  ) => LibraryQueryConsumer;
  /** The query's current result, or undefined before its first read. The same box until it changes. */
  readonly current: (key: string) => LibraryQueryResult<V> | undefined;
  /** Something in the Library changed: the queries it reaches re-read, now or when shown. */
  readonly change: (change: LibraryChange) => void;
  readonly stats: () => LibraryQueryStats;
}

interface ConsumerState {
  visible: boolean;
  /** The result this consumer was last told of. */
  seen: LibraryQueryResult<unknown> | undefined;
  readonly onChange: () => void;
}

interface Entry<V> {
  readonly key: string;
  readonly reads: LibraryReads;
  readonly consumers: Set<ConsumerState>;
  result: LibraryQueryResult<V> | undefined;
  /** A change reached the query since its last read started. */
  stale: boolean;
  /** The pending re-read shouldn't wait for the throttle (an edit, a screen coming back). */
  urgent: boolean;
  /** The read under way (its number), or null. */
  reading: number | null;
  /** The read under way is for an edit (or a first read, or a return): hidden consumers hear of it. */
  forEdit: boolean;
  /** An edit landed while the read under way was reading: its result is out of date. */
  outdated: boolean;
  /** When the last read started. */
  readAt: number;
  /** The throttle's wait, or null. */
  cancelWait: (() => void) | null;
  /** When the last consumer left (for retention). */
  releasedAt: number;
  /** The retention timer of a result nobody shows, or null. */
  cancelExpiry: (() => void) | null;
}

/**
 * The registry of shared Library queries. It keeps one entry per query key:
 * - consumers of a key share its result and its reads: one read at a time,
 *   later consumers start from the current result;
 * - a change re-reads only the queries whose reads it reaches; an edit at
 *   once, a burst (scan batches, plays) at most once per `throttleMs`;
 * - a query only hidden consumers show doesn't re-read for bursts, and its
 *   hidden consumers aren't told of burst results; it catches up once, at
 *   once, when one is shown again. Edits re-read it even hidden, so no screen
 *   comes back showing a removed item. A first read happens even hidden, so
 *   a warmed screen has its content. Queries in sight read first;
 * - a result an edit made out of date while it was read is dropped, and the
 *   query reads again;
 * - with no consumer left, a current result is kept for `retainMs`, at most
 *   `maxRetained` of them, and dropped as soon as a change reaches it.
 */
export const createLibraryQueries = <V>(options: {
  readonly now: () => number;
  /** Calls [run] in [ms]; returns how to cancel it. */
  readonly schedule: (ms: number, run: () => void) => () => void;
  /** Starts reading query [key]; [settle] must be called once with how it ended. */
  readonly read: (key: string, settle: (outcome: LibraryQueryOutcome<V>) => void) => void;
  /** Query [key] is gone (no consumer, no kept result): what the app holds for it can go. */
  readonly dropped?: (key: string) => void;
  readonly limits?: Partial<LibraryQueryLimits>;
}): LibraryQueries<V> => {
  const { now, schedule, read } = options;
  const limits: LibraryQueryLimits = { ...LIBRARY_QUERY_LIMITS, ...options.limits };
  const entries = new Map<string, Entry<V>>();
  let nextRead = 0;
  const counts = { reads: 0, shared: 0, paused: 0, discarded: 0, evicted: 0 };

  /**
   * Tells [entry]'s consumers of its new result. A hidden one hears of its
   * first result (a warmed tab renders it ahead) and, with [everyone], of an
   * edit's; of a burst's only once it's shown again.
   */
  const tell = (entry: Entry<V>, everyone: boolean): void => {
    for (const consumer of entry.consumers) {
      if (consumer.seen === entry.result) continue;
      if (!consumer.visible && !everyone && consumer.seen !== undefined) continue;
      consumer.seen = entry.result;
      consumer.onChange();
    }
  };

  const inSight = (entry: Entry<V>): boolean => {
    for (const consumer of entry.consumers) if (consumer.visible) return true;
    return false;
  };

  const drop = (entry: Entry<V>): void => {
    entry.cancelWait?.();
    entry.cancelWait = null;
    entry.cancelExpiry?.();
    entry.cancelExpiry = null;
    entries.delete(entry.key);
    options.dropped?.(entry.key);
  };

  /** Drops kept results nobody shows past `maxRetained`, the least recently shown first. */
  const trimRetained = (): void => {
    const retained = [...entries.values()].filter((entry) => entry.consumers.size === 0);
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
    retained.sort((a, b) => a.releasedAt - b.releasedAt);
    for (const entry of retained.slice(0, Math.max(0, retained.length - limits.maxRetained))) {
      drop(entry);
      counts.evicted++;
    }
  };

  /** [entry]'s last consumer left: keep its result a while if it is current, else drop it. */
  const release = (entry: Entry<V>): void => {
    if (entry.result === undefined || entry.stale || entry.reading !== null) {
      drop(entry);
      return;
    }
    entry.cancelWait?.();
    entry.cancelWait = null;
    entry.releasedAt = now();
    entry.cancelExpiry = schedule(limits.retainMs, () => {
      entry.cancelExpiry = null;
      if (entry.consumers.size > 0) return;
      drop(entry);
      counts.evicted++;
    });
    trimRetained();
  };

  /** A change reached [entry]: it re-reads, at once when [edit]. */
  const invalidate = (entry: Entry<V>, edit: boolean): void => {
    entry.stale = true;
    if (edit) {
      entry.urgent = true;
      if (entry.reading !== null) entry.outdated = true;
    }
  };

  const startRead = (entry: Entry<V>): void => {
    const number = nextRead++;
    counts.reads++;
    entry.reading = number;
    entry.forEdit = entry.urgent;
    entry.outdated = false;
    entry.stale = false;
    entry.urgent = false;
    entry.readAt = now();
    read(entry.key, (outcome) => settle(entry, number, outcome));
  };

  const settle = (entry: Entry<V>, number: number, outcome: LibraryQueryOutcome<V>): void => {
    if (entry.reading !== number) return;
    entry.reading = null;
    if (entries.get(entry.key) !== entry) return;
    if (entry.outdated) counts.discarded++;
    else if (outcome.ok) {
      entry.result = { value: outcome.value };
      tell(entry, entry.forEdit);
    }
    plan(entry);
  };

  /** Starts, schedules or leaves the entry's next read, as its state asks. */
  const plan = (entry: Entry<V>): void => {
    if (entry.reading !== null) return;
    if (!entry.stale) return;
    // Paused: bursts wait while only hidden screens show it. Edits and its first read don't.
    if (entry.result !== undefined && !entry.urgent && !inSight(entry)) return;
    const wait =
      entry.urgent || entry.result === undefined ? 0 : entry.readAt + limits.throttleMs - now();
    if (wait > 0) {
      entry.cancelWait ??= schedule(wait, () => {
        entry.cancelWait = null;
        plan(entry);
      });
      return;
    }
    entry.cancelWait?.();
    entry.cancelWait = null;
    startRead(entry);
  };

  return {
    attach: (key, reads, { visible, onChange }) => {
      let entry = entries.get(key);
      if (entry === undefined) {
        entry = {
          key,
          reads,
          consumers: new Set(),
          result: undefined,
          stale: true,
          urgent: true,
          reading: null,
          forEdit: false,
          outdated: false,
          readAt: 0,
          cancelWait: null,
          releasedAt: 0,
          cancelExpiry: null,
        };
        entries.set(key, entry);
      } else {
        if (entry.result !== undefined || entry.reading !== null) counts.shared++;
        // Its first read failed: this screen tries again.
        else entry.stale = true;
        entry.cancelExpiry?.();
        entry.cancelExpiry = null;
      }
      const owner = entry;
      const consumer: ConsumerState = { visible, seen: owner.result, onChange };
      owner.consumers.add(consumer);
      plan(owner);
      return {
        show: () => {
          if (consumer.visible) return;
          consumer.visible = true;
          // Coming back to stale data: read it now, not after a scan's throttle.
          if (owner.stale) owner.urgent = true;
          plan(owner);
          tell(owner, false);
        },
        hide: () => {
          consumer.visible = false;
        },
        refresh: () => {
          invalidate(owner, true);
          plan(owner);
        },
        detach: () => {
          if (!owner.consumers.delete(consumer)) return;
          if (owner.consumers.size === 0 && entries.get(key) === owner) release(owner);
        },
      };
    },
    current: (key) => entries.get(key)?.result,
    change: (change) => {
      const edit = change.burst !== true;
      const hidden: Entry<V>[] = [];
      for (const entry of entries.values()) {
        if (!libraryChangeAffects(entry.reads, change)) continue;
        if (entry.consumers.size === 0) {
          // Nobody shows it: drop it rather than read it for nobody.
          drop(entry);
          counts.evicted++;
          continue;
        }
        invalidate(entry, edit);
        if (inSight(entry)) plan(entry);
        else hidden.push(entry);
      }
      // What's in sight reads first.
      for (const entry of hidden) {
        if (!edit && entry.result !== undefined) counts.paused++;
        plan(entry);
      }
    },
    stats: () => {
      let consumers = 0;
      let retained = 0;
      for (const entry of entries.values()) {
        consumers += entry.consumers.size;
        if (entry.consumers.size === 0) retained++;
      }
      return { entries: entries.size, retained, consumers, ...counts };
    },
  };
};
