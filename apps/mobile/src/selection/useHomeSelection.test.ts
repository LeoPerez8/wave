import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createElement, useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import type { HomeSelection } from "./useHomeSelection.ts";

// Home hands one selection to every section (#1423): a Home render that changes nothing
// selected must hand them the same one, or every section renders again with it.

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    if (specifier === "@/overlay/back")
      return {
        url: "data:text/javascript,export const addScreenBackHandler = () => () => {};",
        shortCircuit: true,
      };
    if (specifier.startsWith("@/"))
      specifier = new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href;
    if (specifier.startsWith(".") && existsSync(new URL(`${specifier}.ts`, context.parentURL)))
      specifier += ".ts";
    return nextResolve(specifier, context);
  },
});
const { useHomeSelection } = await import("./useHomeSelection.ts");
hooks.deregister();

test("Home's selection keeps its identity across a render that selects nothing", () => {
  const seen: HomeSelection[] = [];
  function Home() {
    const selection = useHomeSelection();
    useLayoutEffect(() => {
      seen.push(selection);
    });
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(createElement(Home));
  });
  act(() => renderer?.update(createElement(Home)));
  assert.equal(seen.length, 2);
  assert.equal(seen[1], seen[0]);
  act(() => renderer?.unmount());
});

test("Home's selection changes when a song is selected", () => {
  const seen: HomeSelection[] = [];
  function Home() {
    const selection = useHomeSelection();
    useLayoutEffect(() => {
      seen.push(selection);
    });
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(createElement(Home));
  });
  const item = seen[0]!.remember({ kind: "track", item: { song: { id: 1 } } } as never);
  act(() => seen[0]!.start(item));
  const last = seen.at(-1)!;
  assert.notEqual(last, seen[0]);
  assert.equal(last.selecting, true);
  act(() => last.end());
  act(() => renderer?.unmount());
});
