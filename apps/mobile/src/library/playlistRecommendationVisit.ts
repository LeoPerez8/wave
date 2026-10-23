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
  let running = false;
  let cancel: (() => void) | undefined;
  const request = () => {
    if (disposed || !stale || !options.sight.visible() || cancel !== undefined) return;
    cancel = serial.add("recommendations", async (signal) => {
      try {
        if (burst)
          await wait(Math.max(0, lastStarted + LIBRARY_QUERY_LIMITS.throttleMs - now()), signal);
        await options.start(signal);
        if (signal.aborted || !options.sight.visible()) return;
        stale = false;
        burst = false;
        lastStarted = now();
        running = true;
        await session.renew({ signal });
      } finally {
        running = false;
        // An aborted job may already have a replacement queued; it owns the new cancel.
        if (!signal.aborted) cancel = undefined;
      }
    });
  };
  const invalidate = (inBurst = false) => {
    burst = inBurst;
    stale = true;
    if (running || !inBurst) {
      cancel?.();
      cancel = undefined;
    }
    request();
  };
  const stopChange = options.subscribe((change) => {
    if (options.ignore?.(change)) return;
    if (
      libraryChangeAffects(
        { tracks: true, favorites: true, plays: true, playlists: [options.playlistId] },
        change,
      )
    )
      invalidate(change.burst === true);
  });
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
      stopSight();
      cancel?.();
      serial.dispose();
      session.pause();
    },
  };
};
