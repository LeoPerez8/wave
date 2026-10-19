/**
 * Where artists' radios start, remembered (docs/spec.md, "Artist mixes"):
 * an artist's radio starts from the Start radio button of their YouTube
 * Music page, whose playlist id and params are kept by the page's browse id
 * once read, so a later build starts the radio without reading the page
 * again. A start YouTube Music refuses is forgotten, and the page is read
 * again. Kept on the phone, not synced.
 */

import { isRecord, readStoredRecord } from "./storedJson.ts";

/** Where an artist's radio starts: the `next` request their page's Start radio makes. */
export interface YtRadioStart {
  readonly playlistId: string;
  /** What the button sends with it; null when it sends nothing (the app sends Start radio's own). */
  readonly params: string | null;
}

/** The radio starts remembered, by artist page (browse id, `UC…`), the latest last. */
export type ArtistRadioStarts = ReadonlyMap<string, YtRadioStart>;

export const NO_ARTIST_RADIO_STARTS: ArtistRadioStarts = new Map();

/** How many artists' starts are kept: the ones whose radio started last. */
const STARTS_KEPT = 500;

/** Where the radio of the artist whose page is [browseId] starts, as remembered; null when it isn't. */
export const artistRadioStart = (
  starts: ArtistRadioStarts,
  browseId: string,
): YtRadioStart | null => starts.get(browseId) ?? null;

/**
 * [starts] with [browseId]'s radio starting at [start] now (the latest), or
 * without it when [start] is null (YouTube Music refused it, or the page has
 * no Start radio).
 */
export const withArtistRadioStart = (
  starts: ArtistRadioStarts,
  browseId: string,
  start: YtRadioStart | null,
): ArtistRadioStarts => {
  const next = new Map(starts);
  next.delete(browseId);
  if (start !== null) next.set(browseId, start);
  return new Map([...next].slice(-STARTS_KEPT));
};

/** What to save for [starts]; null (nothing saved) for none. */
export const storedArtistRadioStarts = (starts: ArtistRadioStarts): string | null =>
  starts.size === 0
    ? null
    : JSON.stringify({
        version: 1,
        starts: [...starts].map(([browseId, { playlistId, params }]) => [
          browseId,
          playlistId,
          params,
        ]),
      });

/** The starts [stored] holds; none when nothing readable is saved. */
export const parseArtistRadioStarts = (stored: string | null): ArtistRadioStarts => {
  const { version, starts } = readStoredRecord(stored);
  if (version !== 1 || !Array.isArray(starts)) return NO_ARTIST_RADIO_STARTS;
  return new Map(
    starts.flatMap((entry: unknown): (readonly [string, YtRadioStart])[] => {
      if (!Array.isArray(entry) || isRecord(entry)) return [];
      const [browseId, playlistId, params] = entry as unknown[];
      if (typeof browseId !== "string" || typeof playlistId !== "string" || playlistId === "")
        return [];
      return [[browseId, { playlistId, params: typeof params === "string" ? params : null }]];
    }),
  );
};
