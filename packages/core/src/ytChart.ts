/**
 * YouTube Music's chart (docs/spec.md, "Artist mixes"): the top artists of
 * its charts page, read signed out (YouTube Music picks its country from the
 * network's location), at most once a week, and kept on the phone (not synced), so
 * Artist mixes for an empty Library build offline and on a cold launch.
 */

import type { DiscoverSimilarArtist } from "./discoverMixes.ts";
import { readStoredRecord } from "./storedJson.ts";

/** One of the chart's top artists: their name and their YouTube Music page (`UC…`). */
export type YtChartArtist = DiscoverSimilarArtist;

/** The chart as last read. */
export interface YtChartKept {
  /** When it was read (ms since the epoch). */
  readonly readAt: number;
  /** Its top artists, in the chart's order. */
  readonly artists: readonly YtChartArtist[];
}

/** How long a kept chart lasts before it's read again. */
export const YT_CHART_READ_MS = 7 * 24 * 60 * 60 * 1000;

/** After a failed read, how long before the chart is asked for again. */
const RETRY_MS = 10 * 60 * 1000;

/** How many of the chart's top artists are kept: its whole list as YouTube Music shows it. */
const KEPT = 40;

/**
 * Whether to read the chart at [now]: when none is kept, when the kept one
 * is a week old, or read later than now (the clock went back). Not within
 * ten minutes of a failed read ([failedAt]).
 */
export const ytChartReadDue = (
  kept: YtChartKept | null,
  { now, failedAt = null }: { readonly now: number; readonly failedAt?: number | null },
): boolean => {
  if (failedAt !== null && failedAt <= now && now - failedAt < RETRY_MS) return false;
  return kept === null || kept.readAt > now || now - kept.readAt >= YT_CHART_READ_MS;
};

/**
 * What to keep after a read at [now] gave [artists]: them (forty at most),
 * or [kept] as it was when the read found none.
 */
export const withYtChartRead = (
  kept: YtChartKept | null,
  artists: readonly YtChartArtist[],
  now: number,
): YtChartKept | null =>
  artists.length === 0 ? kept : { readAt: now, artists: artists.slice(0, KEPT) };

/** What to save for [kept]; null (nothing saved) for none. */
export const storedYtChart = (kept: YtChartKept | null): string | null =>
  kept === null
    ? null
    : JSON.stringify({
        readAt: kept.readAt,
        artists: kept.artists.map(({ name, browseId }) => [name, browseId]),
      });

/** [value] as a kept artist (`[name, browseId]`); null when it isn't one. */
const readArtist = (value: unknown): YtChartArtist | null => {
  if (!Array.isArray(value)) return null;
  const [name, browseId] = value as readonly unknown[];
  return typeof name === "string" && typeof browseId === "string" ? { name, browseId } : null;
};

/** The chart [stored] holds; null when nothing readable is saved. */
export const parseYtChart = (stored: string | null): YtChartKept | null => {
  const { readAt, artists } = readStoredRecord(stored);
  if (typeof readAt !== "number" || !Number.isFinite(readAt) || !Array.isArray(artists))
    return null;
  return { readAt, artists: artists.flatMap((artist: unknown) => readArtist(artist) ?? []) };
};
