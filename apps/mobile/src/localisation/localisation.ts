import { catalogueOf, resolveAppLanguage, type AppLanguage, type Catalogue } from "@wave/core";
import {
  createContext,
  createElement,
  useContext,
  useSyncExternalStore,
  type ReactNode,
} from "react";

import { phoneLanguages } from "@/native/waveNative";
import { portuguesePreview, subscribePortuguesePreview } from "@/settings/portuguesePreview";

/** The language Wave reads in and its text (Core's catalogue). */
export interface Localisation {
  readonly language: AppLanguage;
  readonly strings: Catalogue;
}

/** The phone's languages, read once (Android's per-app language, else the system's). */
let phone: readonly string[] | null = null;
let current: Localisation | null = null;

/**
 * The language Wave reads in now and its text, for code outside React
 * (Effect services, notifications, toasts raised from services): the value
 * `useLocalisation` gives screens.
 */
export const currentLocalisation = (): Localisation => {
  phone ??= phoneLanguages();
  const language = resolveAppLanguage(phone, { portugueseEnabled: portuguesePreview() });
  if (current?.language !== language) current = { language, strings: catalogueOf(language) };
  return current;
};

/** Calls [listener] when the language may have changed; gives the function that stops it. */
export const subscribeLocalisation = (listener: () => void): (() => void) =>
  subscribePortuguesePreview(listener);

const LocalisationContext = createContext<Localisation | null>(null);

/** Gives the screens inside it the language and its text, and re-renders them when it changes. */
export function LocalisationProvider({ children }: { children?: ReactNode }) {
  const value = useSyncExternalStore(subscribeLocalisation, currentLocalisation);
  return createElement(LocalisationContext.Provider, { value }, children);
}

/**
 * The language Wave reads in and its text (`strings.tabs.index`), from
 * `LocalisationProvider`. Outside one, the current value, without following changes.
 */
export const useLocalisation = (): Localisation =>
  useContext(LocalisationContext) ?? currentLocalisation();
