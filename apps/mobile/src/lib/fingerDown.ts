/**
 * Whether a finger is on Wave now: down from the root's touch start until it
 * lifts. A touch a native scroll or gesture took over may lift unheard, so it
 * counts as down for `takeoverMs` (Core's `BACKGROUND_WORK_LIMITS.takeoverMs`,
 * as background work waits it out) or until the next touch lifts.
 */
export interface FingerDown {
  readonly started: () => void;
  readonly ended: () => void;
  readonly takenOver: () => void;
  readonly isDown: () => boolean;
  /** Calls [listener] each time the finger goes down or lifts; returns the unsubscribe. */
  readonly subscribe: (listener: () => void) => () => void;
}

export const createFingerDown = ({
  takeoverMs,
  schedule,
}: {
  readonly takeoverMs: number;
  readonly schedule: (ms: number, run: () => void) => () => void;
}): FingerDown => {
  let down = false;
  let cancelLift: (() => void) | undefined;
  const listeners = new Set<() => void>();
  const set = (next: boolean) => {
    cancelLift?.();
    cancelLift = undefined;
    if (down === next) return;
    down = next;
    for (const listener of listeners) listener();
  };
  return {
    started: () => set(true),
    ended: () => set(false),
    takenOver: () => {
      set(true);
      cancelLift = schedule(takeoverMs, () => set(false));
    },
    isDown: () => down,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
};
