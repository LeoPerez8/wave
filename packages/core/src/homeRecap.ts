import { parseRecapId, recapId, recapToAnnounce, type RecapPeriod } from "./recap.ts";

/** The last discovered periods, available before a new session's history read. */
export const parseKnownRecaps = (stored: string | null): readonly RecapPeriod[] | undefined => {
  if (stored === null) return undefined;
  try {
    const ids: unknown = JSON.parse(stored);
    if (!Array.isArray(ids)) return undefined;
    const periods: RecapPeriod[] = [];
    for (const id of ids) {
      if (typeof id !== "string") return undefined;
      const period = parseRecapId(id);
      if (period === null) return undefined;
      periods.push(period);
    }
    return periods;
  } catch {
    return undefined;
  }
};

export const storedKnownRecaps = (periods: readonly RecapPeriod[] | undefined): string | null =>
  periods === undefined ? null : JSON.stringify(periods.map(recapId));

/** Home keeps this card, or no card, until the next visit. */
export interface HomeRecap {
  readonly visible: boolean;
  readonly period: RecapPeriod | null;
}

export interface HomeRecapInput {
  readonly available: readonly RecapPeriod[] | undefined;
  readonly opened: readonly string[];
  readonly visible: boolean;
}

export const startHomeRecap = ({ available, opened, visible }: HomeRecapInput): HomeRecap => ({
  visible,
  period: recapToAnnounce(available ?? [], opened),
});

/** Only returning to Home adopts newly available Recaps. Pending reads reserve no space. */
export const homeRecapVisibility = (state: HomeRecap, input: HomeRecapInput): HomeRecap => {
  if (state.visible === input.visible) return state;
  return input.visible ? startHomeRecap(input) : { ...state, visible: false };
};
