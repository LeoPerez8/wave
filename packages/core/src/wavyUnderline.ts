/**
 * The wavy underline that marks the playing song's title in song lists.
 */

export type WaveShape = {
  /** How wide the underlined text is, in dp. */
  width: number;
  /** Length of one full crest-and-trough, in dp. */
  wavelength: number;
  /** Height of a crest above the centre line, in dp. */
  amplitude: number;
};

/**
 * The underline's wave, in dp: the single source for the native tile that
 * draws it (`wave_underline.xml`, checked against this by a test) and for the
 * scrubber's elapsed wave, which scales it up keeping wavelength : amplitude.
 * While it ripples it slides one wavelength left every `rippleMs`.
 */
export const UNDERLINE_WAVE = {
  wavelength: 8,
  amplitude: 1.25,
  stroke: 1.25,
  rippleMs: 1050,
} as const;

/**
 * The Recognize card's listening wave, in dp, drawn natively as the underline is
 * (`wave_listening.xml`, checked against this by a test): the same line, larger and
 * slower, in the accent colour, rippling while Wave listens.
 */
export const LISTENING_WAVE = {
  wavelength: 24,
  amplitude: 6,
  stroke: 2,
  rippleMs: 1200,
} as const;

/**
 * The start of a wave path: `halves` whole half-waves (crest first) from x = 0,
 * centre line at y = amplitude. With none, just the move to the start. A
 * worklet, for the scrubber's `elapsedWavePath` on the UI thread.
 */
export const halfWaves = (halves: number, wavelength: number, amplitude: number): string => {
  "worklet";
  const half = wavelength / 2;
  let d = `M0 ${amplitude}`;
  if (halves >= 1) d += `Q${half / 2} ${-amplitude} ${half} ${amplitude}`;
  for (let i = 2; i <= halves; i++) d += `T${i * half} ${amplitude}`;
  return d;
};

/**
 * The SVG path of a sine-like wave (smooth quadratic half-waves) with its
 * centre line at y = amplitude, so it fits a box 2 × amplitude tall. It runs
 * one wavelength past `width`: sliding it left by a wavelength, over and over,
 * reads as a continuous ripple.
 */
export const wavePath = ({ width, wavelength, amplitude }: WaveShape): string =>
  halfWaves(Math.max(1, Math.ceil((width + wavelength) / (wavelength / 2))), wavelength, amplitude);

export type UnderlineMotion = "wriggle" | "still";

export type UnderlineMotionInput = {
  isPlaying: boolean;
  reduceMotion: boolean;
  tapAnimationMs: number;
};

/**
 * Whether the underline ripples along the title or lies still. It only moves
 * while music plays, and motion is off under the system's reduce-motion
 * setting or with the tap animation set to 0 ms (Wave's own "no motion").
 */
export const underlineMotion = (input: UnderlineMotionInput): UnderlineMotion =>
  input.isPlaying && !input.reduceMotion && input.tapAnimationMs > 0 ? "wriggle" : "still";
