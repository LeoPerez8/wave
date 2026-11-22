import { useSyncExternalStore } from "react";

import type { Selectable } from "./storeSelector";

const IGNORE = (): (() => void) => () => {};

/**
 * [store]'s value while [following], and [idle] otherwise (#1438). A component
 * that has no use for the value yet (Search with nothing typed) doesn't listen
 * to the store, so its changes don't render it; following again shows the
 * latest value at once. [store] must be stable, and [idle] a constant.
 */
export const useStoreWhile = <A, I>(store: Selectable<A>, following: boolean, idle: I): A | I =>
  useSyncExternalStore<A | I>(
    following ? store.subscribe : IGNORE,
    following ? store.get : () => idle,
  );
