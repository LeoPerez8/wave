/**
 * Which tab screens stay mounted while hidden, and how a hidden one is kept.
 * A kept tab comes back with its nested route and scroll position as it left
 * them and without being built again; keeping costs memory, so only so many
 * of the latest tabs are kept.
 */
import { MAX_TABS } from "./tabBar.ts";

/**
 * How hidden tab screens are kept. Which is best is measured on the phone
 * (docs/performance/304-warmed-tabs.md), so a bundle can pick any of them
 * (`EXPO_PUBLIC_WAVE_TABS`, read by `parseTabScreens`).
 */
export interface TabScreens {
  /** Take a hidden tab's views out of the window (react-native-screens detaches it). */
  readonly detach: boolean;
  /**
   * A hidden tab keeps its layout instead of `display: none`, so showing it
   * again lays nothing out. Only with `detach`: attached, it would draw.
   */
  readonly keepLayout: boolean;
  /**
   * Freeze a hidden tab's React tree: no renders until it shows again, when
   * the updates it missed render once (#1358, Performance rules 1 and 2). Only
   * with `detach`: react-native-screens freezes only the screens it manages.
   */
  readonly freeze: boolean;
  /**
   * A hidden screen keeps following external stores (playing ids, stars, scan
   * status) and re-renders with them, as before #722. By default it pauses
   * and catches up once when it shows again.
   */
  readonly followHidden: boolean;
  /** The most tabs kept mounted, the shown one included. */
  readonly retain: number;
}

/**
 * expo-router's defaults, every tab on the bar kept (#304); hidden screens
 * pause (#722) and hidden tabs freeze (#1358).
 */
const DEFAULT_TAB_SCREENS: TabScreens = {
  detach: true,
  keepLayout: false,
  freeze: true,
  followHidden: false,
  retain: MAX_TABS,
};

/**
 * The choices [value] names, separated by commas or spaces: `detach` or
 * `attach`, `keep-layout` or `display-none`, `freeze` or `thaw`, `follow` or `pause`,
 * `retain=<n>`. Anything not named, unknown or out of range stays at its default.
 */
export const parseTabScreens = (value: string | undefined): TabScreens => {
  let screens = DEFAULT_TAB_SCREENS;
  for (const token of (value ?? "").split(/[\s,]+/)) {
    const retain = /^retain=(\d+)$/.exec(token)?.[1];
    if (token === "detach" || token === "attach")
      screens = { ...screens, detach: token === "detach" };
    else if (token === "keep-layout" || token === "display-none") {
      screens = { ...screens, keepLayout: token === "keep-layout" };
    } else if (token === "freeze" || token === "thaw")
      screens = { ...screens, freeze: token === "freeze" };
    else if (token === "follow" || token === "pause")
      screens = { ...screens, followHidden: token === "follow" };
    else if (retain !== undefined && Number(retain) >= 1)
      screens = { ...screens, retain: Number(retain) };
  }
  return screens.detach ? screens : { ...screens, keepLayout: false, freeze: false };
};

/** [screens] as `parseTabScreens` reads it, every choice named: for the perf build's metadata. */
export const describeTabScreens = (screens: TabScreens): string =>
  [
    screens.detach ? "detach" : "attach",
    screens.keepLayout ? "keep-layout" : "display-none",
    ...(screens.detach ? [screens.freeze ? "freeze" : "thaw"] : []),
    ...(screens.followHidden ? ["follow"] : []),
    `retain=${screens.retain}`,
  ].join(",");

/**
 * The tabs to keep mounted after [shown] showed: the latest first, at most
 * [limit] of them, none that left the [bar] (the shown one aside). Returns
 * [kept] itself when that changes nothing.
 */
export const keepTabs = <T extends string>(
  kept: readonly T[],
  shown: T | null,
  bar: readonly T[],
  limit: number,
): readonly T[] => {
  const hidden = kept.filter((tab) => tab !== shown && bar.includes(tab));
  const next = [...(shown === null ? [] : [shown]), ...hidden].slice(0, Math.max(1, limit));
  return next.length === kept.length && next.every((tab, i) => tab === kept[i]) ? kept : next;
};

/**
 * The tabs to keep mounted once [tab] is built ahead of its first visit (#1438): after the
 * [kept] ones, so it is the next to go, while it is on the [bar] and fits under [limit].
 * Returns [kept] itself when that changes nothing.
 */
export const warmTab = <T extends string>(
  kept: readonly T[],
  tab: T,
  bar: readonly T[],
  limit: number,
): readonly T[] =>
  kept.includes(tab) || !bar.includes(tab) || kept.length >= limit ? kept : [...kept, tab];

/**
 * [next] for the tab navigator, or [shown] itself when it holds the same tabs: which tabs are
 * kept matters to it, not their order, so a switch between kept tabs draws nothing new (#1438).
 */
export const sameKeptTabs = <T extends string>(
  shown: readonly T[],
  next: readonly T[],
): readonly T[] =>
  next.length === shown.length && next.every((tab) => shown.includes(tab)) ? shown : next;
