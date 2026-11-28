import {
  describeTabScreens,
  keepTabs,
  parseTabScreens,
  sameKeptTabs,
  TAB_PATH,
  warmTab,
  type TabBar,
  type TabBarTab,
} from "@wave/core";
import type { TabSlot } from "expo-router/ui";
import {
  memo,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type ComponentProps,
  type ReactNode,
} from "react";
import { StyleSheet } from "react-native";
import { Screen } from "react-native-screens";

import { RenderCost } from "@/lib/renderCost";
import { router } from "@/lib/timingRouter";
import { PageGradientScope } from "@/pageGradient/PageGradient";
import { PERF_ENABLED, perfMark, registerPerfMeta } from "@/perf/perf";
import { useThemeColor } from "@/theme/useThemeColor";

/**
 * How hidden tabs are kept (#304). By default: taken out of the window and hidden with
 * `display: none`, not frozen (#1535: showing a frozen tab again cost each switch's first
 * frame). A hidden tab still renders little: its stores pause (`useSightedStore`) and catch up
 * once when it shows, and `TabContent` keeps the navigator's renders out of it (#1534). A bundle
 * built with `EXPO_PUBLIC_WAVE_TABS` (e.g. `keep-layout`, `attach`, `freeze`, `retain=3`) picks
 * another, for the comparison in docs/performance/1535-tabs-mode.md.
 * `perf/memoryGuards.test.ts` keeps the default.
 */
export const TAB_SCREENS = parseTabScreens(process.env.EXPO_PUBLIC_WAVE_TABS);

registerPerfMeta("tabs", () => ({ screens: describeTabScreens(TAB_SCREENS) }), true);

/**
 * Every stack's screen options: no header, the theme's background, and a
 * screen under a push frozen (#1423), so a list or Home under a pushed album renders nothing
 * until it shows again. Hidden tabs aren't frozen since #1535; screens under a push still are,
 * since pops weren't measured there. `thaw-stacks` bundles leave them live.
 * `perf/memoryGuards.test.ts` keeps every stack on these.
 */
export const useStackScreenOptions = () => {
  const background = useThemeColor("background");
  return useMemo(
    () => ({
      headerShown: false,
      contentStyle: { backgroundColor: background },
      freezeOnBlur: TAB_SCREENS.freezeStacks,
    }),
    [background],
  );
};

type RenderTab = NonNullable<ComponentProps<typeof TabSlot>["renderFn"]>;

const TAB_NAMES: ReadonlySet<string> = new Set(Object.keys(TAB_PATH));
const isTab = (name: string): name is TabBarTab => TAB_NAMES.has(name);

let warmed: readonly TabBarTab[] = [];
const warmedListeners = new Set<() => void>();
const subscribeWarmed = (listener: () => void) => {
  warmedListeners.add(listener);
  return () => warmedListeners.delete(listener);
};
const readWarmed = () => warmed;

/**
 * Builds [tab] hidden before its first visit, when it's on the bar and the kept tabs have room,
 * so its first tap shows a kept tab (#1438). Started in idle time (`afterFirstSettled`).
 * expo-router's tab navigator holds only visited tabs' routes, so the tab's route is preloaded
 * too (`router.prefetch`, applied in a transition); `renderTabScreens` then builds it hidden.
 */
export const warmTabScreen = (tab: TabBarTab): void => {
  if (warmed.includes(tab)) return;
  warmed = [...warmed, tab];
  for (const listener of warmedListeners) listener();
  router.prefetch(TAB_PATH[tab]);
};

/**
 * The tabs kept mounted while hidden: the latest ones on the [bar], as many as
 * `TAB_SCREENS.retain`, and those warmed before a visit (`warmTabScreen`). A tab past that is
 * unmounted and built again on its next visit. The list keeps its identity while it holds the
 * same tabs (`sameKeptTabs`), so a switch between kept tabs doesn't draw the navigator for it.
 */
export function useKeptTabs(tab: TabBarTab | null, bar: TabBar): readonly TabBarTab[] {
  const warm = useSyncExternalStore(subscribeWarmed, readWarmed);
  const [state, setState] = useState<{
    kept: readonly TabBarTab[];
    shown: readonly TabBarTab[];
    warm: readonly TabBarTab[];
  }>({ kept: [], shown: [], warm: [] });
  let kept = keepTabs(state.kept, tab, bar, TAB_SCREENS.retain);
  // A warm request counts once: a warmed tab that later leaves isn't brought back.
  if (warm !== state.warm)
    for (const next of warm)
      if (!state.warm.includes(next)) kept = warmTab(kept, next, bar, TAB_SCREENS.retain);
  const shown = sameKeptTabs(state.shown, kept);
  // Adjusting state while rendering: React renders again before committing.
  if (kept !== state.kept || shown !== state.shown || warm !== state.warm)
    setState({ kept, shown, warm });
  return shown;
}

