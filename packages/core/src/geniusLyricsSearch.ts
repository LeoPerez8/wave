/** Genius's role in Search's Lyrics section (ticket #1097). */

import { normalizeSearchText } from "./search.ts";
import type { GeniusLyricsHit } from "./genius.ts";
import { isSameSong, titleName, type SongLookup } from "./lyricsAndGenre.ts";

export const GENIUS_LYRICS_SEARCH_DELAY_MS = 300;
export const GENIUS_LYRICS_SEARCH_LIMIT = 20;
export const GENIUS_LYRICS_SEARCH_PREVIEW = 5;

export interface GeniusLyricsSearchRequest {
  readonly query: string;
  readonly delayMs: number;
}

/** An eligible query waits for a typing pause; fewer than three words or the switch being off asks nothing. */
export const geniusLyricsSearchRequest = (
  query: string,
  enabled: boolean,
): GeniusLyricsSearchRequest | null => {
  const trimmed = query.trim();
  if (!enabled || normalizeSearchText(trimmed).split(" ").filter(Boolean).length < 3) return null;
  return { query: trimmed, delayMs: GENIUS_LYRICS_SEARCH_DELAY_MS };
};

/**
 * Genius's [hits] without the songs Search's Lyrics rows already [shown]. A song shown only in
 * Songs, Library or streamed, keeps its Genius hit (#1111, #1115).
 */
export const uniqueGeniusLyricsHits = (
  hits: readonly GeniusLyricsHit[],
  shown: readonly SongLookup[],
): GeniusLyricsHit[] => {
  const shownByTitle = new Map<string, SongLookup[]>();
  for (const song of shown) {
    const title = titleName(song.title);
    const matches = shownByTitle.get(title) ?? [];
    matches.push(song);
    shownByTitle.set(title, matches);
  }
  return hits
    .filter(
      (hit) =>
        !shownByTitle
          .get(titleName(hit.title))
          ?.some(
            (song) =>
              isSameSong(song, hit.title, hit.artist) || isSameSong(song, hit.title, hit.credit),
          ),
    )
    .slice(0, GENIUS_LYRICS_SEARCH_LIMIT);
};

/** A query's online outcome, kept distinct so the Search section can render each state. */
export type GeniusLyricsSearchState =
  | { readonly query: string; readonly status: "idle" | "disabled" }
  | { readonly query: string; readonly status: "loading" }
  | { readonly query: string; readonly status: "hits"; readonly hits: readonly GeniusLyricsHit[] }
  | { readonly query: string; readonly status: "signedOut" | "failed" | "offline" };

/** A result only settles the matching request; a late reply cannot replace a newer query. */
export const settleGeniusLyricsSearch = (
  current: GeniusLyricsSearchState,
  query: string,
  outcome:
    | { readonly status: "hits"; readonly hits: readonly GeniusLyricsHit[] }
    | { readonly status: "signedOut" | "failed" | "offline" },
): GeniusLyricsSearchState =>
  current.query !== query || current.status !== "loading" ? current : { query, ...outcome };
