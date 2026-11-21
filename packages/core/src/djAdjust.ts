/**
 * DJ's Adjust sheet (docs/spec.md, DJ, Adjust): the option groups it draws
 * and the sheet's own limits.
 */
import { en, type Catalogue } from "./catalogueEn.ts";
import {
  DJ_DISCOVERIES,
  DJ_VARIETIES,
  djNewMusicShare,
  type DjDiscovery,
  type DjSettings,
  type DjVariety,
} from "./djSettings.ts";
import { resolveSkipSwipe } from "./swipe.ts";

/** One option of a group: its label, whether it's the chosen one, and the choices a tap on it makes. */
export interface DjAdjustOption {
  readonly label: string;
  readonly selected: boolean;
  readonly settings: DjSettings;
}

/** An option group of the sheet: a radio group with its name, three options and the chosen one's note. */
export interface DjAdjustGroup {
  readonly key: "variety" | "discovery";
  readonly name: string;
  readonly options: readonly DjAdjustOption[];
  readonly note: string;
}

/**
 * Adjust's option groups over [settings]: Artist variety, then Music
 * discovery, each with its three steps in order (the one [settings] has
 * chosen marked) and the note that says what the chosen one does.
 */
export const djAdjustGroups = (
  settings: DjSettings,
  strings: Catalogue = en,
): readonly DjAdjustGroup[] => [
  {
    key: "variety",
    name: strings.dj.artistVariety,
    options: DJ_VARIETIES.map((variety: DjVariety) => ({
      label: strings.dj.varietySteps[variety],
      selected: settings.variety === variety,
      settings: { ...settings, variety },
    })),
    note: strings.dj.varietyNotes[settings.variety],
  },
  {
    key: "discovery",
    name: strings.dj.musicDiscovery,
    options: DJ_DISCOVERIES.map((discovery: DjDiscovery) => ({
      label: strings.dj.discoverySteps[discovery],
      selected: settings.discovery === discovery,
      settings: { ...settings, discovery },
    })),
    note: strings.dj.discoveryNote(djNewMusicShare(settings) * 100),
  },
];

/** The sheet's tallest, as a share of the screen; its content scrolls past it. */
const MAX_SHARE = 0.85;

/** The room kept between the sheet and the status bar, and under it, in dp (a cell each). */
const CLEAR = 8;

/**
 * The tallest the Adjust sheet may grow on a [window] this tall, with the
 * system bars' [top] and [bottom] insets, in dp: about 85% of the screen, and
 * never closer than a cell to the status bar.
 */
export const djAdjustSheetHeight = ({
  window,
  top,
  bottom,
}: {
  readonly window: number;
  readonly top: number;
  readonly bottom: number;
}): number => Math.max(0, Math.min(window * MAX_SHARE, window - top - bottom - CLEAR * 2));

/** How a drag on the sheet's handle ended. */
export interface DjAdjustSheetSwipe {
  /** Distance dragged, in dp; positive is down. */
  readonly translationY: number;
  /** Speed when the finger lifted, in dp/s; positive is down. */
  readonly velocityY: number;
  /** Height of the sheet, in dp. */
  readonly height: number;
}

/**
 * Whether a finished drag on the handle closes the sheet; otherwise it
 * settles back. Down, with the mini player's thresholds (a third of the
 * sheet, or a flick), and a flick back up cancels it.
 */
export const djAdjustSheetSwipeCloses = ({
  translationY,
  velocityY,
  height,
}: DjAdjustSheetSwipe): boolean =>
  // Down is "previous" on the mini player's axis, where positive is right.
  resolveSkipSwipe({ translationX: translationY, velocityX: velocityY, width: height }) ===
  "previous";
