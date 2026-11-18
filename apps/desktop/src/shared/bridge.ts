/**
 * The only way from Wave's window to its services. The preload exposes `createBridge`'s
 * object as `window.wave`; main answers each call in `BridgeContract` and nothing else.
 * A call that reads a list returns a `Page`, never the whole list.
 */
import type { LibraryCounts } from "@wave/client/db/counts";
import type { PlaybackStatus } from "./playback.ts";

/** One window of a list, as a list call returns it. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly offset: number;
  /** Rows in the whole list. */
  readonly total: number;
}

/** Each call's arguments and result. Arguments reach main as untrusted data. */
export interface BridgeContract {
  readonly "library.counts": { readonly args: readonly []; readonly result: LibraryCounts };
  /** Opens an audio file by its absolute path, paused at its start. */
  readonly "player.load": { readonly args: readonly [path: string]; readonly result: PlaybackStatus };
  readonly "player.play": { readonly args: readonly []; readonly result: PlaybackStatus };
  readonly "player.pause": { readonly args: readonly []; readonly result: PlaybackStatus };
  readonly "player.seek": {
    readonly args: readonly [positionMs: number];
    readonly result: PlaybackStatus;
  };
  readonly "player.status": { readonly args: readonly []; readonly result: PlaybackStatus };
}

export type BridgeCall = keyof BridgeContract;

/** A list call that skips paging fails to compile here. */
type PagedLists<T> = {
  readonly [C in keyof T]: T[C] extends { readonly result: readonly unknown[] } ? never : T[C];
};
export const BRIDGE_CALLS = [
  "library.counts",
  "player.load",
  "player.play",
  "player.pause",
  "player.seek",
  "player.status",
] as const satisfies readonly BridgeCall[] &
  (BridgeContract extends PagedLists<BridgeContract> ? unknown : never);

export type Invoke = <C extends BridgeCall>(
  call: C,
  ...args: BridgeContract[C]["args"]
) => Promise<BridgeContract[C]["result"]>;

/** `window.wave`. */
export interface WaveBridge {
  readonly library: {
    readonly counts: () => Promise<LibraryCounts>;
  };
  /** One song at a time; each call answers with the engine's status after it. */
  readonly player: {
    readonly load: (path: string) => Promise<PlaybackStatus>;
    readonly play: () => Promise<PlaybackStatus>;
    readonly pause: () => Promise<PlaybackStatus>;
    readonly seek: (positionMs: number) => Promise<PlaybackStatus>;
    readonly status: () => Promise<PlaybackStatus>;
  };
}

export const createBridge = (invoke: Invoke): WaveBridge => ({
  library: {
    counts: () => invoke("library.counts"),
  },
  player: {
    load: (path) => invoke("player.load", path),
    play: () => invoke("player.play"),
    pause: () => invoke("player.pause"),
    seek: (positionMs) => invoke("player.seek", positionMs),
    status: () => invoke("player.status"),
  },
});
