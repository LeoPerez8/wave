/**
 * Tab switches during rapid taps. A tap switches at once; while that switch
 * hasn't shown yet, further taps only change where the owner wants to end up,
 * and the next switch goes out when the first one shows. So at most one switch
 * is ever in flight, a burst of taps never queues a switch per tap (each one
 * mounting a tab only to hide it), and the tabs settle on the last one tapped.
 * There is no debounce: the first tap is never held back.
 */

export interface TabSwitch<T extends string> {
  /** The tab on screen, as the last commit showed it; null under a screen pushed over the tabs. */
  readonly shown: T | null;
  /** The tab a switch was sent to that hasn't shown yet. */
  readonly sent: T | null;
  /** When that switch was sent. */
  readonly sentAt: number;
  /** Where the last tap asked to end up, when that's not where `sent` is going. */
  readonly wanted: T | null;
}

export type TabSwitchEvent<T extends string> =
  /** The owner tapped [tab] on the bar, at [at] (ms, any monotonic clock). */
  | { readonly type: "tap"; readonly tab: T; readonly at: number }
  /** A commit put [tab] on screen (null: a screen pushed over the tabs). */
  | { readonly type: "shown"; readonly tab: T | null; readonly at: number };

export interface TabSwitchStep<T extends string> {
  readonly state: TabSwitch<T>;
  /** The tab to switch to now, or null to send nothing. */
  readonly send: T | null;
  /**
   * A tapped tab arriving, and the one it replaced: what the entry motion
   * slides from. Null for anything else (a launch, Back, a link, a tap).
   */
  readonly enter: { readonly from: T; readonly to: T } | null;
}

/**
 * How long a switch may stay on its way before a tap stops waiting for it and
 * sends its own: a switch that never showed (dropped, or overtaken by Back)
 * mustn't leave the bar dead. Not a debounce: no tap waits for it.
 */
const TAB_SWITCH_LOST_MS = 1_000;

/** Tab switches with [shown] on screen and nothing in flight. */
export const startTabSwitch = <T extends string>(shown: T | null): TabSwitch<T> => ({
  shown,
  sent: null,
  sentAt: 0,
  wanted: null,
});

const sending = <T extends string>(state: TabSwitch<T>, tab: T, at: number): TabSwitchStep<T> => ({
  state: { ...state, sent: tab, sentAt: at, wanted: null },
  send: tab,
  enter: null,
});

const quiet = <T extends string>(state: TabSwitch<T>): TabSwitchStep<T> => ({
  state,
  send: null,
  enter: null,
});

const tapped = <T extends string>(state: TabSwitch<T>, tab: T, at: number): TabSwitchStep<T> => {
  if (state.sent !== null && at - state.sentAt < TAB_SWITCH_LOST_MS) {
    return quiet({ ...state, wanted: tab === state.sent ? null : tab });
  }
  if (tab === state.shown) return quiet(state.sent === null ? state : startTabSwitch(tab));
  return sending(state, tab, at);
};

const shownNow = <T extends string>(
  state: TabSwitch<T>,
  tab: T | null,
  at: number,
): TabSwitchStep<T> => {
  const next = { ...state, shown: tab };
  const { shown: from, sent, wanted } = state;
  const enter = from !== null && tab !== null && tab === sent ? { from, to: tab } : null;
  if (sent === null) return quiet(next);
  // Whatever showed, the switch on its way is done: it showed, or something else overtook it.
  if (wanted !== null && wanted !== tab) return { ...sending(next, wanted, at), enter };
  return { state: { ...next, sent: null, wanted: null }, send: null, enter };
};

/** What [event] does to [state], and the switch to send for it, if any. */
export const stepTabSwitch = <T extends string>(
  state: TabSwitch<T>,
  event: TabSwitchEvent<T>,
): TabSwitchStep<T> =>
  event.type === "tap" ? tapped(state, event.tab, event.at) : shownNow(state, event.tab, event.at);
