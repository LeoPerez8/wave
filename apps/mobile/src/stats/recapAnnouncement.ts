/** Padding, two gaps and room for a two-line ready label at larger text sizes. */
export const recapCardHeight = (fontScale: number): number => 40 + 84 * Math.max(1, fontScale);
