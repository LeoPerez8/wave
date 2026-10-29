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

/**
 * Whether a hold that went down at [start] still counts with the finger at
 * [point] (window dp): a finger that drifts more than 10 dp no longer
 * long-presses the row, so the sample's fill stops there too.
 */
export const longPressHoldLasts = (start: SlidePoint, point: SlidePoint): boolean =>
  Math.hypot(point.x - start.x, point.y - start.y) <= HOLD_DRIFT;
