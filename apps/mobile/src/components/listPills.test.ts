import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const navigation = `data:text/javascript,${encodeURIComponent(
  "export const useIsFocused = () => globalThis.__listPillFocused;",
)}`;
const focusedNow = (focused: boolean) => Object.assign(globalThis, { __listPillFocused: focused });
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "expo-router") return { url: navigation, shortCircuit: true };
    if (specifier === "@/lib/externalStore") {
      return next(import.meta.resolve("../lib/externalStore.ts"), context);
    }
    return next(specifier, context);
  },
});
const { listPillsUp, useListPillOnScreen } = await import("./listPills.ts");
hooks.deregister();

function Pill() {
  useListPillOnScreen();
  return null;
}

test("a list pill counts only while its screen is in front", () => {
  focusedNow(true);
  let renderer: ReactTestRenderer | undefined;
  try {
    act(() => {
      renderer = create(createElement(Pill));
    });
    assert.equal(listPillsUp.get(), 1, "on screen");

    focusedNow(false);
    act(() => renderer!.update(createElement(Pill)));
    assert.equal(listPillsUp.get(), 0, "still mounted, under a pushed screen or a kept tab");

    focusedNow(true);
    act(() => renderer!.update(createElement(Pill)));
    assert.equal(listPillsUp.get(), 1, "back in front");
  } finally {
    act(() => renderer?.unmount());
  }
  assert.equal(listPillsUp.get(), 0, "gone");
});

test("a pill mounted under another screen never counts", () => {
  focusedNow(false);
  let renderer: ReactTestRenderer | undefined;
  try {
    act(() => {
      renderer = create(createElement(Pill));
    });
    assert.equal(listPillsUp.get(), 0);
  } finally {
    act(() => renderer?.unmount());
  }
  assert.equal(listPillsUp.get(), 0);
});
