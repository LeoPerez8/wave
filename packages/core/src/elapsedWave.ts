/**
 * The elapsed part of the Now Playing scrubber: a still wave, the same shape
 * as the playing song's underline, that meets the flat remaining line at the
 * playhead.
 */

export type ElapsedWave = {
  /** How far the playhead is from the bar's left end, in dp. */
  length: number;
  /** Length of one full crest-and-trough, in dp. */
  wavelength: number;
  /** Height of a crest above the centre line, in dp. */
  amplitude: number;
};

export const elapsedWavePath = ({ length, wavelength, amplitude }: ElapsedWave): string => {
  if (length <= 0) return "";
  const half = wavelength / 2;
  const whole = Math.floor(length / half);
  let d = `M0 ${amplitude}`;
  if (whole >= 1) d += `Q${half / 2} ${-amplitude} ${half} ${amplitude}`;
  for (let i = 2; i <= whole; i++) d += `T${i * half} ${amplitude}`;
  const start = whole * half;
  const rest = length - start;
  if (rest > 0) {
    // A scaled-down copy of the next half-wave: it keeps the full wave's
    // slope at the centre line, so it grows in smoothly as the playhead moves.
    const bend = 2 * amplitude * (rest / half) * (whole % 2 === 0 ? -1 : 1);
    d += `Q${start + rest / 2} ${amplitude + bend} ${length} ${amplitude}`;
  }
  return d;
};
