import { persistedSetting } from "@/lib/persistedSetting";

/**
 * Settings › Developer › Portuguese (preview): a Portuguese phone reads Wave
 * in Brazilian Portuguese before it launches for everyone. Kept on this phone
 * and never synced, so it can't turn Portuguese on anywhere else.
 */
const portuguese = persistedSetting<boolean>({
  key: "settings.portuguesePreview",
  synced: false,
  read: (stored) => stored === "on",
  write: (enabled) => (enabled ? "on" : null),
});

export const portuguesePreview = portuguese.get;
export const setPortuguesePreview = portuguese.set;
export const usePortuguesePreview = portuguese.useValue;
export const subscribePortuguesePreview = portuguese.subscribe;
