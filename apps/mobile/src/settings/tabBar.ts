import { parseTabBar, storedTabBar, type TabBar } from "@wave/core";
import { Storage } from "expo-sqlite/kv-store";

import { persistedSetting } from "@/lib/persistedSetting";

/** Where the Shortcut tab setting, which the editable bar replaced, kept its choice. */
const SHORTCUT_TAB_KEY = "settings.shortcutTab";

const sameOrder = (a: TabBar, b: TabBar): boolean =>
  a.length === b.length && a.every((tab, index) => tab === b[index]);

const tabBar = persistedSetting<TabBar>({
  key: "settings.tabBar",
  synced: true,
  // Until the bar is edited, it's the one the old Shortcut tab choice left.
  read: (stored) =>
    parseTabBar(stored, stored === null ? Storage.getItemSync(SHORTCUT_TAB_KEY) : null),
  write: storedTabBar,
  equals: sameOrder,
});

/** The tabs the bar shows, in order (the tab bar's editor arranges them). */
export const getTabBar = tabBar.get;

/** Saves the bar the editor hands back. */
export const setTabBar = tabBar.set;

/** The tabs the bar shows, in order; re-renders when the editor changes them. */
export const useTabBar = tabBar.useValue;
