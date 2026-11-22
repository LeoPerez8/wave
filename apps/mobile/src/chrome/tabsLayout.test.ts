import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { loadWithStubs, nativeStubs, stubModule } from "../perf/renderHarness.ts";

// The tabs layout follows the route to know the tab showing. A screen pushed
// over the tabs (Settings, an album from the Library) and popped again, or a
// push inside a section tab, leaves the tabs as they were: the navigator and
// what it holds aren't drawn again for it (#1439).

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const harness = {
  pathname: "/",
  listeners: new Set<() => void>(),
  tabsRenders: 0,
  chromeRenders: 0,
};
Object.assign(globalThis, { __tabsLayoutTest: harness });

const go = (pathname: string): void => {
  harness.pathname = pathname;
  for (const listener of harness.listeners) listener();
};

const react = JSON.stringify(import.meta.resolve("react"));
const t = "globalThis.__tabsLayoutTest";
const nothing = (...names: string[]) =>
  stubModule(names.map((name) => `export const ${name} = () => null;`).join("\n"));

const [{ default: TabsLayout }] = await loadWithStubs<[typeof import("../app/(tabs)/_layout.tsx")]>(
  [import.meta.resolve("../app/(tabs)/_layout.tsx")],
  {
    ...nativeStubs(),
    "expo-router": stubModule(
      `import { useSyncExternalStore } from ${react};
       const subscribe = (listener) => {
         ${t}.listeners.add(listener);
         return () => ${t}.listeners.delete(listener);
       };
       export const usePathname = () => useSyncExternalStore(subscribe, () => ${t}.pathname);`,
    ),
    "expo-router/ui": stubModule(
      `export const Tabs = ({ children }) => { ${t}.tabsRenders++; return children; };
       export const TabSlot = () => null, TabList = () => null, TabTrigger = () => null;`,
    ),
    "@/lib/renderCost": stubModule(
      `export const useRenderCost = () => {};
       export const PerfProfiler = ({ children }) => children;`,
    ),
    "@/lib/timingRouter": stubModule(`export const router = { navigate: () => {} };`),
    "@/chrome/chrome": stubModule(
      `export const BACKDROP = { tabs: "tabs" };
       export const ChromeProvider = ({ children }) => children;`,
    ),
    "@/chrome/TabBar": stubModule(
      `export const TabBar = () => { ${t}.chromeRenders++; return null; };`,
    ),
    "@/chrome/tabEntry": stubModule(
      `const entry = { style: {}, enter: () => {} };
       export const useTabEntry = () => entry;`,
    ),
    // As the app keeps them: every tab visited, the same list while it holds the same tabs.
    "@/chrome/tabScreens": stubModule(
      `import { useState } from ${react};
       export const TAB_SCREENS = { detach: false, retain: 3 };
       export const renderTabScreens = () => () => null;
       export const useKeptTabs = (tab) => {
         const [kept, setKept] = useState([]);
         const same = tab === null || kept.includes(tab);
         if (!same) setKept([tab, ...kept]);
         return same ? kept : [tab, ...kept];
       };`,
    ),
    "@/chrome/tabSwitches": stubModule(
      `const tap = () => {};
       export const useTabSwitches = () => tap;`,
    ),
    "@/nowPlaying/sheet": stubModule(`export const openNowPlaying = () => {};`),
    "@/perf/perf": stubModule(`export const useRenderCount = () => {};`),
    "@/playback/MiniPlayer": nothing("MiniPlayer"),
    "@/selection/selection": stubModule(`export const useIsSelecting = () => false;`),
    "@/selection/SelectionChrome": nothing("SelectionChrome"),
    "@/settings/tabBar": stubModule(
      `const bar = ["index", "library", "albums", "search"];
       export const useTabBar = () => bar;`,
    ),
    "@/theme/useThemeColor": stubModule(`export const useThemeColor = () => "#000000";`),
    "@/updates/UpdatePill": nothing("UpdatePill"),
  },
);

const drawn = async () => {
  go("/");
  let renderer: ReactTestRenderer | undefined;
  await act(() => {
    renderer = create(createElement(TabsLayout));
  });
  return { close: () => act(() => renderer!.unmount()) };
};

test("a screen pushed over the tabs and popped again doesn't draw the tabs again", async () => {
  const layout = await drawn();
  try {
    const before = harness.tabsRenders;
    await act(() => go("/settings"));
    await act(() => go("/"));
    await act(() => go("/library/album/3"));
    await act(() => go("/"));
    assert.equal(harness.tabsRenders, before);
  } finally {
    await layout.close();
  }
});

test("a push inside a section tab doesn't draw the tabs again; a tab switch does", async () => {
  const layout = await drawn();
  try {
    await act(() => go("/albums"));
    const before = harness.tabsRenders;
    await act(() => go("/albums/album/3"));
    await act(() => go("/albums"));
    assert.equal(harness.tabsRenders, before);
    await act(() => go("/library"));
    assert.ok(harness.tabsRenders > before, "a new tab showing draws the tabs");
  } finally {
    await layout.close();
  }
});

test("a switch back to a kept tab doesn't draw the tabs' chrome again (#1438)", async () => {
  // expo-router's navigator follows the route itself; the mini player and tab bar around it
  // stay as they were.
  const layout = await drawn();
  try {
    await act(() => go("/library"));
    const before = harness.chromeRenders;
    await act(() => go("/"));
    await act(() => go("/library"));
    assert.equal(harness.chromeRenders, before);
  } finally {
    await layout.close();
  }
});
