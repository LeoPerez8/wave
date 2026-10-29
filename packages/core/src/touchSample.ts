/**
 * Settings › Appearance › Touch's sample (docs/spec.md, "Visual design",
 * Long-press delay): the sample song row to hold. A fill sweeps across it
 * over the delay, then a sample menu opens whose entries only close it.
 */

import { ITEM_ACTION_LABELS } from "./itemActions.ts";
import { menuLayout, type PlayCard } from "./menuLayout.ts";
import type { SlidePoint } from "./slideToChoose.ts";

/** One entry of the sample menu's list, labelled as the real menu's. */
export interface SampleMenuEntry {
  readonly action: "addToPlaylist";
  readonly label: string;
}

const SAMPLE_ENTRIES = [
  { action: "playNext", label: ITEM_ACTION_LABELS.playNext },
  { action: "addToQueue", label: ITEM_ACTION_LABELS.addToQueue },
  { action: "addToPlaylist", label: ITEM_ACTION_LABELS.addToPlaylist },
] as const;

/**
 * The sample menu, laid out as a song's long-press menu is: Play Next and
 * Add to Queue as cards, then Add to Playlist in its list.
 */
export const LONG_PRESS_SAMPLE_MENU: {
  readonly cards: readonly PlayCard[];
  readonly list: readonly SampleMenuEntry[];
} = (() => {
  const { cards, list } = menuLayout("track", SAMPLE_ENTRIES);
  return {
    cards,
    list: list.filter((entry): entry is SampleMenuEntry => entry.action === "addToPlaylist"),
  };
})();

/** One sweep of the fill across the sample row, from its start edge to its end. */
export interface LongPressFill {
  readonly durationMs: number;
}

/**
 * The fill that sweeps across the sample row: over [delayMs], the current
 * long-press delay, so it reaches the end as the menu opens (or, after the
 * finger leaves the slider, shows the new delay once). None under reduce
 * motion: the menu still opens after the delay.
 */
export const longPressFill = ({
  delayMs,
  reduceMotion,
}: {
  readonly delayMs: number;
  readonly reduceMotion: boolean;
}): LongPressFill | null => (reduceMotion ? null : { durationMs: delayMs });

/** How far a held finger may drift before React Native calls its long-press off (Pressability's). */
const HOLD_DRIFT = 10;

/** Whether a hold that went down at [start] still counts with the finger at [point] (window dp). */
const holdLasts = (start: SlidePoint, point: SlidePoint): boolean =>
  Math.hypot(point.x - start.x, point.y - start.y) <= HOLD_DRIFT;

/** A finger on the screen during a touch event (window dp), by its identifier. */
export interface SampleTouch {
  readonly id: string | number;
  readonly x: number;
  readonly y: number;
}

/** A touch event the sample row sees, with React Native's touch lists. */
export interface SampleTouchEvent {
  readonly kind: "start" | "move" | "end" | "cancel";
  /** Every finger still on the screen after the event (`touches`). */
  readonly touches: readonly SampleTouch[];
  /** The fingers the event is about (`changedTouches`). */
  readonly changed: readonly SampleTouch[];
}

/** The finger holding the sample row, and where it went down. */
export interface HeldFinger {
  readonly id: string | number;
  readonly start: SlidePoint;
}

/** The hold after a touch event, and what the fill does: sweep from 0, fade out, or carry on. */
export interface LongPressHoldStep {
  readonly hold: HeldFinger | null;
  readonly fill: "start" | "stop" | "keep";
}

/**
 * Follows the finger holding the sample row through a touch event. A hold
 * starts when a lone finger goes down, and only that finger counts: Android
 * sends every finger of a gesture to the first one's target, so a second
 * finger anywhere neither restarts the fill nor ends it. The hold ends when
 * its finger lifts or is cancelled, or drifts more than 10 dp from where it
 * went down (when the row's long-press is called off too).
 */
export const longPressHoldStep = (
  hold: HeldFinger | null,
  event: SampleTouchEvent,
): LongPressHoldStep => {
  const keep = { hold, fill: "keep" } as const;
  const stop = { hold: null, fill: "stop" } as const;
  if (event.kind === "start") {
    const [finger] = event.touches;
    if (hold !== null || event.touches.length !== 1 || finger === undefined) return keep;
    return { hold: { id: finger.id, start: { x: finger.x, y: finger.y } }, fill: "start" };
  }
  if (hold === null) return keep;
  const own = (touch: SampleTouch): boolean => touch.id === hold.id;
  if (event.kind === "move") {
    const finger = event.touches.find(own) ?? event.changed.find(own);
    return finger === undefined || holdLasts(hold.start, finger) ? keep : stop;
  }
  return event.changed.some(own) || !event.touches.some(own) ? stop : keep;
};
