/**
 * An artist's Library songs ranked by their place in the artist's YouTube Music
 * song list (docs/spec.md, Artist page, "Popular"): the list comes in
 * YouTube Music's popularity order. A Library song is matched to the list's
 * songs as the artist page matches YouTube Music's songs to the Library's
 * (`libraryMatches`).
 */

import { libraryMatches, type LibrarySongKey, type YtSong } from "./ytMusic.ts";

/**
 * [songs] with each one's `popularRank`: its place in [popular] (1 is the
 * first song of the list), or undefined when the list doesn't hold it. A
 * song the list names twice keeps its higher place. Ranks are places in the
 * list, so they can skip where the list holds songs the Library lacks.
 */
export const rankPopular = <S extends LibrarySongKey>(
  songs: readonly S[],
  popular: readonly YtSong[],
): (S & { readonly popularRank: number | undefined })[] => {
  const matches = libraryMatches(songs);
  const ranks = new Map<S, number>();
  popular.forEach((song, index) => {
    for (const match of matches(song)) if (!ranks.has(match)) ranks.set(match, index + 1);
  });
  return songs.map((song) => ({ ...song, popularRank: ranks.get(song) }));
};
