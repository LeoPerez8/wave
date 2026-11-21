/**
 * Whether Now Playing's hidden panes (the Queue and Related's panel) stay mounted (#1380).
 *
 * They mount, hidden, once the sheet has settled open, so the first swipe or rise after each open
 * finds them drawn. Closed, they stay a few seconds (a quick reopen finds them still warm), then
 * unmount, so track changes while the sheet is away don't re-render them. A memory warning with
 * the sheet closed unmounts them at once. The next settled open warms them again.
 */

/** How long the panes outlive a close. */
export const WARM_AFTER_CLOSE_MS = 4000;

export type WarmPanesEvent =
  | { readonly type: "settled" }
  | { readonly type: "shown" }
  | { readonly type: "hidden" }
  | { readonly type: "cooled" }
  | { readonly type: "memoryWarning" };

export interface WarmPanes {
  readonly warm: boolean;
  readonly shown: boolean;
}

export const initialWarmPanes: WarmPanes = { warm: false, shown: false };

export const stepWarmPanes = (state: WarmPanes, event: WarmPanesEvent): WarmPanes => {
  switch (event.type) {
    case "settled":
      return { warm: true, shown: true };
    case "shown":
      return state.shown ? state : { ...state, shown: true };
    case "hidden":
      return state.shown ? { ...state, shown: false } : state;
    case "cooled":
    case "memoryWarning":
      return state.shown || !state.warm ? state : { ...state, warm: false };
  }
};

/**
 * Drives `stepWarmPanes` from the sheet: `shown` and `settled` as the sheet reports them. Calls
 * `changed` with each new `warm` value. `schedule` and `onMemoryWarning` return their cancel.
 */
export const createWarmPanes = (deps: {
  readonly changed: (warm: boolean) => void;
  readonly schedule: (run: () => void, ms: number) => () => void;
  readonly onMemoryWarning: (listener: () => void) => () => void;
}) => {
  let state = initialWarmPanes;
  let cancelCooling: (() => void) | undefined;
  const send = (event: WarmPanesEvent): void => {
    const next = stepWarmPanes(state, event);
    if (next === state) return;
    const warmed = next.warm !== state.warm;
    state = next;
    if (event.type === "hidden" && state.warm) {
      cancelCooling?.();
      cancelCooling = deps.schedule(() => {
        cancelCooling = undefined;
        send({ type: "cooled" });
      }, WARM_AFTER_CLOSE_MS);
    } else if (event.type === "shown" || event.type === "settled" || !state.warm) {
      cancelCooling?.();
      cancelCooling = undefined;
    }
    if (warmed) deps.changed(state.warm);
  };
  const stopMemory = deps.onMemoryWarning(() => send({ type: "memoryWarning" }));
  return {
    send,
    warm: () => state.warm,
    dispose: () => {
      cancelCooling?.();
      stopMemory();
    },
  };
};
