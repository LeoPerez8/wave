import type { SheetEvent, SheetPhase, SheetStep } from "@wave/core";
import type { followNowPlayingLink } from "../../src/nowPlaying/linkClose.ts";

export type SheetReducer = (phase: SheetPhase, event: SheetEvent) => SheetStep;
type Action = "link" | "Back" | "drag" | "card" | "chevron";
export const LINK_SEQUENCES: readonly {
  name: string;
  phase: SheetPhase;
  actions: readonly Action[];
}[] = [
  { name: "link", phase: "open", actions: ["link"] },
  { name: "link then Back", phase: "open", actions: ["link", "Back"] },
  { name: "link then a drag", phase: "open", actions: ["link", "drag"] },
  { name: "link then a card dismissed", phase: "open", actions: ["link", "card"] },
  { name: "link while closing", phase: "closing", actions: ["link"] },
  { name: "two links", phase: "open", actions: ["link", "link"] },
  { name: "link then chevron", phase: "open", actions: ["link", "chevron"] },
];

/**
 * Replay actual Core decisions. The legacy adapter faithfully reproduces ti's
 * closeNowPlaying/afterClose slot, including replacement by a callback-free
 * close. No delayed animation or timer is represented as desktop CPU work.
 * Events are 16 ms apart; a downward drag springs back open, interrupting close.
 */
export const replayLinks = (
  reduce: SheetReducer,
  sequence: (typeof LINK_SEQUENCES)[number],
  settleMs: number,
  follow?: typeof followNowPlayingLink,
) => {
  let phase = sequence.phase;
  let now = 0;
  let closeDue: number | null = null;
  let afterClose: (() => void) | null = null;
  let taps = 0;
  const pushes: { tap: number; waitMs: number }[] = [];
  const advance = (event: SheetEvent): SheetStep => {
    const next = reduce(phase, event);
    phase = next.phase;
    if (next.spring !== null) closeDue = next.spring === "closed" ? now + settleMs : null;
    if (next.hidden) {
      const then = afterClose;
      afterClose = null;
      then?.();
    }
    return next;
  };
  const legacyClose = (then?: () => void) => {
    afterClose = then ?? null;
    advance({ type: "close" });
    if (phase === "hidden") {
      const callback = afterClose;
      afterClose = null;
      callback?.();
    }
  };
  for (const action of sequence.actions) {
    if (action === "link") {
      const tap = ++taps;
      const at = now;
      const navigate = () => pushes.push({ tap, waitMs: now - at });
      if (follow !== undefined) follow({ step: advance, navigate });
      else legacyClose(navigate);
    } else if (action === "drag") {
      advance({ type: "release", to: "open" });
    } else {
      // Back, chevron and a card's close used the same callback-free close.
      if (follow === undefined) legacyClose();
      else advance({ type: "close" });
    }
    now += 16;
  }
  if (closeDue !== null) {
    now = closeDue;
    advance({ type: "closed" });
  }
  if (follow !== undefined && phase === "opening") advance({ type: "opened" });
  return { taps, pushes, lost: taps - pushes.length, phase };
};

export interface ClosingSpring {
  readonly damping: number;
  readonly stiffness: number;
  readonly mass: number;
}

/**
 * Analytic damped harmonic motion, zero initial velocity and unit displacement.
 * Settle at the first 60 Hz frame where relative kinetic + potential energy is
 * <= Reanimated 4's default 6e-9. Relative energy is independent of sheet height.
 * This is modeled animation wait, never a measured phone/UI-thread duration.
 */
export const closingSpringSettleMs = (
  spring: ClosingSpring,
  energyThreshold = 6e-9,
  refreshHz = 60,
): number => {
  const alpha = spring.damping / (2 * spring.mass);
  const omega0Squared = spring.stiffness / spring.mass;
  const omegaSquared = omega0Squared - alpha * alpha;
  if (alpha <= 0 || omegaSquared <= 0 || energyThreshold <= 0 || refreshHz <= 0)
    throw new Error("link replay needs a damped underdamped spring and positive thresholds");
  const omega = Math.sqrt(omegaSquared);
  for (let frame = 0; frame < refreshHz * 60; frame++) {
    const t = frame / refreshHz;
    const decay = Math.exp(-alpha * t);
    const x = decay * (Math.cos(omega * t) + (alpha / omega) * Math.sin(omega * t));
    const v = (-omega0Squared / omega) * decay * Math.sin(omega * t);
    const relativeEnergy = x * x + (spring.mass / spring.stiffness) * v * v;
    if (relativeEnergy <= energyThreshold) return t * 1000;
  }
  throw new Error("closing spring did not settle within 60 seconds");
};
