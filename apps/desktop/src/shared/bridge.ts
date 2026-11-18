/**
 * The only way from Wave's window to its services. The preload exposes `createBridge`'s
 * object as `window.wave`; main answers each call in `BridgeContract` and nothing else.
 * A call that reads a list returns a `Page`, never the whole list.
 */
import type { LibraryCounts } from "@wave/client/db/counts";

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
}

export type BridgeCall = keyof BridgeContract;

/** A list call that skips paging fails to compile here. */
type PagedLists<T> = {
  readonly [C in keyof T]: T[C] extends { readonly result: readonly unknown[] } ? never : T[C];
};
export const BRIDGE_CALLS = ["library.counts"] as const satisfies readonly BridgeCall[] &
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
}

export const createBridge = (invoke: Invoke): WaveBridge => ({
  library: {
    counts: () => invoke("library.counts"),
  },
});
