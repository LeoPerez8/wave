import { persistedSetting } from "@/lib/persistedSetting";

/** Developer visibility stays on this phone and never syncs with the Wave account. */
const developer = persistedSetting<boolean>({
  key: "settings.developerVisible",
  synced: false,
  read: (stored) => stored === "on",
  write: (visible) => (visible ? "on" : null),
});

export const developerSettingsVisible = developer.get;
export const setDeveloperSettingsVisible = developer.set;
export const useDeveloperSettingsVisible = developer.useValue;
