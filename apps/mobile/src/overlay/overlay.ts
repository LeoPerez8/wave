import { highlightedOrigin, originOfNewCard } from "@wave/core";
import type { OverlayAlign, OverlayRect } from "@wave/core";
import type { ReactNode } from "react";
import { createContext, useSyncExternalStore } from "react";

import { makeExternalStore } from "@/lib/externalStore";
import { pressedElement, type PressedElement } from "@/motion/pressedRect";
import { traceLongPress } from "@/motion/longPressTrace";
import { cancelHeldTouch } from "@/motion/heldTouchState";

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
  /**
   * Float next to this rect in the window (a menu next to its row: below it,
   * or above when there's no room) instead of centred. See `pressedRect`.
   */
  readonly anchor?: OverlayRect | undefined;
  /** "top" for a card with a text field: it sits near the top, clear of the keyboard. Centred by default. */
  readonly align?: OverlayAlign;
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
  /**
   * The row, tile or button whose press opened it (or the card it follows up
   * on), highlighted while it is open; undefined when no press opened it.
   */
  readonly origin: PressedElement | undefined;
}

/** Open cards, bottom to top. */
const entries = makeExternalStore<readonly OverlayEntry[]>([]);
let nextId = 1;
/** Origins kept by `followUp` across async work, innermost last. */
let held: readonly { readonly origin: PressedElement | undefined }[] = [];
let interactionRevision = 0;

/** Identifies the card consuming a held touch, including while it fades out. */
export const OverlayId = createContext<number | undefined>(undefined);

/** Async measurements must not run choices on dismissed or covered cards. */
export const isOverlayInteractive = (id: number): boolean =>
  entries.get().findLast((entry) => !entry.closing)?.id === id;

/** Covering a card invalidates its old finger, even if the card becomes frontmost again. */
export const captureOverlayTouch = (id: number): (() => boolean) => {
  const revision = interactionRevision;
  return () => revision === interactionRevision && isOverlayInteractive(id);
};

/** What a card opening now is about (see Core `originOfNewCard`). */
const originNow = (): PressedElement | undefined =>
  originOfNewCard({ pressed: pressedElement(), held: held.at(-1)?.origin, cards: entries.get() });

/** Fades a card out (the host passes this to `render`). */
export const closeOverlay = (id: number): void => {
  if (isOverlayInteractive(id)) {
    interactionRevision += 1;
    cancelHeldTouch();
  }
  entries.update((list) =>
    list.some((entry) => entry.id === id && !entry.closing)
      ? list.map((entry) => (entry.id === id ? { ...entry, closing: true } : entry))
      : list,
  );
};

/** Shows a card over everything; it stays until closed or dismissed. */
export const openOverlay = (request: OverlayRequest): OverlayHandle => {
  interactionRevision += 1;
  // A follow-up card starts with no inherited finger. The original native
  // player callbacks remain invalid even though the held touch is cleared.
  if (entries.get().some((entry) => !entry.closing)) cancelHeldTouch();
  const id = nextId++;
  const origin = originNow();
  if (origin?.menuAllowed !== undefined) traceLongPress(origin.key, "overlay-opened", `id=${id}`);
  entries.update((list) => [...list, { id, request, closing: false, origin }]);
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
  readonly align?: OverlayAlign;
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
      align: request.align,
      render: () =>
        request.render((value) => {
          settle(value);
          handle.close();
        }),
      onDismiss: () => settle(request.dismissed),
    });
  });

/**
 * Runs async work that ends in a follow-up card (a name prompt after loading
 * names), keeping what the press or card that started it is about, so the
 * follow-up highlights the same element. Call it from the press or the card's
 * choice, before anything awaits.
 */
export const followUp = <T>(work: () => Promise<T>): Promise<T> => {
  const hold = { origin: originNow() };
  held = [...held, hold];
  const release = (): void => {
    held = held.filter((other) => other !== hold);
  };
  return work().finally(release);
};

/**
 * Whether the `Press` known as `key` is what the frontmost card is about: it
 * reads as selected while its card (or a follow-up) is open.
 */
export const useIsOverlayOrigin = (key: number): boolean =>
  useSyncExternalStore(entries.subscribe, () => highlightedOrigin(entries.get())?.key === key);

/** Consume Back using live state, including while the last card is fading away. */
export const dismissTopOverlay = (): boolean => {
  const list = entries.get();
  const top = list.findLast((entry) => !entry.closing);
  if (top !== undefined) dismissOverlay(top);
  return list.length > 0;
};

// For OverlayHost.

export const useOverlayEntries = (): readonly OverlayEntry[] =>
  useSyncExternalStore(entries.subscribe, entries.get);

/** Back or a tap outside: closes the card and tells its opener. */
export const dismissOverlay = (entry: OverlayEntry): void => {
  if (entry.closing) return;
  closeOverlay(entry.id);
  entry.request.onDismiss?.();
};

/**
 * Dismisses every card the `Press` known as `key` opened (and its follow-ups).
 * The Design preview closes its state's card with it.
 */
export const dismissOverlaysFrom = (key: number): void => {
  for (const entry of entries.get()) {
    if (entry.origin?.key === key) dismissOverlay(entry);
  }
};

/**
 * Dismisses every open card, topmost first, as Back would. Something that
 * replaces what was on screen (a share to Wave, Now Playing sliding away)
 * leaves no card behind.
 */
export const dismissAllOverlays = (): void => {
  // oxlint-disable-next-line unicorn/no-array-reverse -- reverses a fresh array; Hermes lacks toReversed
  for (const entry of [...entries.get()].reverse()) dismissOverlay(entry);
};

/** Called by the host once a closing card has faded out. */
export const removeOverlay = (id: number): void =>
  entries.update((list) => list.filter((entry) => entry.id !== id));
