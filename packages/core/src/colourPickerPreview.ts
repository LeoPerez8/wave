/**
 * When the colour picker of Settings › Theme recolours the app. Recolouring
 * re-renders every themed view, so a moving finger leaves the app alone: the
 * app takes the colour under it once it rests or lifts.
 */

/** How long a finger rests on the picker before the app takes the colour under it. */
export const COLOUR_PICKER_REST_MS = 200;

export interface ColourPickerPreviewDeps {
  /** Recolours the app with `hex`. */
  readonly apply: (hex: string) => void;
  /** The time in milliseconds. */
  readonly now: () => number;
  /** Calls `done` after `ms`; the returned function cancels it. */
  readonly wait: (ms: number, done: () => void) => () => void;
}

export interface ColourPickerPreview {
  /** The finger moved onto `hex`. */
  readonly drag: (hex: string) => void;
  /** The finger lifted: the app takes the colour under it at once. */
  readonly lift: () => void;
  /** A colour typed or stepped to, not dragged: the app takes it at once. */
  readonly pick: (hex: string) => void;
  /** The picker closed: nothing it had pending recolours the app. */
  readonly stop: () => void;
}

export const createColourPickerPreview = ({
  apply,
  now,
  wait,
}: ColourPickerPreviewDeps): ColourPickerPreview => {
  let latest: string | null = null;
  let movedAt = 0;
  let cancel: (() => void) | null = null;
  let applied: string | null = null;
  let stopped = false;

  const show = (): void => {
    if (stopped || latest === null || latest === applied) return;
    applied = latest;
    apply(latest);
  };

  /** Drops the wait for a rest. */
  const settle = (): void => {
    cancel?.();
    cancel = null;
  };

  const rested = (): void => {
    cancel = null;
    const still = now() - movedAt;
    if (still < COLOUR_PICKER_REST_MS) {
      cancel = wait(COLOUR_PICKER_REST_MS - still, rested);
      return;
    }
    show();
  };

  return {
    drag: (hex) => {
      // Moving without changing the colour (held at the square's edge) is resting.
      if (stopped || hex === latest) return;
      latest = hex;
      movedAt = now();
      cancel ??= wait(COLOUR_PICKER_REST_MS, rested);
    },
    lift: () => {
      settle();
      show();
    },
    pick: (hex) => {
      settle();
      latest = hex;
      show();
    },
    stop: () => {
      stopped = true;
      settle();
    },
  };
};
