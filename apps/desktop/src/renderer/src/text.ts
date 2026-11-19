import { catalogueOf, displayTag } from "@wave/core";
import { useSyncExternalStore } from "react";
import type { LanguageView } from "../../shared/language.ts";

// Live imports keep event handlers and screens on main's resolved language.
// App subscribes once and re-renders its children without remounting the player or navigation.
export let language: LanguageView["language"] = "en";
export let text = catalogueOf(language, "desktop");
export let labels = text.desktopLayout;
export const albumName = (value: string) => displayTag(value, "album", language);
export const artistName = (value: string) => displayTag(value, "artist", language);
export const tagTitle = (value: string, kind: string) =>
  kind === "album" || kind === "albums"
    ? albumName(value)
    : kind === "artist" || kind === "artists"
      ? artistName(value)
      : value;
let view: LanguageView = { choice: "system", language };
const listeners = new Set<() => void>();
export const applyLanguage = (next: LanguageView) => {
  document.documentElement.lang = next.language;
  if (next.choice === view.choice && next.language === view.language) return;
  view = next;
  language = next.language;
  text = catalogueOf(language, "desktop");
  labels = text.desktopLayout;
  for (const listener of listeners) listener();
};
const subscribe = (listener: () => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};
/** The language main resolved; App reads it again on its poll and re-renders on a change. */
export const useLanguage = () => useSyncExternalStore(subscribe, () => view);
