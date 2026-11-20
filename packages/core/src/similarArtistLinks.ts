/**
 * Fans might also like (docs/spec.md, "YT Music artist page"): the similar
 * artists an artist page lists, each with the page a tap opens.
 */

import type { YtArtistCandidate } from "./ytArtist.ts";

/** A similar artist on the shelf and the Library artist they are, or null without one. */
export interface SimilarArtistLink<A> {
  readonly artist: YtArtistCandidate;
  /** The Library's artist: a tap opens their Library page. Null: it opens the online page. */
  readonly library: A | null;
}

/**
 * [similar] in YouTube Music's order, each with the Library artist of that
 * name ([artistNamed], Core's `libraryArtistFinder`).
 */
export const similarArtistLinks = <A>(
  similar: readonly YtArtistCandidate[],
  artistNamed: (name: string) => A | null,
): SimilarArtistLink<A>[] =>
  similar.map((artist) => ({ artist, library: artistNamed(artist.name) }));
