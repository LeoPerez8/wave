/**
 * Screen sight, free of React Native and navigation: what `useScreenSight`
 * (src/lib/screenSight.ts) puts together, and how a screen follows an
 * external store only while it's in sight (#722).
 */
import type { LibraryQueries, LibraryReads } from "@wave/core";
import { useMemo, useSyncExternalStore } from "react";

/**
 * Whether the screen a component is on is in sight, read and followed without
 * rendering.
 */
export interface ScreenSight {
  readonly visible: () => boolean;
  /** Calls [listener] each time the screen comes into or goes out of sight; returns how to stop. */
  readonly subscribe: (listener: (visible: boolean) => void) => () => void;
}

/** One condition a screen needs to be in sight (focused, not covered, the app in front). */
export interface SightCondition {
  readonly holds: () => boolean;
  /** Calls [listener] with the condition each time it may have changed; returns how to stop. */
  readonly subscribe: (listener: (holds: boolean) => void) => () => void;
}

/** In sight while every one of [conditions] holds. */
export const sightOf = (...conditions: readonly SightCondition[]): ScreenSight => ({
  visible: () => conditions.every((condition) => condition.holds()),
  subscribe: (listener) => {
    const holding = conditions.map((condition) => condition.holds());
    let last = holding.every(Boolean);
    const stops = conditions.map((condition, index) =>
      condition.subscribe((holds) => {
        holding[index] = holds;
        const now = holding.every(Boolean);
        if (now === last) return;
        last = now;
        listener(now);
      }),
    );
    return () => {
      for (const stop of stops) stop();
    };
  },
});

/** A store as `useSyncExternalStore` reads it. */
export interface FollowedStore<A> {
  readonly subscribe: (onChange: () => void) => () => void;
  readonly get: () => A;
}

/**
 * [store] as a screen follows it: while [sight] is out, [get] keeps answering
 * what it answered when the screen went out of sight and the store isn't
 * subscribed, so its changes render nothing. Coming back calls `onChange`
 * once if the store moved meanwhile. Make one per subscriber.
 */
export const followInSight = <A>(sight: ScreenSight, store: FollowedStore<A>): FollowedStore<A> => {
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
): (() => void) => {
  const attached = queries.attach(key, reads, {
    visible: sight.visible(),
    onChange,
    onStateChange: onChange,
  });
  const stopWatching = sight.subscribe((visible) => (visible ? attached.show() : attached.hide()));
  return () => {
    stopWatching();
    attached.detach();
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
