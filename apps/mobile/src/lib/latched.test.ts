import assert from "node:assert/strict";
import test from "node:test";
import { createElement, useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { useLatchedFor } from "./latched.ts";

test("once true for a key it stays true for that key, and a new key starts over", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const seen: boolean[] = [];
  function Page({ id, now }: { id: string; now: boolean }) {
    const latched = useLatchedFor(id, now);
    useLayoutEffect(() => {
      seen.push(latched);
    });
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  try {
    act(() => {
      renderer = create(createElement(Page, { id: "a", now: false }));
    });
    act(() => renderer!.update(createElement(Page, { id: "a", now: true })));
    // Covered (Now Playing over it, a pushed screen): still true for "a".
    act(() => renderer!.update(createElement(Page, { id: "a", now: false })));
    // Another artist opens on the same screen: it waits for its own.
    act(() => renderer!.update(createElement(Page, { id: "b", now: false })));
    act(() => renderer!.update(createElement(Page, { id: "b", now: true })));
    act(() => renderer!.update(createElement(Page, { id: "b", now: false })));
    assert.deepEqual(seen, [false, true, true, false, true, true]);
  } finally {
    act(() => renderer?.unmount());
  }
});
