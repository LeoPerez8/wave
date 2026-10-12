import { type LibrarySectionSlug, parseShortcutTab } from "@wave/core";
import { Storage } from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

const KEY = "settings.shortcutTab";

let current = parseShortcutTab(Storage.getItemSync(KEY));
const listeners = new Set<() => void>();

/** Picks the Library section shown as a shortcut tab, or none (null). */
export const setShortcutTab = (section: LibrarySectionSlug | null): void => {
  if (section === current) return;
  current = section;
  if (section === null) Storage.removeItemSync(KEY);
  else Storage.setItemSync(KEY, section);
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The persisted shortcut tab (null for None); re-renders when Settings changes it. */
export const useShortcutTab = (): LibrarySectionSlug | null =>
  useSyncExternalStore(subscribe, () => current);
