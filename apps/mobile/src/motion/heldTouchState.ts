import { createMenuTouchOwnership, type MenuTouchOwnership, type SlidePoint } from "@wave/core";

import { makeExternalStore } from "../lib/externalStore.ts";

/**
 * The finger that long-pressed a `Press` and is still down. Opening a menu
 * doesn't take the touch away from the row, so the row reports where the
 * finger goes until it lifts; the menu listens to slide to choose, and lists
 * stop scrolling meanwhile. Points are in the app window, in dp.
 */
export type HeldTouchEvent =
  { readonly type: "move" | "release"; readonly point: SlidePoint } | { readonly type: "cancel" };

const held = makeExternalStore<SlidePoint | null>(null);
export const subscribeHeldTouch = held.subscribe;
/** Shared with the Mini player's native recognizers and their queued JS callbacks. */
export const menuTouchOwnership = createMenuTouchOwnership();
const listeners = new Set<(event: HeldTouchEvent) => void>();

/** Synchronous notification, before React commits updated gesture props. */
export const observeMenuTouchOwnership = (
  listener: (owner: MenuTouchOwnership) => void,
): (() => void) => {
  const stop = held.subscribe(() => listener(menuTouchOwnership.get()));
  listener(menuTouchOwnership.get());
  return stop;
};

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

export const holdTouch = (point: SlidePoint): void => {
  menuTouchOwnership.claim();
  held.set(point);
};

export const moveHeldTouch = (point: SlidePoint): void => {
  if (held.get() !== null) emit({ type: "move", point });
};

export const releaseHeldTouch = (point: SlidePoint): void => {
  if (held.get() === null) return;
  menuTouchOwnership.release();
  held.set(null);
  emit({ type: "release", point });
};

export const cancelHeldTouch = (): void => {
  if (held.get() === null) return;
  menuTouchOwnership.release();
  held.set(null);
  emit({ type: "cancel" });
};
