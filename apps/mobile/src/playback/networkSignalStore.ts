import {
  followNetworkSignal,
  networkSignal,
  networkSignalAnnouncement,
  networkSignalRecheckMs,
  type Catalogue,
  type NetworkSignal,
  type NetworkSignalTrail,
} from "@wave/core";
import { makeExternalStore, type ExternalStore } from "@wave/client/externalStore";

import type { Connectivity } from "../native/connectivityStore.ts";
import { networkSignalInput, type PlaybackState } from "./playbackStores.ts";

/** How long "Back online" shows under Now Playing's controls. */
export const BACK_ONLINE_MS = 2400;

/** The network signal as the screens show it (Ghost wave, #1498). */
export interface ShownNetworkSignal {
  readonly signal: NetworkSignal;
  /** The song that showed Offline plays again: "Back online", for [BACK_ONLINE_MS]. */
  readonly backOnline: boolean;
}

export interface NetworkSignalDeps {
  readonly playback: Pick<ExternalStore<PlaybackState>, "get" | "subscribe">;
  readonly connectivity: Pick<ExternalStore<Connectivity>, "get" | "subscribe">;
  readonly now: () => number;
  /** Runs [run] in [ms]; the result cancels it. */
  readonly setTimer: (run: () => void, ms: number) => () => void;
  /** TalkBack's announcement as a state begins. */
  readonly announce: (text: string) => void;
  readonly strings?: () => Catalogue;
}

/**
 * Core's `networkSignal` over the playback store and connectivity, looked at
 * again when either changes and when the grace before Slow runs out. It
 * follows them only while something watches it (the mini player, Now Playing),
 * and announces each state as it begins (`networkSignalAnnouncement`).
 */
export const makeNetworkSignalStore = (
  deps: NetworkSignalDeps,
): Pick<ExternalStore<ShownNetworkSignal>, "get" | "subscribe"> => {
  const shown = makeExternalStore<ShownNetworkSignal>({ signal: "playing", backOnline: false });
  let trail: NetworkSignalTrail | null = null;
  let cancelRecheck: (() => void) | null = null;
  let cancelBackOnline: (() => void) | null = null;
  let stops: Array<() => void> = [];

  const endBackOnline = (): void => {
    cancelBackOnline?.();
    cancelBackOnline = null;
  };

  const look = (): void => {
    cancelRecheck?.();
    cancelRecheck = null;
    const state = deps.playback.get();
    const input = networkSignalInput(state, deps.connectivity.get().online, deps.now());
    const signal = networkSignal(input);
    const itemId = state.item?.id ?? null;
    // "Back online" belongs to the song that came back: another song drops it.
    const sameSong = trail === null || trail.itemId === itemId;
    const step = followNetworkSignal(trail, itemId, signal, { paused: !state.playWhenReady });
    trail = step.trail;
    const wait = networkSignalRecheckMs(input);
    if (wait !== null) cancelRecheck = deps.setTimer(look, wait);
    const previous = shown.get();
    let backOnline = previous.backOnline && signal === "playing" && sameSong;
    if (step.backOnline) {
      endBackOnline();
      backOnline = true;
      cancelBackOnline = deps.setTimer(() => {
        cancelBackOnline = null;
        shown.update((now) => ({ ...now, backOnline: false }));
      }, BACK_ONLINE_MS);
    } else if (!backOnline) endBackOnline();
    const said = networkSignalAnnouncement(previous.signal, signal, deps.strings?.());
    if (said !== null) deps.announce(said);
    if (previous.signal !== signal || previous.backOnline !== backOnline) {
      shown.set({ signal, backOnline });
    }
  };

  const start = (): void => {
    stops = [deps.playback.subscribe(look), deps.connectivity.subscribe(look)];
    look();
  };
  const stop = (): void => {
    for (const end of stops) end();
    stops = [];
    cancelRecheck?.();
    cancelRecheck = null;
  };

  return {
    get: shown.get,
    subscribe: (listener) => {
      if (shown.listenerCount() === 0) start();
      // A distinct callback lets two owners subscribe the same listener safely.
      const unsubscribe = shown.subscribe(() => listener());
      let released = false;
      return () => {
        if (released) return;
        released = true;
        unsubscribe();
        if (shown.listenerCount() === 0) stop();
      };
    },
  };
};
