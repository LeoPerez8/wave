/** Artist and Genre mixes reuse an ordered radio for strictly less than seven days. */
export const RADIO_CACHE_FRESH_MS = 7 * 24 * 60 * 60 * 1000;
export const radioCacheFresh = (readAt: number | null, now: number): boolean =>
  readAt !== null &&
  Number.isFinite(readAt) &&
  readAt <= now &&
  now - readAt < RADIO_CACHE_FRESH_MS;
