import { createLibraryQueries, type LibraryReads } from "@wave/core";
import type * as Effect from "effect/Effect";
import { useCallback, useContext, useEffect, useSyncExternalStore } from "react";

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

type AnyQuery = LibraryQuery<unknown>;

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
 * - Screens showing the same query share its result and its reads.
 * - It re-reads when a Library change reaches its reads: an edit at once,
 *   scan batches at most every 1.5 s. While the screen is out of sight
 *   (another tab, a pushed screen, Now Playing over it) it doesn't re-read;
 *   it catches up once when the screen comes back.
 */
export const useLibraryQuery = <A>(query: LibraryQuery<A> | null, initial: A): A => {
  const definition: AnyQuery | null = query;
  const sight = useScreenSight();

  const subscribe = useCallback(
    (onChange: () => void) => {
      if (definition === null) return idle();
      const { key } = definition;
      definitions.set(key, definition);
      stopFollowing ??= onLibraryChange(registry.change);
      const attached = registry.attach(key, definition.reads, {
        visible: sight.visible(),
        onChange,
        onStateChange: onChange,
      });
      const stopWatching = sight.subscribe((visible) =>
        visible ? attached.show() : attached.hide(),
      );
      return () => {
        stopWatching();
        attached.detach();
      };
    },
    [definition, sight],
  );
  const key = definition?.key;
  const snapshot = useSyncExternalStore(
    subscribe,
    key === undefined ? NONE : () => registry.current(key) ?? registry.state(key),
  );
  const current = typeof snapshot === "string" ? undefined : snapshot;

  // The first result an app screen in sight shows lets startup work go (src/lib/backgroundWork.ts).
  const coverable = useContext(CoveredByNowPlaying);
  const shown = current !== undefined;
  useEffect(() => {
    if (shown && coverable && sight.visible()) firstContentShown();
  }, [shown, coverable, sight]);

  return current === undefined ? initial : (current.value as A);
};

/** Readiness of a main screen query that initially returns an empty-list placeholder. */
export const libraryQueryHasContent = (key: string): boolean => registry.current(key) !== undefined;

/** First-read feedback, read alongside the owning useLibraryQuery subscription. */
export const libraryQueryState = (key: string) => registry.state(key);

/** Explicit recovery for just this failed first read. Existing content stays on screen. */
export const retryLibraryQuery = (key: string): void => registry.retry(key);
