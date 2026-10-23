/**
 * Settings › Appearance › Motion › Bounce amount (docs/spec.md, "Visual
 * design", Bounce amount): how elastic Wave's pulls and swipes feel, from 0%
 * (no give and no overshoot) to 120%, 100% being how they always felt.
 *
 * It scales only elasticity: the rubber-band give of a pull past an edge
 * (`mixPull`'s `give`) and the overshoot of the spring that puts a dragged
 * row, pill or toast back when it's let go without acting (`bounceSpring`).
 * Thresholds stay where they are at every amount: what arms, refreshes or
 * runs an action is measured on the finger's travel, never on how far the
 * content gave. Tap feedback, list scrolling and navigation (sheets opening
 * and closing) don't follow it. Android's reduce motion beats it: with
 * animations removed nothing bounces, whatever the slider says.
 */

import { snapSliderValue } from "./slider.ts";

/** The slider's range, in percent: 0–120% in steps of 5, 100% (as Wave always was) by default. */
export const BOUNCE_AMOUNT = { min: 0, max: 120, step: 5, default: 100 } as const;

/** A whole or decimal number, optionally negative: anything else stored is malformed. */
const NUMBER = /^-?\d+(?:\.\d+)?$/;

/**
 * The bounce amount from what's stored, in percent. Nothing stored, or
 * anything that isn't a plain number, is the default 100%; a number off the
 * range is clamped to it (below 0 is 0%, above 120 is 120%) and lands on the
 * nearest step.
 */
export const readBounceAmount = (stored: string | null): number => {
  const text = stored?.trim() ?? "";
  if (!NUMBER.test(text)) return BOUNCE_AMOUNT.default;
  return snapSliderValue(Number(text), BOUNCE_AMOUNT);
};

/** What to store for [amount]: nothing at the default, so it reads back (and syncs) as 100%. */
export const storedBounceAmount = (amount: number): string | null => {
  const snapped = Number.isFinite(amount)
    ? snapSliderValue(amount, BOUNCE_AMOUNT)
    : BOUNCE_AMOUNT.default;
  return snapped === BOUNCE_AMOUNT.default ? null : String(snapped);
};

/**
 * The elasticity to draw with, as a multiple of Wave's own (0 to 1.2), for
 * the owner's [amount] in percent. Under Android's reduce motion it's 0:
 * decorative bounce goes, whatever the slider says.
 */
export const bounceScale = (amount: number, reduceMotion: boolean): number => {
  if (reduceMotion) return 0;
  const percent = Number.isFinite(amount)
    ? Math.min(BOUNCE_AMOUNT.max, Math.max(BOUNCE_AMOUNT.min, amount))
    : BOUNCE_AMOUNT.default;
  return percent / 100;
};

/** A spring as Reanimated takes it (mass defaults to 1, as Reanimated's does). */
export interface SpringShape {
  readonly damping: number;
  readonly stiffness: number;
  readonly mass?: number;
}

/** A spring scaled by the bounce amount: `overshootClamping` holds it at its target at 0%. */
export interface BounceSpring {
  readonly damping: number;
  readonly stiffness: number;
  readonly mass: number;
  readonly overshootClamping: boolean;
}

/**
 * The springs that put something dragged back when it's let go without
 * acting, as Wave always had them (they're what 100% draws). Each is a
 * little under critical damping, so it swings slightly past rest first.
 */
export const RETURN_SPRINGS = {
  /** Home's pull-to-refresh rows (Magic Queue, Artist mixes, Genre mixes) let go. */
  pullRow: { damping: 20, stiffness: 240, mass: 1 },
  /** A song row's swipe let go before it armed, or flicked back. */
  swipeRow: { damping: 23, stiffness: 240, mass: 1 },
  /** The mini player's swipe to skip let go short. */
  miniPlayer: { damping: 20, stiffness: 240, mass: 1 },
  /** A toast swiped up and let go short of dismissing. */
  toast: { damping: 20, stiffness: 240, mass: 1 },
} as const satisfies Record<string, SpringShape>;

/** The damping that makes [spring] critical: the least that never overshoots. */
const criticalDamping = (stiffness: number, mass: number): number =>
  2 * Math.sqrt(stiffness * mass);

/** How far past its target a spring with damping ratio [zeta] swings, released at rest. */
const overshootOf = (zeta: number): number =>
  zeta >= 1 ? 0 : Math.exp((-Math.PI * zeta) / Math.sqrt(1 - zeta * zeta));

/** The damping ratio whose overshoot is [overshoot] (between 0 and 1, exclusive). */
const zetaFor = (overshoot: number): number => {
  const log = Math.log(overshoot);
  return -log / Math.sqrt(Math.PI * Math.PI + log * log);
};

/**
 * How far past its target [spring] swings when released at rest, as a share
 * of the distance it travels (0.07 is 7%): the rebound the bounce amount scales.
 */
export const bounceOvershoot = (spring: SpringShape): number => {
  const mass = spring.mass ?? 1;
  return overshootOf(spring.damping / criticalDamping(spring.stiffness, mass));
};

/** The largest overshoot a scaled spring may have: a spring always settles. */
const MAX_OVERSHOOT = 0.95;

/**
 * [base] (one of Wave's springs that puts something dragged back) with its
 * overshoot scaled by [scale] (`bounceScale`): the same stiffness and mass,
 * so it returns as quickly, with damping chosen so it swings past its target
 * [scale] times as far. At 1 it's [base] exactly; at 0 it's critically
 * damped and clamped, arriving without passing its target even when flung;
 * between, the overshoot grows with the scale. A base that never overshoots
 * keeps its damping.
 */
export const bounceSpring = (base: SpringShape, scale: number): BounceSpring => {
  const mass = base.mass ?? 1;
  const { stiffness } = base;
  const factor = Number.isFinite(scale) ? Math.max(0, scale) : 1;
  if (factor === 1) return { damping: base.damping, stiffness, mass, overshootClamping: false };
  const critical = criticalDamping(stiffness, mass);
  if (factor === 0) {
    return {
      damping: Math.max(base.damping, critical),
      stiffness,
      mass,
      overshootClamping: true,
    };
  }
  const overshoot = Math.min(MAX_OVERSHOOT, bounceOvershoot(base) * factor);
  if (overshoot <= 0) return { damping: base.damping, stiffness, mass, overshootClamping: false };
  return { damping: zetaFor(overshoot) * critical, stiffness, mass, overshootClamping: false };
};
