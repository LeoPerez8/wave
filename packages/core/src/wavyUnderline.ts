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
 * The SVG path of a sine-like wave (smooth quadratic half-waves) with its
 * centre line at y = amplitude, so it fits a box 2 × amplitude tall. It runs
 * one wavelength past `width`: sliding it left by a wavelength, over and over,
 * reads as a continuous ripple.
 */
export const wavePath = ({ width, wavelength, amplitude }: WaveShape): string => {
  const half = wavelength / 2;
  const halves = Math.ceil((width + wavelength) / half);
  let d = `M0 ${amplitude}Q${half / 2} ${-amplitude} ${half} ${amplitude}`;
  for (let i = 2; i <= halves; i++) d += `T${i * half} ${amplitude}`;
  return d;
};

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
