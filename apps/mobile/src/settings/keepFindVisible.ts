import { readKeepFindVisible, storedKeepFindVisible } from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";

/**
 * Keep Find Field Visible (Settings › Layout), off unless the owner turned it
 * on: every Find field stays pinned under its page's header while the list
 * scrolls under it (Core's `readKeepFindVisible`). Synced with the Wave account.
 */
const keepFindVisible = persistedSetting<boolean>({
  key: "settings.keepFindVisible",
  synced: true,
  read: readKeepFindVisible,
  write: storedKeepFindVisible,
});

export const setKeepFindVisible = keepFindVisible.set;

/** Whether the Find fields are pinned; re-renders open lists when it changes. */
export const useKeepFindVisible = keepFindVisible.useValue;
