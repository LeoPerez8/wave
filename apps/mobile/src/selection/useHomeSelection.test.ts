import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createElement, Fragment, useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import type { ActionItems } from "../playback/actionTargets.ts";
import type { MixedItem } from "../playback/mixedItems.ts";
import type { HomeSelection } from "./useHomeSelection.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    // Android Back is the only native boundary needed by the selection hook.
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
const { useHomeSelection, useHomeTiles } = await import("./useHomeSelection.ts");
const { endSelection, selectAllInList, useSelectedTarget } = await import("./selection.ts");
hooks.deregister();

const playlist = (id: number, name: string): MixedItem =>
  ({ kind: "playlist", item: { id, name } }) as unknown as MixedItem;

test("Home's selection takes the tiles Home shows now, each as last drawn", () => {
  let selection: HomeSelection;
  function Row({ items, home }: { items: readonly MixedItem[]; home: HomeSelection }) {
    useHomeTiles(home, items);
    return null;
  }
  function Home({ rows }: { rows: readonly (readonly MixedItem[])[] }) {
    const home = useHomeSelection();
    useLayoutEffect(() => {
      selection = home;
    });
    return createElement(
      Fragment,
      null,
      // oxlint-disable-next-line react/no-array-index-key -- a test row stays in its place
      rows.map((items, place) => createElement(Row, { key: place, items, home })),
    );
  }
  let selected: ActionItems | null = null;
  function Chrome() {
    const current = useSelectedTarget();
    useLayoutEffect(() => {
      selected = current;
    });
    return null;
  }
  const page = (rows: readonly (readonly MixedItem[])[]) =>
    createElement(Fragment, null, createElement(Home, { rows }), createElement(Chrome));
  const first = playlist(1, "First");
  const refreshedAway = playlist(2, "Refreshed away");
  const renamed = playlist(1, "First, renamed");
  const fresh = playlist(3, "Fresh");
  const gone = playlist(4, "In a row that goes");
  let renderer: ReactTestRenderer | undefined;
  try {
    act(() => {
      renderer = create(page([[first, refreshedAway], [gone]]));
    });
    act(() => selection.start(first));
    // A refresh redraws the first row; the second row leaves Home.
    act(() => renderer!.update(page([[renamed, fresh]])));
    act(() => selectAllInList());
    assert.deepEqual(selected, { kind: "mixed", items: [renamed, fresh], readOnAction: true });
    assert.equal((selected as ActionItems & { items: readonly MixedItem[] }).items[0], renamed);
  } finally {
    act(() => renderer?.unmount());
    act(() => endSelection());
  }
});

// Home hands one selection to every section (#1423): a Home render that changes nothing
// selected must hand them the same one, or every section renders again with it.
test("Home's selection keeps its identity across a render that selects nothing", () => {
  const seen: HomeSelection[] = [];
  function Home() {
    const home = useHomeSelection();
    useLayoutEffect(() => {
      seen.push(home);
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

test("Home's selection changes when a tile is selected", () => {
  const seen: HomeSelection[] = [];
  function Home() {
    const home = useHomeSelection();
    useLayoutEffect(() => {
      seen.push(home);
    });
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  try {
    act(() => {
      renderer = create(createElement(Home));
    });
    act(() => seen[0]!.start(playlist(1, "First")));
    const last = seen.at(-1)!;
    assert.notEqual(last, seen[0]);
    assert.equal(last.selecting, true);
  } finally {
    act(() => renderer?.unmount());
    act(() => endSelection());
  }
});
