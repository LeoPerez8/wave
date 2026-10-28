import assert from "node:assert/strict";
import { test } from "node:test";
import { registerHooks } from "node:module";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const callbacks = new Set<() => void>();
const navigation = `data:text/javascript,${encodeURIComponent(`
  import { useEffect } from ${JSON.stringify(import.meta.resolve("react"))};
  const callbacks = globalThis.__discoverFocusCallbacks;
  export const useFocusEffect = callback => useEffect(() => {
    callbacks.add(callback); callback();
    return () => callbacks.delete(callback);
  }, [callback]);
`)}`;
Object.assign(globalThis, { __discoverFocusCallbacks: callbacks });
const hooks = registerHooks({
  resolve(specifier, context, next) {
    return specifier === "expo-router"
      ? { url: navigation, shortCircuit: true }
      : next(specifier, context);
  },
});
const { useDiscoverFocus } = await import("./discoverFocus.ts");
hooks.deregister();

test("Discover registers one focus worker and rerenders do not repeat its work", () => {
  const plays: boolean[] = [];
  const refresh = (played: boolean) => {
    plays.push(played);
  };
  function Discover({ enabled = true, played = true }: { enabled?: boolean; played?: boolean }) {
    useDiscoverFocus(enabled, played, refresh);
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  try {
    act(() => {
      renderer = create(createElement(Discover));
    });
    assert.equal(callbacks.size, 1);
    assert.deepEqual(plays, [true]);
    act(() => renderer!.update(createElement(Discover)));
    assert.deepEqual(plays, [true]);
    act(() => {
      for (const callback of callbacks) callback();
    });
    assert.deepEqual(plays, [true, true], "one catch-up on the next focus");
    act(() => renderer!.update(createElement(Discover, { enabled: false })));
    act(() => {
      for (const callback of callbacks) callback();
    });
    assert.deepEqual(plays, [true, true]);
  } finally {
    act(() => renderer?.unmount());
  }
  assert.equal(callbacks.size, 0);
});
