/**
 * Screen sight, free of React Native and navigation: what `useScreenSight`
 * (src/lib/screenSight.ts) puts together, and how a screen follows an
 * external store only while it's in sight (#722).
 */
import type { LibraryQueries, LibraryQueryTraits, LibraryReads } from "@wave/core";
import { useMemo, useSyncExternalStore } from "react";

import { sightOf, type ScreenSight, type SightCondition } from "@wave/client/sight";

export { sightOf, type ScreenSight, type SightCondition };

/** A store as `useSyncExternalStore` reads it. */
interface FollowedStore<A> {
  readonly subscribe: (onChange: () => void) => () => void;
  readonly get: () => A;
}

/**
 * [store] as a screen follows it: while [sight] is out, [get] keeps answering
 * what it answered when the screen went out of sight and the store isn't
 * subscribed, so its changes render nothing. Coming back calls `onChange`
 * once if the store moved meanwhile. Make one per subscriber.
 */
const followInSight = <A>(sight: ScreenSight, store: FollowedStore<A>): FollowedStore<A> => {
  let held: { readonly value: A } | null = null;
  return {
    get: () => (held === null ? store.get() : held.value),
    subscribe: (onChange) => {
      let stopStore: (() => void) | null = null;
      const follow = (): void => {
        stopStore ??= store.subscribe(onChange);
      };
      const pause = (): void => {
        held ??= { value: store.get() };
        stopStore?.();
        stopStore = null;
      };
      if (sight.visible()) follow();
      else pause();
      const stopSight = sight.subscribe((visible) => {
        if (!visible) {
          pause();
          return;
        }
        const shown = held;
        held = null;
        follow();
        if (shown !== null && !Object.is(shown.value, store.get())) onChange();
      });
      return () => {
        stopSight();
        stopStore?.();
        stopStore = null;
        held = null;
      };
    },
  };
};

/**
 * Attaches the calling screen to shared query [key] (Core's
 * `createLibraryQueries`) and follows [sight]: out of sight it stops re-reading,
 * back in sight it catches up once. Returns how to detach.
 */
export const attachInSight = (
  queries: Pick<LibraryQueries<unknown>, "attach">,
  key: string,
  reads: LibraryReads,
  sight: ScreenSight,
  onChange: () => void,
  traits: LibraryQueryTraits<unknown> = {},
): (() => void) => {
  const attached = queries.attach(key, reads, {
    visible: sight.visible(),
    onChange,
    onStateChange: onChange,
    ...traits,
  });
  const stopWatching = sight.subscribe((visible) => (visible ? attached.show() : attached.hide()));
  return () => {
    stopWatching();
    attached.detach();
  };
};

/**
 * Runs [run] every [ms] while [sight] holds, and once each time the screen
 * comes back into sight; out of sight no timer runs. Returns how to stop.
 */
export const everyWhileInSight = (
  sight: ScreenSight,
  ms: number,
  run: () => void,
): (() => void) => {
  let timer: ReturnType<typeof setInterval> | null = null;
  const start = (): void => {
    timer ??= setInterval(run, ms);
  };
  const pause = (): void => {
    if (timer !== null) clearInterval(timer);
    timer = null;
  };
  if (sight.visible()) start();
  const stopWatching = sight.subscribe((visible) => {
    if (!visible) {
      pause();
      return;
    }
    run();
    start();
  });
  return () => {
    stopWatching();
    pause();
  };
};

/**
 * [subscribe] and [get]'s store as the calling component follows it: through
 * [sight] (`followInSight`), or always when [sight] is null. [subscribe] and
 * [get] must be stable (module functions, or memoized).
 */
export const useStoreInSight = <A>(
  sight: ScreenSight | null,
  subscribe: (onChange: () => void) => () => void,
  get: () => A,
): A => {
  const followed = useMemo(
    () => (sight === null ? { subscribe, get } : followInSight(sight, { subscribe, get })),
    [sight, subscribe, get],
  );
  return useSyncExternalStore(followed.subscribe, followed.get);
};
