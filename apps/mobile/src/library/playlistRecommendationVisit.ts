/** The playlist visit owns renewal, not the footer's position in the scroll viewport. */
import {
  LIBRARY_QUERY_LIMITS,
  libraryChangeAffects,
  type LibraryChange,
  type playlistRecommendationSession,
} from "@wave/core";
import * as Effect from "effect/Effect";
import { createSerialWork } from "../lib/serialWork.ts";

type Session = ReturnType<typeof playlistRecommendationSession>;
export const followPlaylistRecommendations = (
  session: Session,
  options: {
    readonly playlistId: number;
    readonly sight: {
      readonly visible: () => boolean;
      readonly subscribe: (listener: () => void) => () => void;
    };
    readonly start: (signal: AbortSignal) => Promise<void>;
    readonly subscribe: (listener: (change: LibraryChange) => void) => () => void;
    /** Background Library writes share the burst throttle. */
    readonly graphSources?: (listener: () => void) => () => void;
    readonly now?: () => number;
    readonly wait?: (ms: number, signal: AbortSignal) => Promise<void>;
    readonly ignore?: (change: LibraryChange) => boolean;
  },
) => {
  session.resume();
  if (!options.sight.visible()) session.pause();
  const serial = createSerialWork();
  const now = options.now ?? Date.now;
  const wait = options.wait ?? ((ms, signal) => Effect.runPromise(Effect.sleep(ms), { signal }));
  let lastStarted = -Infinity;
  let burst = false;
  let stale = true;
  let disposed = false;
  let cancel: (() => void) | undefined;
  // `cancel` already keeps one request at a time. Each gets its own key, so one
  // made while the previous job is still leaving the queue waits behind it
  // instead of being dropped as a duplicate (which left `cancel` a no-op).
  let requests = 0;
  const request = () => {
    if (disposed || !stale || !options.sight.visible() || cancel !== undefined) return;
    // A failed read keeps its retry line through background writes. An explicit edit,
    // return to the page or Try Again can retry it; a background write mustn't hide the failure.
    if (burst && session.get().error === "load") return;
    cancel = serial.add(`recommendations ${++requests}`, async (signal) => {
      let renewed = false;
      try {
        if (burst)
          await wait(Math.max(0, lastStarted + LIBRARY_QUERY_LIMITS.throttleMs - now()), signal);
        await options.start(signal);
        if (signal.aborted || !options.sight.visible()) return;
        stale = false;
        burst = false;
        lastStarted = now();
        await session.renew({ signal });
        renewed = true;
      } finally {
        // An aborted job may already have a replacement queued; it owns the new cancel.
        if (!signal.aborted) {
          cancel = undefined;
          if (renewed) request();
        }
      }
    });
  };
  const invalidate = (inBurst = false) => {
    burst = inBurst;
    stale = true;
    // Repeated scan/catalog writes used to cancel every read before its timeout,
    // restarting both its song pages and its deadline. Finish the bounded read and
    // catch up once; urgent edits still discard it immediately.
    if (!inBurst) {
      cancel?.();
      cancel = undefined;
    }
    request();
  };
  const stopChange = options.subscribe((change) => {
    if (options.ignore?.(change)) return;
    if (
      libraryChangeAffects(
        { tracks: true, favorites: true, playlists: [options.playlistId] },
        change,
      )
    )
      invalidate(change.burst === true);
  });
  const stopGraphSources = options.graphSources?.(() => invalidate(true));
  const stopSight = options.sight.subscribe(() => {
    if (!options.sight.visible()) {
      if (session.get().pending !== null || session.get().loading) stale = true;
      session.pause();
      if (cancel !== undefined) {
        cancel();
        cancel = undefined;
        stale = true;
      }
    } else {
      burst = false;
      session.resume();
      request();
    }
  });
  request();
  return {
    invalidate,
    dispose: () => {
      disposed = true;
      stopChange();
      stopGraphSources?.();
      stopSight();
      cancel?.();
      serial.dispose();
      session.pause();
    },
  };
};
