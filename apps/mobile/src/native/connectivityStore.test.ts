import assert from "node:assert/strict";
import { test } from "node:test";

import {
  connectivityStore,
  type Connectivity,
  type ConnectivitySource,
} from "./connectivityStore.ts";

/** A native module whose cache starts at [initial]; counts its blocking reads. */
const nativeCache = (initial: Connectivity) => {
  let current = initial;
  const listeners = new Set<(next: Connectivity) => void>();
  const calls = { reads: 0 };
  const source: ConnectivitySource = {
    read: () => {
      calls.reads += 1;
      return current;
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const change = (next: Connectivity) => {
    current = next;
    for (const listener of listeners) listener(next);
  };
  return { source, calls, change };
};

const wifi: Connectivity = { online: true, onMobileData: false };
const offline: Connectivity = { online: false, onMobileData: false };
const mobile: Connectivity = { online: true, onMobileData: true };

test("checks read the store: the native cache is read once, then follows its changes", () => {
  const native = nativeCache(wifi);
  const store = connectivityStore(native.source);
  assert.equal(native.calls.reads, 0);
  assert.deepEqual([store.get(), store.get(), store.get()], [wifi, wifi, wifi]);
  native.change(offline);
  assert.equal(store.get().online, false);
  native.change(mobile);
  assert.deepEqual(store.get(), mobile);
  assert.equal(native.calls.reads, 1);
});

test("a change is told to the store's listeners", () => {
  const native = nativeCache(wifi);
  const store = connectivityStore(native.source);
  const heard: Connectivity[] = [];
  const stop = store.subscribe(() => heard.push(store.get()));
  native.change(offline);
  stop();
  native.change(wifi);
  assert.deepEqual(heard, [offline]);
});

test("without the native module, it's online on Wi-Fi as before, and still hears changes", () => {
  const native = nativeCache(wifi);
  const store = connectivityStore({
    read: () => {
      throw new Error("WaveNative isn't there");
    },
    subscribe: native.source.subscribe,
  });
  assert.deepEqual(store.get(), wifi);
  native.change(offline);
  assert.deepEqual(store.get(), offline);
});
