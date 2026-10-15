/**
 * Download in best quality as the Wave account keeps it (docs/spec.md, "The
 * Soulseek account"). The switch itself lives in the native module; the
 * synced copy is the Wave account's: Settings sets it once the switch has
 * moved, and one pulled from another phone moves the switch.
 */

/** Where Download in best quality stands after a pull. */
export interface BestQualityState {
  /** The synced copy says on. */
  readonly synced: boolean;
  /** The native switch is on. */
  readonly native: boolean;
  /** The synced copy was pulled and the native switch hasn't followed it yet. */
  readonly pulled: boolean;
}

/**
 * What to do about it: move the native switch to a pulled value
 * (`turnOn`, `turnOff`), forget a pulled value now in place (`applied`),
 * turn the synced copy off as a change made here (`wentOff`), or nothing.
 */
export type BestQualityStep = "turnOn" | "turnOff" | "applied" | "wentOff" | "none";

/**
 * Settles Download in best quality after each pull. A pulled value the
 * native switch doesn't show yet (turning it on failed offline) is tried
 * again until it shows. Without one, a switch off under a synced copy that
 * says on went off natively, as when Soulseek rejects the account: the
 * Wave account hears of it. A switch on under a synced copy that says off
 * is left alone: a phone from before the switch shows it on, with its own
 * account, and that isn't sent to the other phones.
 */
export const settleBestQuality = ({
  synced,
  native,
  pulled,
}: BestQualityState): BestQualityStep => {
  if (pulled) return synced === native ? "applied" : synced ? "turnOn" : "turnOff";
  return synced && !native ? "wentOff" : "none";
};
