import type { ReactNode } from "react";
import { useSyncExternalStore } from "react";

import { makeExternalStore } from "@/lib/externalStore";

/**
 * Wave's dialogs and menus: floating glass cards drawn by `OverlayHost` at the
 * app root (not in a `Modal`, which is a separate Android window the glass
 * can't see through). Open one from anywhere, React or not.
 */
export interface OverlayRequest {
  /** What a screen reader calls the card when it takes focus, e.g. "Sleep timer". */
  readonly label: string;
  /** The card's content. `close` fades the card out; call it once a choice is made. */
  readonly render: (close: () => void) => ReactNode;
  /** Runs when Back or a tap outside the card dismisses it (not when content calls `close`). */
  readonly onDismiss?: () => void;
}

export interface OverlayHandle {
  /** Fades the card out. Does nothing once it is closing. */
  readonly close: () => void;
}

export interface OverlayEntry {
  readonly id: number;
  readonly request: OverlayRequest;
  /** Fading out; the host removes it once the animation ends. */
  readonly closing: boolean;
}

/** Open cards, bottom to top. */
const entries = makeExternalStore<readonly OverlayEntry[]>([]);
let nextId = 1;

/** Fades a card out (the host passes this to `render`). */
export const closeOverlay = (id: number): void =>
  entries.update((list) =>
    list.some((entry) => entry.id === id && !entry.closing)
      ? list.map((entry) => (entry.id === id ? { ...entry, closing: true } : entry))
      : list,
  );

/** Shows a card over everything; it stays until closed or dismissed. */
export const openOverlay = (request: OverlayRequest): OverlayHandle => {
  const id = nextId++;
  entries.update((list) => [...list, { id, request, closing: false }]);
  return { close: () => closeOverlay(id) };
};

/**
 * Shows a card that answers with a value: `finish(value)` resolves with it and
 * closes the card, Back or a tap outside resolves with `dismissed`.
 */
export const presentOverlay = <T>(request: {
  readonly label: string;
  readonly render: (finish: (value: T) => void) => ReactNode;
  readonly dismissed: T;
}): Promise<T> =>
  new Promise<T>((resolve) => {
    let settled = false;
    const settle = (value: T): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    const handle = openOverlay({
      label: request.label,
      render: () =>
        request.render((value) => {
          settle(value);
          handle.close();
        }),
      onDismiss: () => settle(request.dismissed),
    });
  });

// For OverlayHost.

export const useOverlayEntries = (): readonly OverlayEntry[] =>
  useSyncExternalStore(entries.subscribe, entries.get);

/** Back or a tap outside: closes the card and tells its opener. */
export const dismissOverlay = (entry: OverlayEntry): void => {
  if (entry.closing) return;
  closeOverlay(entry.id);
  entry.request.onDismiss?.();
};

/** Called by the host once a closing card has faded out. */
export const removeOverlay = (id: number): void =>
  entries.update((list) => list.filter((entry) => entry.id !== id));
