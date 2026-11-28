import assert from "node:assert/strict";
import { test } from "node:test";
import { CHILD_STATE, useRouteCache } from "expo-router/build/react-navigation/core/useRouteCache";
import { createElement, useState, type ReactNode } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { loadWithStubs, nativeStubs, stubModule } from "../perf/renderHarness.ts";

// A tab switch hands every kept tab to the tab renderer again: expo-router's `TabSlot` renders
// on each navigation and calls each tab's `descriptor.render()`, which returns new elements,
// and in a bundle that freezes hidden tabs, react-native-screens lets the tab being left render
// once more before it freezes (`DelayedFreeze`). A kept tab whose route, nested state and options
// are as they were isn't rendered for it, shown or hidden; one whose nested route or options
// changed is (#1534).

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const harness = { screens: [] as string[], freezes: [] as string[] };
Object.assign(globalThis, { __tabRendersTest: harness });

const [{ renderTabScreens }] = await loadWithStubs<[typeof import("./tabScreens.tsx")]>(
  [import.meta.resolve("./tabScreens.tsx")],
  {
    ...nativeStubs(),
    // As react-native-screens' screen: it renders on each of its parent's renders and hands its
    // children on, and a screen being hidden renders once more, then freezes (`DelayedFreeze`,
    // react-freeze's suspender): it keeps its tree and renders nothing until it shows again.
    "react-native-screens": stubModule(
      `import { createElement, Suspense, useEffect, useState } from ${JSON.stringify(import.meta.resolve("react"))};
       const never = { then() {} };
       const Suspender = ({ freeze, children }) => {
         if (freeze) throw never;
         return children;
       };
       export const Screen = ({ activityState, freezeOnBlur, children }) => {
         const [frozen, setFrozen] = useState(false);
         const freeze = freezeOnBlur && activityState === 0;
         useEffect(() => {
           const id = setTimeout(() => setFrozen(freeze), 0);
           return () => clearTimeout(id);
         }, [freeze]);
         return createElement(Suspense, { fallback: null },
           createElement(Suspender, { freeze: freeze && frozen }, children));
       };`,
    ),
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
    "@/lib/timingRouter": stubModule(`export const router = { prefetch: () => {} };`),
  },
);

type NestedState = { readonly index: number; readonly routes: readonly { name: string }[] };
type TabRoute = {
  readonly key: string;
  readonly name: string;
  readonly params?: Readonly<Record<string, string>>;
  readonly state?: NestedState;
};
type NavigatorState = { readonly index: number; readonly routes: readonly TabRoute[] };

/** A tab's screen: counts its renders. */
function TabScreen({ name, nested }: { name: string; nested: NestedState | undefined }) {
  harness.screens.push(name);
  return createElement("screen", { name, depth: nested?.routes.length ?? 1 });
}

/**
 * expo-router's headless tabs as they render: on every navigation the descriptors are built
 * anew, each with fresh options and a `render()` returning fresh elements, while each route
 * keeps its object (and navigation its helpers) while it holds the same key, name and params.
 */
function TabsNavigator({
  state,
  options,
  renderFn,
}: {
  state: NavigatorState;
  options: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
  renderFn: ReturnType<typeof renderTabScreens>;
}) {
  const [navigation] = useState(() => new Map<string, object>());
  const [loaded] = useState(() => new Set<string>());
  const focused = state.routes[state.index]!;
  loaded.add(focused.key);
  // expo-router's own route cache (its copy of react-navigation's): each route keeps its object
  // while key, name and params hold, and carries its nested state under `CHILD_STATE`. A rename
  // or a change there fails these tests rather than every push inside a kept tab.
  const routes = useRouteCache(state.routes as never);
  const children: ReactNode[] = state.routes.map((route, index) => {
    const nested = route.state;
    const proxy = routes[index]!;
    if (!navigation.has(route.key)) navigation.set(route.key, {});
    const element = createElement(TabScreen, { name: route.name, nested });
    const descriptor = {
      route: proxy,
      navigation: navigation.get(route.key)!,
      options: { ...options[route.name] },
      render: () => element,
    };
    return createElement(
      "slot",
      { key: route.key },
      renderFn(descriptor as never, {
        index,
        isFocused: state.index === index,
        loaded: loaded.has(route.key),
        detachInactiveScreens: true,
      }),
    );
  });
  return createElement("tabs", null, children);
}

