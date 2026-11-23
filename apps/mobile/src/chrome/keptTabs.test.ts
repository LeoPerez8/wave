import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { loadWithStubs, nativeStubs, stubModule } from "../perf/renderHarness.ts";

// The tabs kept mounted while hidden, as the tab navigator gets them. A switch
// between kept tabs hands it the same list, so the navigator and its chrome
// aren't drawn for the list; a tab warmed in idle time (Search, #1438) is built
// hidden before its first tap, so that tap shows a kept tab.

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const preloaded: string[] = [];
Object.assign(globalThis, { __keptTabsTest: { preloaded } });

const [{ useKeptTabs, warmTabScreen }] = await loadWithStubs<[typeof import("./tabScreens.tsx")]>(
  [import.meta.resolve("./tabScreens.tsx")],
  {
    ...nativeStubs(),
    "react-native-screens": stubModule(`export const Screen = ({ children }) => children;`),
    "@/lib/renderCost": stubModule(`export const RenderCost = ({ children }) => children;`),
    "@/pageGradient/PageGradient": stubModule(
      `export const PageGradientScope = ({ children }) => children;`,
    ),
    "@/perf/perf": stubModule(
      `export const PERF_ENABLED = false;
       export const perfMark = () => {};
       export const registerPerfMeta = () => {};`,
    ),
    "@/theme/useThemeColor": stubModule(`export const useThemeColor = () => "#000000";`),
    "@/lib/timingRouter": stubModule(
      `export const router = { prefetch: (href) => globalThis.__keptTabsTest.preloaded.push(href) };`,
    ),
  },
);

type Tab = Parameters<typeof useKeptTabs>[0];
const BAR = ["index", "library", "albums", "search"] as const;

const shown = async () => {
  const lists: (readonly string[])[] = [];
  function Probe({ tab, bar }: { tab: Tab; bar: Parameters<typeof useKeptTabs>[1] }) {
    lists.push(useKeptTabs(tab, bar));
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  const show = (tab: Tab, bar: Parameters<typeof useKeptTabs>[1] = BAR) =>
    act(() => {
      if (renderer) renderer.update(createElement(Probe, { tab, bar }));
      else renderer = create(createElement(Probe, { tab, bar }));
    });
  return { lists, show, close: () => act(() => renderer!.unmount()) };
};

test("switching between kept tabs hands the navigator the same list", async () => {
  const tabs = await shown();
  try {
    await tabs.show("index");
    await tabs.show("library");
    const kept = tabs.lists.at(-1);
    assert.deepEqual([...kept!].sort(), ["index", "library"]);
    await tabs.show("index");
    await tabs.show("library");
    assert.equal(tabs.lists.at(-1), kept);
  } finally {
    await tabs.close();
  }
});

test("a tab warmed before its first tap is kept, built hidden", async () => {
  const tabs = await shown();
  try {
    await tabs.show("index");
    await act(() => warmTabScreen("search"));
    assert.deepEqual([...tabs.lists.at(-1)!].sort(), ["index", "search"]);
    // Its first tap then shows a kept tab: the list doesn't change for it.
    const kept = tabs.lists.at(-1);
    await tabs.show("search");
    assert.equal(tabs.lists.at(-1), kept);
  } finally {
    await tabs.close();
  }
});

test("warming a tab preloads its route, once: the tab navigator lists only visited tabs", async () => {
  // expo-router's Tabs keeps only visited routes in its state, so a kept tab that was never
  // visited has no route to render until it's preloaded.
  warmTabScreen("albums");
  warmTabScreen("albums");
  assert.deepEqual(
    preloaded.filter((href) => href === "/albums"),
    ["/albums"],
  );
});

test("a tab off the bar isn't warmed", async () => {
  const tabs = await shown();
  try {
    await tabs.show("index", ["index", "library"]);
    await act(() => warmTabScreen("search"));
    assert.deepEqual(tabs.lists.at(-1), ["index"]);
  } finally {
    await tabs.close();
  }
});
