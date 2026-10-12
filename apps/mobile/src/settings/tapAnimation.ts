import { snapSliderValue } from "@wave/core";
import { Storage } from "expo-sqlite/kv-store";
import { useSyncExternalStore } from "react";

/** How long a tap's press animation takes, in milliseconds (0 turns it off). */
export const TAP_ANIMATION = { min: 0, max: 600, step: 20, default: 140 } as const;

const KEY = "settings.tapAnimationMs";

const clamp = (ms: number): number => snapSliderValue(ms, TAP_ANIMATION);

const read = (): number => {
  const stored = Storage.getItemSync(KEY);
  const ms = stored === null ? Number.NaN : Number(stored);
  return Number.isFinite(ms) ? clamp(ms) : TAP_ANIMATION.default;
};

let current = read();
const listeners = new Set<() => void>();

export const setTapAnimationMs = (ms: number): void => {
  const next = clamp(ms);
  if (next === current) return;
  current = next;
  Storage.setItemSync(KEY, String(next));
  for (const listener of listeners) listener();
};

const subscribe = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** The persisted tap animation duration; re-renders when Settings changes it. */
export const useTapAnimationMs = (): number => useSyncExternalStore(subscribe, () => current);
