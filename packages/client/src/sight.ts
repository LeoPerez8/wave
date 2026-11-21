/**
 * Screen sight, free of any UI framework: whether a screen is in sight, put together from
 * the conditions it needs (#722). The phone's `useScreenSight` builds one; the desktop's
 * playlist suggestions follow one too.
 */
/**
 * Whether the screen a component is on is in sight, read and followed without
 * rendering.
 */
export interface ScreenSight {
  readonly visible: () => boolean;
  /** Calls [listener] each time the screen comes into or goes out of sight; returns how to stop. */
  readonly subscribe: (listener: (visible: boolean) => void) => () => void;
}

/** One condition a screen needs to be in sight (focused, not covered, the app in front). */
export interface SightCondition {
  readonly holds: () => boolean;
  /** Calls [listener] with the condition each time it may have changed; returns how to stop. */
  readonly subscribe: (listener: (holds: boolean) => void) => () => void;
}

/** In sight while every one of [conditions] holds. */
export const sightOf = (...conditions: readonly SightCondition[]): ScreenSight => ({
  visible: () => conditions.every((condition) => condition.holds()),
  subscribe: (listener) => {
    const holding = conditions.map((condition) => condition.holds());
    let last = holding.every(Boolean);
    const stops = conditions.map((condition, index) =>
      condition.subscribe((holds) => {
        holding[index] = holds;
        const now = holding.every(Boolean);
        if (now === last) return;
        last = now;
        listener(now);
      }),
    );
    return () => {
      for (const stop of stops) stop();
    };
  },
});
