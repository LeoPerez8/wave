import {
  GENIUS_LYRICS_SEARCH_PREVIEW,
  uniqueGeniusLyricsHits,
  type GeniusLyricsHit,
  type SongLookup,
} from "@wave/core";

/**
 * What Search's online lyrics section shows for a query (`window.wave.lyrics.searchOnline`):
 * Genius's whole answer, a line with its action, or nothing (`disabled` with "Genius insights"
 * off or no Wave account in this build, `idle` for a query of fewer than three words).
 */
export type GeniusLyricsSearchView =
  | { readonly status: "disabled" | "idle" | "signedOut" | "offline" | "failed" }
  | { readonly status: "hits"; readonly hits: readonly GeniusLyricsHit[] };

/** What a click on a hit did: it plays, its Genius page opened, or neither could happen. */
export type GeniusHitOpened = "played" | "opened" | "failed";

/**
 * The hits the section lists: Genius's [hits] without the songs Search's Lyrics rows already
 * show ([shown]), five until Show all ([expanded]), which lists up to twenty.
 */
export const onlineLyricsRows = (
  hits: readonly GeniusLyricsHit[],
  shown: readonly SongLookup[],
  expanded: boolean,
): {
  readonly rows: readonly GeniusLyricsHit[];
  readonly total: number;
  readonly more: boolean;
} => {
  const unique = uniqueGeniusLyricsHits(hits, shown);
  const rows = expanded ? unique : unique.slice(0, GENIUS_LYRICS_SEARCH_PREVIEW);
  return { rows, total: unique.length, more: rows.length < unique.length };
};
