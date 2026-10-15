import type { SlidePoint } from "@wave/core";
import { useSyncExternalStore } from "react";

import { makeExternalStore } from "@/lib/externalStore";

/**
 * The finger that long-pressed a `Press` and is still down. Opening a menu
 * doesn't take the touch away from the row, so the row reports where the
 * finger goes until it lifts; the menu listens to slide to choose, and lists
 * stop scrolling meanwhile. Points are in the app window, in dp.
 */
export type HeldTouchEvent =
  { readonly type: "move" | "release"; readonly point: SlidePoint } | { readonly type: "cancel" };

const held = makeExternalStore<SlidePoint | null>(null);
const listeners = new Set<(event: HeldTouchEvent) => void>();

const emit = (event: HeldTouchEvent): void => {
  for (const listener of listeners) listener(event);
};

/** Where the held finger was when its long-press fired, or null when no finger is held. */
export const heldTouchStart = (): SlidePoint | null => held.get();

/** Follows the held finger until it lifts or the touch is cancelled. Returns the unsubscribe. */
export const onHeldTouch = (listener: (event: HeldTouchEvent) => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

// For Press.

export const holdTouch = (point: SlidePoint): void => held.set(point);

export const moveHeldTouch = (point: SlidePoint): void => {
  if (held.get() !== null) emit({ type: "move", point });
};

export const releaseHeldTouch = (point: SlidePoint): void => {
  if (held.get() === null) return;
  held.set(null);
  emit({ type: "release", point });
};

export const cancelHeldTouch = (): void => {
  if (held.get() === null) return;
  held.set(null);
  emit({ type: "cancel" });
};

/**
 * False while a long-pressed finger is held: pass it as a list's
 * `scrollEnabled`, so sliding onto a menu entry doesn't scroll the list
 * underneath (and take the touch away from the menu).
 */
export const useListScrollable = (): boolean =>
  useSyncExternalStore(held.subscribe, () => held.get() === null);
