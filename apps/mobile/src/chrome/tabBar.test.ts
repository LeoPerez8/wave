import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { loadWithStubs, nativeStubs, stubModule } from "../perf/renderHarness.ts";

// expo-router's tab triggers read the navigation state, so every tab on the
// bar renders on every navigation. A tab switch changes the look of two tabs,
// the one left and the one shown; only those are drawn again (#1439).

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const harness = {
  focused: "index",
  /** Bumped on every navigation, as expo-router's navigation state changes. */
  version: 0,
  listeners: new Set<() => void>(),
  drawn: [] as string[],
  presses: new Map<string, (event: unknown) => void>(),
  triggered: [] as string[],
};
Object.assign(globalThis, { __tabBarTest: harness });

const navigate = (focused: string): void => {
  harness.focused = focused;
  harness.version++;
  for (const listener of harness.listeners) listener();
};

const react = JSON.stringify(import.meta.resolve("react"));
const t = "globalThis.__tabBarTest";
const BAR = ["index", "library", "albums", "search"];

const [{ TabBar }] = await loadWithStubs<[typeof import("./TabBar.tsx")]>(
  [import.meta.resolve("./TabBar.tsx")],
  {
    ...nativeStubs(),
    "expo-router/ui": stubModule(
      `import { useSyncExternalStore } from ${react};
       const subscribe = (listener) => {
         ${t}.listeners.add(listener);
         return () => ${t}.listeners.delete(listener);
       };
       export const useTabTrigger = ({ name }) => {
         const version = useSyncExternalStore(subscribe, () => ${t}.version);
         return {
           triggerProps: {
             isFocused: ${t}.focused === name,
             onPress: () => ${t}.triggered.push("press " + name + " " + version),
           },
           switchTab: (to) => ${t}.triggered.push("switch " + to + " " + version),
         };
       };`,
    ),
    "react-native-safe-area-context": stubModule(
      `const insets = { top: 0, bottom: 0, left: 0, right: 0 };
       export const useSafeAreaInsets = () => insets;`,
    ),
    "@/lib/renderCost": stubModule(`export const useRenderCost = () => {};`),
    "@/catalog/grid": stubModule(`export const grid = { margin: 16 };`),
    "@/glass/Glass": stubModule(`export const Glass = () => null;`),
    "@/localisation/localisation": stubModule(
      `const localisation = { strings: { tabBar: { edit: "Edit", editHint: "Hint" } } };
       export const useLocalisation = () => localisation;`,
    ),
    // Records each tab drawn, by its label, and its latest tap handler.
    "@/motion/Press": stubModule(
      `export const Press = (props) => {
         ${t}.drawn.push(props.accessibilityLabel);
         ${t}.presses.set(props.accessibilityLabel, props.onPress);
         return props.children;
       };`,
    ),
    "@/perf/perf": stubModule(`export const useRenderCount = () => {};`),
    "@/search/focusRequest": stubModule(`export const requestSearchFocus = () => {};`),
    "@/settings/tabBar": stubModule(
      `const bar = ${JSON.stringify(BAR)};
       export const useTabBar = () => bar;`,
    ),
    "@/theme/useThemeColor": stubModule(`export const useThemeColor = (name) => name;`),
    "./chrome": stubModule(
      `export const BACKDROP = { tabs: "tabs" };
       export const chrome = { tabBar: 64, gap: 8 };`,
    ),
    "./onFloatingChrome": stubModule(`export const OnFloatingChrome = ({ children }) => children;`),
    "./TabBarEditor": stubModule(`export const openTabBarEditor = () => {};`),
    "./tabs": stubModule(`export const tabLook = (name) => ({ label: name, icon: "Icon" });`),
  },
);

const taps: string[] = [];
const onTabTap = (
  to: string,
  trigger: { switchTab: (to: string, o: object) => void; press: () => void },
) => {
  taps.push(to);
  trigger.switchTab(to, {});
  trigger.press();
};

const drawn = async () => {
  navigate("index");
  let renderer: ReactTestRenderer | undefined;
  await act(() => {
    renderer = create(createElement(TabBar, { onTabTap: onTabTap as never }));
  });
  return { close: () => act(() => renderer!.unmount()) };
};

test("a tab switch draws again only the tab left and the tab shown", async () => {
  const bar = await drawn();
  try {
    assert.deepEqual(harness.drawn.toSorted(), BAR.toSorted());
    harness.drawn.length = 0;
    await act(() => navigate("library"));
    assert.deepEqual(harness.drawn.toSorted(), ["index", "library"]);
    harness.drawn.length = 0;
    await act(() => navigate("search"));
    assert.deepEqual(harness.drawn.toSorted(), ["library", "search"]);
    harness.drawn.length = 0;
    // A navigation that keeps the tab (a push over the tabs) draws none.
    await act(() => navigate("search"));
    assert.deepEqual(harness.drawn, []);
  } finally {
    await bar.close();
  }
});

test("a tab not drawn again still taps with its trigger as it is now", async () => {
  const bar = await drawn();
  try {
    await act(() => navigate("library"));
    await act(() => navigate("search"));
    harness.triggered.length = 0;
    taps.length = 0;
    // Albums was last drawn at the first navigation; its trigger has moved on since.
    await act(() => harness.presses.get("albums")!({}));
    assert.deepEqual(taps, ["albums"]);
    assert.deepEqual(harness.triggered, [
      `switch albums ${harness.version}`,
      `press albums ${harness.version}`,
    ]);
  } finally {
    await bar.close();
  }
});
