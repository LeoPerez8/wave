import { DEFAULT_GLASS_SETTINGS, readGlassSettings, type GlassSettings } from "@wave/core";
import { Storage } from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

const KEY = "settings.glass";

/** Writes wait until a drag settles, so a slider doesn't hit storage every frame. */
const PERSIST_DELAY_MS = 300;

let current = readGlassSettings(Storage.getItemSync(KEY));
const listeners = new Set<() => void>();
let pending: ReturnType<typeof setTimeout> | undefined;

const persist = () => {
  pending = undefined;
  Storage.setItemSync(KEY, JSON.stringify(current));
};

const publish = (next: GlassSettings) => {
  current = next;
  if (pending !== undefined) clearTimeout(pending);
  pending = setTimeout(persist, PERSIST_DELAY_MS);
  for (const listener of listeners) listener();
};

/** Changes one glass setting; every glass surface follows at once. */
export const setGlassSetting = <K extends keyof GlassSettings>(
  key: K,
  value: GlassSettings[K],
): void => {
  // Read back through Core so the value lands on the slider's range and step.
  const next = readGlassSettings(JSON.stringify({ ...current, [key]: value }));
  if (next[key] === current[key]) return;
  publish(next);
};

/** Puts the glass back as it was before it could be tuned. */
export const resetGlassSettings = (): void => publish(DEFAULT_GLASS_SETTINGS);

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The persisted glass settings; re-renders when Settings changes them. */
export const useGlassSettings = (): GlassSettings => useSyncExternalStore(subscribe, () => current);
