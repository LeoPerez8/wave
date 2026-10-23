import { recapToAnnounce, type RecapPeriod } from "./recap.ts";

/** Home keeps this card, or no card, until the next visit. */
export interface HomeRecap {
  readonly visible: boolean;
  readonly period: RecapPeriod | null;
}

export const startHomeRecap = (
  available: readonly RecapPeriod[] | undefined,
  opened: readonly string[],
  visible: boolean,
): HomeRecap => ({ visible, period: recapToAnnounce(available ?? [], opened) });

/** Only returning to Home adopts newly available Recaps. Pending reads reserve no space. */
export const homeRecapVisibility = (
  state: HomeRecap,
  visible: boolean,
  available: readonly RecapPeriod[] | undefined,
  opened: readonly string[],
): HomeRecap => {
  if (state.visible === visible) return state;
  return visible ? startHomeRecap(available, opened, true) : { ...state, visible: false };
};
