/**
 * Crossfade (Settings › Playback): how long a song ending on its own overlaps
 * the next one, both fading. The playback service plays the overlap and
 * decides which song changes get one; this is the setting and its length,
 * when the next song is made ready, and how long a late one overlaps.
 */

import { snapSliderValue } from "./slider.ts";

/** The Crossfade slider, in seconds. Zero, the default, keeps playback gapless. */
export const CROSSFADE = { min: 0, max: 15, step: 0.5, default: 0 } as const;

/** The setting nearest `seconds` the slider can hold. */
export const snapCrossfade = (seconds: number): number => snapSliderValue(seconds, CROSSFADE);

/** The stored setting (null when nothing is stored), back on the slider's range. */
export const readCrossfade = (stored: string | null): number => {
  const seconds = stored === null ? Number.NaN : Number(stored);
  return Number.isFinite(seconds) ? snapCrossfade(seconds) : CROSSFADE.default;
};

/**
 * The overlap, in ms, for songs ending on their own with the setting at
 * `seconds`; 0 switches at once (gapless). The playback service decides which
 * changes fade: only a song ending on its own into another, never with repeat
 * one or an end-of-song sleep timer, and skip, previous or picking a song
 * switch at once.
 */
export const crossfadeDuration = (seconds: number): number => snapCrossfade(seconds) * 1000;

/**
 * How long before the overlap the playback service opens its second copy of
 * the outgoing song, to get it in step (Kotlin `CrossfadeTiming.PREROLL_MS`).
 */
export const CROSSFADE_PRE_ROLL_MS = 3000;

/**
 * How far ahead of the pre-roll the next song is made ready: a streamed YT
 * Music song's address resolved and its start buffered, an unsearched
 * playlist entry searched, so it's playable when the overlap begins.
 */
export const CROSSFADE_PREFETCH_LEAD_MS = 30_000;

/** The overlap a song of [durationMs] gets: the setting, at most half the song. */
const songOverlap = (overlapMs: number, durationMs: number): number =>
  Math.min(overlapMs, Math.floor(durationMs / 2));

/**
 * Where in the playing song (ms) the next one is made ready for the overlap
 * of [overlapMs] (`crossfadeDuration`): the pre-roll and the prefetch lead
 * before the overlap, or the song's start when it's shorter than that. Null
 * with crossfade off, or while the song's length is unknown. The playback
 * service mirrors it (Kotlin `CrossfadeTiming.prefetchAt`).
 */
export const crossfadePrefetchAt = (
  overlapMs: number,
  durationMs: number | null,
): number | null => {
  if (overlapMs <= 0 || durationMs === null || durationMs <= 0) return null;
  const overlapAt = durationMs - songOverlap(overlapMs, durationMs);
  return Math.max(0, overlapAt - CROSSFADE_PRE_ROLL_MS - CROSSFADE_PREFETCH_LEAD_MS);
};

/** The shortest overlap a late next song still gets; with less left, the move is gapless. */
export const MIN_LATE_CROSSFADE_MS = 1000;

/**
 * The overlap, in ms, once a next song that wasn't ready when the overlap
 * should have begun is ready, with [leftMs] of the outgoing song to go: the
 * time left, up to the full [overlapMs]; 0 (a gapless move, no fade-out)
 * with under `MIN_LATE_CROSSFADE_MS` left. Until then the outgoing song
 * plays on at full volume: it never fades out alone. The playback service
 * mirrors it (Kotlin `CrossfadeTiming.lateOverlap`).
 */
export const lateCrossfadeOverlap = (overlapMs: number, leftMs: number): number =>
  leftMs < MIN_LATE_CROSSFADE_MS ? 0 : Math.min(overlapMs, leftMs);
