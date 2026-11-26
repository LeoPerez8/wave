/**
 * The ghost wave (Ghost wave, #1498): while the network holds the playing song
 * up (`networkSignal` Offline or Slow), a ghost of the scrubber's elapsed wave
 * leaves the playhead, travels right along the remaining line and fades before
 * it arrives, over and over: the song trying to move forward.
 */

import type { NetworkSignal } from "./networkSignal.ts";

/** The ghost wave's look, in dp and ms. */
export const GHOST_WAVE = {
  /** How long the segment is. */
  length: 70,
  /** Its amplitude, against the scrubber's own wave. */
  amplitudeScale: 1.5,
  /** Its opacity as it leaves the playhead; it fades to nothing on the way. */
  opacity: 0.55,
  /** How much of its amplitude is left when it ends. */
  endAmplitude: 0.4,
  /** One run while Offline, and while Slow. */
  offlinePeriodMs: 2400,
  slowPeriodMs: 3600,
  /** Under reduce motion it's drawn still, this far along its run (about a third of the line). */
  stillPhase: 1 / 3,
} as const;

/**
 * The mini player's ghost wave, drawn natively along the pill's bottom edge
 * (`wave_ghost_offline.xml`, `wave_ghost_slow.xml`, checked against this by a
 * test): a faint 1.5dp line about 60dp long, on Now Playing's periods.
 */
export const MINI_GHOST_WAVE = {
  length: 60,
  stroke: 1.5,
  wavelength: 9,
  amplitude: 1.5,
  /** The opacity it leaves the pill's left end with, fading to nothing on the way. */
  opacity: 0.7,
  /** How far it travels, beyond the widest pill, so it's faded out before it leaves. */
  travel: 480,
} as const;

/** How long one run of the ghost wave takes for [signal], or null when it doesn't run. */
export const ghostWavePeriodMs = (signal: NetworkSignal): number | null =>
  signal === "offline"
    ? GHOST_WAVE.offlinePeriodMs
    : signal === "slow"
      ? GHOST_WAVE.slowPeriodMs
      : null;

export type GhostWaveFrame = {
  /** Where the playhead is, in dp from the bar's left end: the run starts there. */
  from: number;
  /** The bar's right end, in dp. */
  to: number;
  /** How far through the run, 0 to 1. */
  phase: number;
  /** The scrubber's wave (`elapsedWavePath`'s). */
  wavelength: number;
  amplitude: number;
};

/** How finely the segment is drawn, in dp. */
const STEP = 2;

/**
 * The segment's SVG path at [phase], centred on y = 0 (translate it to the
 * bar's centre line), and its opacity. Its head moves from the playhead to the
 * bar's end over the run; the tail flattens behind it, the whole fades from
 * `GHOST_WAVE.opacity` to nothing and its amplitude shrinks to
 * `GHOST_WAVE.endAmplitude`, so it's gone as it reaches the end. A worklet: the
 * scrubber draws it on the UI thread.
 */
export const ghostWaveFrame = ({
  from,
  to,
  phase,
  wavelength,
  amplitude,
}: GhostWaveFrame): { d: string; opacity: number } => {
  "worklet";
  const p = Math.min(1, Math.max(0, phase));
  const room = to - from;
  if (room <= 0 || wavelength <= 0) return { d: "", opacity: 0 };
  const head = from + p * room;
  const tail = Math.max(from, head - GHOST_WAVE.length);
  if (head - tail < STEP) return { d: "", opacity: 0 };
  const peak = amplitude * GHOST_WAVE.amplitudeScale * (1 - p * (1 - GHOST_WAVE.endAmplitude));
  let d = "";
  for (let x = tail; ; x = Math.min(head, x + STEP)) {
    // Full height at the head, flat at the tail.
    const envelope = 1 - (head - x) / GHOST_WAVE.length;
    const y = -peak * envelope * Math.sin((2 * Math.PI * (x - from)) / wavelength);
    d += `${d === "" ? "M" : "L"}${x.toFixed(1)} ${y.toFixed(2)}`;
    if (x >= head) break;
  }
  return { d, opacity: GHOST_WAVE.opacity * (1 - p) };
};

/**
 * The mini player's ghost wave as an SVG path from x = 0 to its length, with
 * its centre line at y = amplitude (a box 2 × amplitude tall): flat at the
 * tail (the left), full at the head, as Now Playing's is.
 */
export const miniGhostWavePath = (): string => {
  const { length, wavelength, amplitude } = MINI_GHOST_WAVE;
  let d = "";
  for (let x = 0; x <= length; x += 1) {
    const y = amplitude - amplitude * (x / length) * Math.sin((2 * Math.PI * x) / wavelength);
    d += `${d === "" ? "M" : "L"}${x} ${Number(y.toFixed(2))}`;
  }
  return d;
};
