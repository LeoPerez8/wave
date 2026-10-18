/**
 * Wave's toast: one line on a small glass pill above the mini player, drawn
 * by `ToastHost` at the app root. It goes away on its own (Core's
 * `toastDuration`), or sooner on a tap or a swipe. It can offer one action
 * (Undo) at its end. Show one from anywhere, React or not; a newer one takes
 * the place of the one showing.
 */
import { makeExternalStore } from "../lib/externalStore.ts";

/** What a toast's action button says, and what tapping it does. */
export interface ToastAction {
  readonly label: string;
  readonly run: () => void;
}

export interface Toast {
  readonly id: number;
  readonly text: string;
  readonly action: ToastAction | null;
  /** Sliding away; the host removes it once the animation ends. */
  readonly leaving: boolean;
}

/** The toast showing, or null. */
export const currentToast = makeExternalStore<Toast | null>(null);

let nextId = 1;
/** Resolves the `showToast` of the toast showing. */
let gone: (() => void) | null = null;

/**
 * Shows [text] on a toast, with [action] when given; resolves once it's
 * gone, or another took its place.
 */
export const showToast = (text: string, action: ToastAction | null = null): Promise<void> => {
  gone?.();
  return new Promise((resolve) => {
    gone = resolve;
    currentToast.set({ id: nextId++, text, action, leaving: false });
  });
};

/** Starts the toast [id] sliding away. Does nothing once it's leaving or gone. */
export const dismissToast = (id: number): void =>
  currentToast.update((toast) =>
    toast?.id === id && !toast.leaving ? { ...toast, leaving: true } : toast,
  );

/** Runs the action of the toast [id] and sends it away. Does nothing once it's leaving or gone. */
export const runToastAction = (id: number): void => {
  const toast = currentToast.get();
  if (toast?.id !== id || toast.leaving) return;
  dismissToast(id);
  toast.action?.run();
};

/** Takes the toast [id] off the screen (the host, once it has slid away). */
export const removeToast = (id: number): void => {
  if (currentToast.get()?.id !== id) return;
  currentToast.set(null);
  gone?.();
  gone = null;
};
