import type { OverlayRect } from "./overlay.ts";

/**
 * A state the Design preview opens straight into from a link,
 * `wave://design-preview?state=<name>`, so a screenshot taken over adb shows it
 * every time, without a finger on the phone.
 */
export interface DesignPreviewState {
  /** What the link calls it, e.g. "song-card-open". */
  readonly name: string;
  /** One line on what it shows. */
  readonly shows: string;
}

/**
 * The state a link's `state` query asks for, among [states] (a repeated `state`
 * asks for its first). A missing or unknown name opens none: the Design preview
 * as it always opens.
 */
export const designPreviewState = <S extends DesignPreviewState>(
  states: readonly S[],
  query: string | readonly string[] | undefined,
): S | undefined => {
  const name = typeof query === "string" ? query : query?.[0];
  return states.find((state) => state.name === name);
};

/**
 * Whether [url] links to the Design preview (`wave://design-preview`, with a
 * state or without), so a link that comes in while it is showing opens its
 * state again rather than leaving the screen as it is.
 */
export const isDesignPreviewLink = (url: string): boolean => {
  const path = url
    .replace(/^[a-z][a-z\d+.-]*:\/\//i, "")
    .replace(/[?#].*$/, "")
    .replace(/^\/+|\/+$/g, "");
  return path === "design-preview";
};

/**
 * How far a state's anchor (the row, tile or button it opens its card from)
 * has been measured, waiting for it to sit still on screen.
 */
export interface AnchorWatch {
  /** Where it last measured; undefined when it wasn't laid out or had no size. */
  readonly rect: OverlayRect | undefined;
  /** How many measures in a row it has sat at [rect]. */
  readonly still: number;
  /** How many times it has been measured. */
  readonly measures: number;
}

/** Not measured yet. */
export const ANCHOR_UNMEASURED: AnchorWatch = { rect: undefined, still: 0, measures: 0 };

export interface AnchorWatchOptions {
  /** Measures in a row at the same rect that make it still (its screen has stopped sliding in). */
  readonly stillFor: number;
  /** Measures after which the card opens anyway, so a state never fails to show. */
  readonly giveUpAfter: number;
}

export type AnchorStep =
  | { readonly open: true; readonly rect: OverlayRect | undefined }
  | { readonly open: false; readonly watch: AnchorWatch };

const sameRect = (a: OverlayRect, b: OverlayRect): boolean =>
  a.left === b.left && a.top === b.top && a.right === b.right && a.bottom === b.bottom;

/**
 * After measuring a state's anchor again: open its card at the anchor once it
 * is laid out and sits still (its screen has settled), else measure again.
 * After `giveUpAfter` measures it opens where the anchor last measured, or
 * centred when that was nowhere.
 */
export const watchAnchor = (
  watch: AnchorWatch,
  measured: OverlayRect | undefined,
  { stillFor, giveUpAfter }: AnchorWatchOptions,
): AnchorStep => {
  const still =
    measured === undefined
      ? 0
      : watch.rect !== undefined && sameRect(watch.rect, measured)
        ? watch.still + 1
        : 1;
  const measures = watch.measures + 1;
  if ((measured !== undefined && still >= stillFor) || measures >= giveUpAfter) {
    return { open: true, rect: measured };
  }
  return { open: false, watch: { rect: measured, still, measures } };
};
