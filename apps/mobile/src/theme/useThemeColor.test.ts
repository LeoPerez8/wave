import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createElement, useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

// Uniwind is the native boundary. Keep its values mutable to exercise theme changes.
const boundary = `data:text/javascript,${encodeURIComponent(`
  import { useSyncExternalStore } from ${JSON.stringify(import.meta.resolve("react"))};
  let revision = 0;
  const listeners = new Set();
  export const change = (next) => {
    Object.assign(values, next);
    revision++;
    for (const listener of listeners) listener();
  };
  const subscribe = (listener) => { listeners.add(listener); return () => listeners.delete(listener); };
  export let values = { "--color-accent": "#14b7a6", "--color-fill": 42 };
  export const reads = [];
  export const useCSSVariable = (names) => {
    useSyncExternalStore(subscribe, () => revision);
    reads.push(names);
    return Array.isArray(names) ? names.map(name => values[name]) : values[names];
  };
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return specifier === "uniwind"
      ? { url: boundary, shortCircuit: true }
      : nextResolve(specifier, context);
  },
});
const { useThemeColor } = await import("./useThemeColor.ts");
const native = await import(boundary);
hooks.deregister();

test("reads several native colours together, preserving order and transparent fallbacks", () => {
  let colors: readonly string[] = [];
  function Probe() {
    const current = useThemeColor(["accent", "fill", "tertiary", "accent"]);
    useLayoutEffect(() => {
      colors = current;
    });
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  try {
    native.reads.length = 0;
    act(() => {
      renderer = create(createElement(Probe));
    });
    assert.deepEqual(colors, ["#14b7a6", "transparent", "transparent", "#14b7a6"]);
    assert.deepEqual(native.reads, [
      ["--color-accent", "--color-fill", "--color-tertiary", "--color-accent"],
    ]);
    act(() => native.change({ "--color-accent": "#11695f" }));
    assert.equal(colors[0], "#11695f");
  } finally {
    act(() => renderer?.unmount());
  }
});

test("keeps the scalar API and accepts readonly tuples or an empty batch", () => {
  native.change({ "--color-accent": "#14b7a6" });
  let scalar = "";
  let missing = "";
  let tuple: [string, string] = ["", ""];
  let empty: [] = [];
  function Probe() {
    const currentScalar = useThemeColor("accent");
    const currentMissing = useThemeColor("tertiary");
    const currentTuple: [string, string] = useThemeColor(["accent", "fill"] as const);
    const currentEmpty: [] = useThemeColor([]);
    useLayoutEffect(() => {
      scalar = currentScalar;
      missing = currentMissing;
      tuple = currentTuple;
      empty = currentEmpty;
    });
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  try {
    act(() => {
      renderer = create(createElement(Probe));
    });
    assert.equal(scalar, "#14b7a6");
    assert.equal(missing, "transparent");
    assert.deepEqual(tuple, ["#14b7a6", "transparent"]);
    assert.deepEqual(empty, []);
  } finally {
    act(() => renderer?.unmount());
  }
});