const KEPT = ["index", "library", "albums"] as const;
const route = (name: string, extra: Partial<TabRoute> = {}): TabRoute => ({
  key: `${name}-key`,
  name,
  ...extra,
});
const ROUTES: readonly TabRoute[] = KEPT.map((name) => route(name));

const mount = async () => {
  const renderFn = renderTabScreens(KEPT);
  let renderer: ReactTestRenderer | undefined;
  let options: Readonly<Record<string, Readonly<Record<string, unknown>>>> = {};
  let state: NavigatorState = { index: 0, routes: ROUTES };
  const draw = async () => {
    const element = createElement(TabsNavigator, { state, options, renderFn });
    await act(async () => {
      if (renderer) renderer.update(element);
      else renderer = create(element);
    });
    // Lets a hidden screen's freeze, a timer later, settle.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
  };
  await draw();
  return {
    show: async (name: string) => {
      state = { ...state, index: state.routes.findIndex((each) => each.name === name) };
      await draw();
    },
    change: async (name: string, next: Partial<TabRoute>) => {
      state = {
        ...state,
        routes: state.routes.map((each) => (each.name === name ? { ...each, ...next } : each)),
      };
      await draw();
    },
    setOptions: async (name: string, next: Readonly<Record<string, unknown>>) => {
      options = { ...options, [name]: next };
      await draw();
    },
    close: () => act(() => renderer!.unmount()),
  };
};

const rendersDuring = async (step: () => Promise<void>): Promise<string[]> => {
  harness.screens.length = 0;
  await step();
  return [...harness.screens];
};

test("expo-router's route cache still hangs a tab's nested state where tab screens read it", () => {
  assert.equal(typeof CHILD_STATE, "symbol");
});

test("a switch between kept tabs renders neither the tab left nor the tab shown", async () => {
  const tabs = await mount();
  try {
    // Every kept tab is built once, hidden or shown.
    await tabs.show("library");
    assert.deepEqual(await rendersDuring(() => tabs.show("index")), []);
    assert.deepEqual(await rendersDuring(() => tabs.show("library")), []);
    assert.deepEqual(await rendersDuring(() => tabs.show("albums")), []);
    assert.deepEqual(await rendersDuring(() => tabs.show("index")), []);
  } finally {
    await tabs.close();
  }
});

test("a tab whose nested route changed renders, and only that tab", async () => {
  const tabs = await mount();
  try {
    await tabs.show("library");
    const pushed: NestedState = { index: 1, routes: [{ name: "index" }, { name: "album/[id]" }] };
    assert.deepEqual(await rendersDuring(() => tabs.change("library", { state: pushed })), [
      "library",
    ]);
    // Shown again with its pushed screen: nothing renders for the switch.
    await tabs.show("index");
    assert.deepEqual(await rendersDuring(() => tabs.show("library")), []);
  } finally {
    await tabs.close();
  }
});

test("a tab whose params or options changed while hidden renders once, not again when it shows", async () => {
  const tabs = await mount();
  try {
    // Hidden, not frozen by default (#1535): it renders once as they change, and showing it
    // renders nothing. A comparison bundle's frozen tab renders once when it shows instead.
    assert.deepEqual(
      await rendersDuring(() => tabs.change("albums", { params: { sort: "year" } })),
      ["albums"],
    );
    assert.deepEqual(await rendersDuring(() => tabs.show("albums")), []);
    assert.deepEqual(await rendersDuring(() => tabs.setOptions("library", { title: "Library" })), [
      "library",
    ]);
    assert.deepEqual(await rendersDuring(() => tabs.show("library")), []);
    // The same options again, in a new object as each navigation makes them: no render.
    assert.deepEqual(
      await rendersDuring(() => tabs.setOptions("library", { title: "Library" })),
      [],
    );
    assert.deepEqual(await rendersDuring(() => tabs.show("index")), []);
  } finally {
    await tabs.close();
  }
});

test("a re-tap that pops a tab back to its root renders that tab, and only it", async () => {
  const tabs = await mount();
  try {
    await tabs.show("library");
    const pushed: NestedState = { index: 1, routes: [{ name: "index" }, { name: "album/[id]" }] };
    await tabs.change("library", { state: pushed });
    // The trigger's press (`tabPress`) pops the tab's stack to its root while it shows.
    const root: NestedState = { index: 0, routes: [{ name: "index" }] };
    assert.deepEqual(await rendersDuring(() => tabs.change("library", { state: root })), [
      "library",
    ]);
  } finally {
    await tabs.close();
  }
});
