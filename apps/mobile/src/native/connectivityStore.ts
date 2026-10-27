import { makeExternalStore, type ExternalStore } from "../lib/externalStore.ts";

/** What Android says of the phone's default network. */
export interface Connectivity {
  /** Android checked the default network reaches the internet. */
  readonly online: boolean;
  /** The default network is mobile data, not Wi-Fi or a cable. */
  readonly onMobileData: boolean;
}

/** The native side's cached answer, and its pushes when the network changes. */
export interface ConnectivitySource {
  readonly read: () => Connectivity;
  readonly subscribe: (listener: (next: Connectivity) => void) => () => void;
}

/** What a check assumes when the native module can't tell: online, on Wi-Fi. */
const UNKNOWN: Connectivity = { online: true, onMobileData: false };

/**
 * The phone's connectivity as a JS store: the first check reads the native
 * cache once, and from then on the store follows the native pushes, so a
 * check never crosses to native again.
 */
export const connectivityStore = (
  source: ConnectivitySource,
): Pick<ExternalStore<Connectivity>, "get" | "subscribe"> => {
  let store: ExternalStore<Connectivity> | null = null;
  const started = (): ExternalStore<Connectivity> => {
    if (store !== null) return store;
    const following = makeExternalStore(UNKNOWN);
    store = following;
    source.subscribe((next) => following.set(next));
    try {
      following.set(source.read());
    } catch {
      // No module to ask: the assumption stands until it pushes a change.
    }
    return following;
  };
  return {
    get: () => started().get(),
    subscribe: (listener) => started().subscribe(listener),
  };
};
