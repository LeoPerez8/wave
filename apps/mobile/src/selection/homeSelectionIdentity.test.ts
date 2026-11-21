import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, useState } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { loadWithStubs, nativeStubs, stubModule } from "../perf/renderHarness.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const [{ useHomeSelection }] = await loadWithStubs<[typeof import("./useHomeSelection.ts")]>(
  [import.meta.resolve("./useHomeSelection.ts")],
  {
    ...nativeStubs(),
    "@/overlay/back": stubModule(`export const addScreenBackHandler = () => () => {};`),
  },
);

type HomeSelection = ReturnType<typeof useHomeSelection>;

// Home hands one selection to every section; a new object on each Home render
// would redraw all of them, memoized or not (#1423).
test("Home's selection keeps its identity until the selection itself changes", async () => {
  const seen: HomeSelection[] = [];
  const setters: ((update: (tick: number) => number) => void)[] = [];
  function Home() {
    const [, setTick] = useState(0);
    setters.push(setTick);
    seen.push(useHomeSelection());
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  await act(() => {
    renderer = create(createElement(Home));
  });
  try {
    await act(() => setters[0]!((tick) => tick + 1));
    assert.ok(seen.length >= 2);
    assert.equal(seen.at(-1), seen[0], "an unrelated Home render keeps the same selection");
    const item = { kind: "album", item: { id: "a1" } } as never;
    await act(() => seen.at(-1)!.start(item));
    assert.notEqual(seen.at(-1), seen[0], "starting a selection gives sections a new one");
    assert.equal(seen.at(-1)!.selecting, true);
  } finally {
    await act(() => renderer?.unmount());
  }
});

test("Home's sections are memoized, so the stable selection and content reach them unchanged", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("../home/HomeSection.tsx", import.meta.url), "utf8");
  assert.match(source, /export const HomeSection = memo\(HomeSectionShown\)/);
  const content = readFileSync(new URL("../home/homeContent.ts", import.meta.url), "utf8");
  assert.match(content, /useMemo\(\(\) => \(cold === undefined \? read/);
});
