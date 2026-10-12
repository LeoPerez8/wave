/**
 * Artist images: which local album cover stands for an artist (shown as a
 * circle wherever the artist appears).
 */

import { compareStrings } from "./library.ts";

/** An album an artist is linked to, as `artistArtwork` weighs it. */
export interface ArtistAlbumLink {
  readonly artistId: number;
  readonly albumId: number;
  /** Filed under the artist (they're its album artist), not just appearing on it. */
  readonly own: boolean;
  /** Own album: the songs on it. Appears on: the artist's songs on it. */
  readonly songs: number;
  readonly year: number | null;
  readonly titleSort: string;
  /** The album's cover (an artwork key); null when it has none. */
  readonly artwork: string | null;
}

/**
 * Whether [a] represents the artist better than [b]: own albums first, then
 * the most songs, then the album the artist page lists first (newest, undated
 * last, by title), then the album indexed first.
 */
const beats = (a: ArtistAlbumLink, b: ArtistAlbumLink): boolean => {
  if (a.own !== b.own) return a.own;
  const order =
    b.songs - a.songs ||
    (b.year ?? Number.MIN_SAFE_INTEGER) - (a.year ?? Number.MIN_SAFE_INTEGER) ||
    compareStrings(a.titleSort, b.titleSort) ||
    a.albumId - b.albumId;
  return order < 0;
};

/**
 * The image of each artist that has one (artist id → artwork key): the cover
 * of their own album with the most songs; with no own album that has a cover,
 * the album they appear on most. Artists with no cover anywhere are left out
 * (they get the initial placeholder).
 */
export const artistArtwork = (links: readonly ArtistAlbumLink[]): Map<number, string> => {
  const best = new Map<number, ArtistAlbumLink & { readonly artwork: string }>();
  for (const candidate of links) {
    const { artwork } = candidate;
    if (artwork === null) continue;
    const current = best.get(candidate.artistId);
    if (current === undefined || beats(candidate, current)) {
      best.set(candidate.artistId, { ...candidate, artwork });
    }
  }
  return new Map([...best].map(([artistId, chosen]) => [artistId, chosen.artwork]));
};

const LEADING_ARTICLE = /^(?:the|a|an) (?=\S)/iu;

/**
 * The letter on an artist's placeholder: the first letter or digit of the
 * name, upper-cased, skipping leading symbols and a leading "The" / "A" / "An"
 * (as the A–Z spine files it). Accents and non-Latin letters are kept; empty
 * when the name has no letter or digit.
 */
export const artistInitial = (name: string): string => {
  const text = name.normalize("NFC").replace(/^[^\p{L}\p{N}]+/u, "");
  const first = /[\p{L}\p{N}]/u.exec(text.replace(LEADING_ARTICLE, ""))?.[0];
  return first === undefined ? "" : first.toUpperCase();
};
