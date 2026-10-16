import { createLibraryQueries, type LibraryReads } from "@wave/core";
import type * as Effect from "effect/Effect";
import { useCallback, useContext, useEffect, useRef, useSyncExternalStore } from "react";

import { firstContentShown } from "@/lib/backgroundWork";
import { CoveredByNowPlaying, useScreenSight } from "@/lib/screenSight";
import { registerPerfMeta } from "@/perf/perf";

import { onLibraryChange } from "./libraryChanges";
import type { LibraryStore, LibraryStoreError } from "./LibraryStore";
import { appRuntime } from "./runtime";

/**
 * A Library query that screens share: one read serves every screen showing
 * [key], and only changes reaching [reads] re-read it (Core's
 * `createLibraryQueries`). The same key must always read the same thing:
 * put every parameter in it (`album:12`).
 */
export interface LibraryQuery<A> {
  readonly key: string;
  readonly reads: LibraryReads;
  readonly read: Effect.Effect<A, LibraryStoreError, LibraryStore>;
}

/** Declares a shared Library query. Make it once (a module constant, or `useMemo` over its key). */
export const libraryQuery = <A>(
  key: string,
  reads: LibraryReads,
  read: Effect.Effect<A, LibraryStoreError, LibraryStore>,
): LibraryQuery<A> => ({ key, reads, read });

/**
 * What a bare Effect query (the old `useLibraryQuery(effect, …)` form) follows:
 * every track and folder change, as it followed `libraryVersion`.
 */
const EFFECT_READS: LibraryReads = { tracks: true, folders: true };

type AnyQuery = LibraryQuery<unknown>;
type StoreEffect<A> = Effect.Effect<A, LibraryStoreError, LibraryStore>;

let nextEffectKey = 0;
/** Bare Effects as queries: the same Effect object is the same query. */
const effectQueries = new WeakMap<object, AnyQuery>();

const asQuery = <A>(query: LibraryQuery<A> | StoreEffect<A>): AnyQuery => {
  if ("key" in query && "reads" in query && "read" in query) return query as AnyQuery;
  let known = effectQueries.get(query);
  if (known === undefined) {
    known = libraryQuery(`effect#${nextEffectKey++}`, EFFECT_READS, query as StoreEffect<unknown>);
    effectQueries.set(query, known);
  }
  return known;
};

/** What each key reads, while the registry holds it. */
const definitions = new Map<string, AnyQuery>();
let stopFollowing: (() => void) | null = null;

const registry = createLibraryQueries<unknown>({
  now: Date.now,
  schedule: (ms, run) => {
    const timer = setTimeout(run, ms);
    return () => clearTimeout(timer);
  },
  read: (key, settle) => {
    // Reads are synchronous SQLite under the Effect: start them outside whatever asked
    // (a writer's call, a navigation or Now Playing listener), never inside it.
    setTimeout(() => {
      const definition = definitions.get(key);
      if (definition === undefined) {
        settle({ ok: false });
        return;
      }
      appRuntime.runPromise(definition.read).then(
        (value) => settle({ ok: true, value }),
        // Keep showing the last good result; scan errors surface in the banner.
        () => settle({ ok: false }),
      );
    }, 0);
  },
  dropped: (key) => {
    definitions.delete(key);
    if (definitions.size === 0) {
      stopFollowing?.();
      stopFollowing = null;
    }
  },
});

registerPerfMeta("libraryQueries", () => ({ ...registry.stats() }));

const NONE = (): undefined => undefined;
const idle = () => () => {};

/**
 * Runs a Library query for the calling screen and returns its result, or
 * [initial] until the first one. A null query asks nothing: [initial] stands.
 *
 * - [query]: a shared `LibraryQuery` (preferred), or a bare Effect, which is
 *   one query per Effect object and follows every track and folder change.
 * - Screens showing the same query share its result and its reads.
 * - It re-reads when a Library change reaches its reads: an edit at once,
 *   scan batches at most every 1.5 s. While the screen is out of sight
 *   (another tab, a pushed screen, Now Playing over it) it doesn't re-read;
 *   it catches up once when the screen comes back.
 * - [queryEdits]: changes when something the registry isn't told of changed
 *   what the query reads: it re-reads at once. Prefer declaring the reads.
 */
export const useLibraryQuery = <A>(
  query: LibraryQuery<A> | StoreEffect<A> | null,
  initial: A,
  queryEdits = 0,
): A => {
  const definition = query === null ? null : asQuery(query);
  const sight = useScreenSight();
  const consumer = useRef<ReturnType<typeof registry.attach> | null>(null);

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (definition === null) return idle();
      const { key } = definition;
      definitions.set(key, definition);
      stopFollowing ??= onLibraryChange(registry.change);
      const attached = registry.attach(key, definition.reads, {
        visible: sight.visible(),
        onChange,
      });
      consumer.current = attached;
      const stopWatching = sight.subscribe((visible) =>
        visible ? attached.show() : attached.hide(),
      );
      return () => {
        stopWatching();
        if (consumer.current === attached) consumer.current = null;
        attached.detach();
      };
    },
    [definition, sight],
  );
  const key = definition?.key;
  const current = useSyncExternalStore(
    subscribe,
    key === undefined ? NONE : () => registry.current(key),
  );

  // The first result an app screen in sight shows lets startup work go (src/lib/backgroundWork.ts).
  const coverable = useContext(CoveredByNowPlaying);
  const shown = current !== undefined;
  useEffect(() => {
    if (shown && coverable && sight.visible()) firstContentShown();
  }, [shown, coverable, sight]);

  const lastEdits = useRef(queryEdits);
  useEffect(() => {
    if (queryEdits === lastEdits.current) return;
    lastEdits.current = queryEdits;
    consumer.current?.refresh();
  }, [queryEdits]);

  return current === undefined ? initial : (current.value as A);
};