/**
 * Perf builds: marks `tab.commit` when React has committed the tab showing,
 * with whether it was built for it (`first`) or kept (`warm`).
 */
function TabCommitMark({
  name,
  focused,
  children,
}: {
  name: string;
  focused: boolean;
  children: ReactNode;
}) {
  const mounted = useRef(false);
  useLayoutEffect(() => {
    if (focused) perfMark("tab.commit", `${name} ${mounted.current ? "warm" : "first"}`);
    mounted.current = true;
  }, [focused, name]);
  return children;
}

type TabDescriptor = Parameters<RenderTab>[0];

let childStateKey: symbol | undefined;
/**
 * The nested navigator's state a tab's route carries. react-navigation keeps a route's object
 * while its key, name and params hold, and hangs the nested state on it under a private symbol
 * (`CHILD_STATE`), so a push inside a tab changes this and not the route.
 */
const childStateOf = (route: TabDescriptor["route"]): unknown => {
  childStateKey ??= Object.getOwnPropertySymbols(route).find(
    (key) => key.description === "CHILD_STATE",
  );
  return childStateKey === undefined
    ? (route as { state?: unknown }).state
    : (route as unknown as Record<symbol, unknown>)[childStateKey];
};

const sameOptions = (a: object, b: object): boolean => {
  if (a === b) return true;
  const keys = Object.keys(a);
  if (keys.length !== Object.keys(b).length) return false;
  return keys.every((key) => Object.hasOwn(b, key) && Object.is(a[key as never], b[key as never]));
};

type TabContentProps = { name: string; descriptor: TabDescriptor; childState: unknown };

/**
 * A kept tab's content, rendered again only when its route, nested state, navigation or
 * options changed (#1534). expo-router's `TabSlot` renders on every navigation and each
 * tab's `descriptor.render()` returns new elements, so without this a switch rendered every
 * kept tab whole: the tab left once more before its freeze lands (react-native-screens'
 * `DelayedFreeze`) and the tab shown as it unfroze. The tab's own state and stores still
 * render what changed in it.
 */
const TabContent = memo(
  function TabContent({ name, descriptor }: TabContentProps) {
    return (
      <PageGradientScope>
        <RenderCost name={`tab:${name}`}>{descriptor.render()}</RenderCost>
      </PageGradientScope>
    );
  },
  (previous, next) =>
    previous.name === next.name &&
    previous.childState === next.childState &&
    previous.descriptor.route === next.descriptor.route &&
    previous.descriptor.navigation === next.descriptor.navigation &&
    sameOptions(previous.descriptor.options, next.descriptor.options),
);

/**
 * Renders the tab screens for `TabSlot` as expo-router's default does, with
 * `TAB_SCREENS`' choices: a tab not [kept] isn't rendered while hidden (a kept
 * one is, even before its first visit), and a comparison bundle's hidden tab can freeze or keep
 * its layout. Each tab has its page-top gradient's scope
 * (`PageGradientScope`), and its content renders only when its route or options change
 * (`TabContent`), so a switch renders neither the tab left nor the tab shown. Perf builds
 * mark each tab's commit and layout (`tab.commit`, `tab.layout`).
 */
export const renderTabScreens =
  (kept: readonly string[]): RenderTab =>
  (descriptor, { isFocused, loaded }) => {
    const name = descriptor.route.name;
    const { lazy = true } = descriptor.options;
    // A kept tab renders hidden even before its first visit: a warmed one (`warmTabScreen`).
    if (!isFocused && (isTab(name) ? !kept.includes(name) : lazy && !loaded)) return null;
    const look = TAB_SCREENS.keepLayout
      ? [styles.laidOut, isFocused ? styles.front : styles.back]
      : [styles.screen, isFocused ? styles.focused : styles.unfocused];
    const content = (
      <TabContent name={name} descriptor={descriptor} childState={childStateOf(descriptor.route)} />
    );
    return (
      <Screen
        key={descriptor.route.key}
        enabled={TAB_SCREENS.detach}
        activityState={isFocused ? 2 : 0}
        freezeOnBlur={TAB_SCREENS.freeze}
        style={look}
        onLayout={
          PERF_ENABLED
            ? () => {
                if (isFocused) perfMark("tab.layout", name);
              }
            : undefined
        }
      >
        {PERF_ENABLED ? (
          <TabCommitMark name={name} focused={isFocused}>
            {content}
          </TabCommitMark>
        ) : (
          content
        )}
      </Screen>
    );
  };

const styles = StyleSheet.create({
  // expo-router's own (TabSlot's defaultTabsSlotRender).
  screen: { flex: 1, position: "relative", height: "100%" },
  focused: { zIndex: 1, display: "flex", flexShrink: 0, flexGrow: 1 },
  unfocused: { zIndex: -1, display: "none", flexShrink: 1, flexGrow: 0 },
  // Kept layout: every tab fills the slot, shown or not, so a switch lays nothing out.
  laidOut: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0 },
  front: { zIndex: 1 },
  back: { zIndex: -1 },
});
