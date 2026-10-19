/**
 * The similar artists the harvest read (docs/spec.md, "Artist mixes"): the
 * artists a Library artist's YouTube Music page lists as "Fans might also
 * like", kept on the phone by the Library artist's name, so Artist mixes
 * build with similar artists offline. Not synced.
 */

import type { DiscoverSimilarArtist } from "./discoverMixes.ts";
import { identityKey } from "./library.ts";
import { readStoredTuples, storedTuples, withLatest } from "./storedJson.ts";

/** The similar artists read, by Library artist (`identityKey` of the name), the latest last. */
export type SimilarArtistsKept = ReadonlyMap<string, readonly DiscoverSimilarArtist[]>;

export const NO_SIMILAR_ARTISTS_KEPT: SimilarArtistsKept = new Map();

/** How many Library artists' similar artists are kept: the latest read. */
const KEPT = 100;

/** [kept] with [of]'s page listing [artists] now (the latest). */
export const withSimilarArtistsKept = (
  kept: SimilarArtistsKept,
  of: string,
  artists: readonly DiscoverSimilarArtist[],
): SimilarArtistsKept => withLatest(kept, identityKey(of), artists, KEPT);

/** The similar artists [name]'s page listed, as kept; undefined when it was never read. */
export const similarArtistsKeptOf = (
  kept: SimilarArtistsKept,
  name: string,
): readonly DiscoverSimilarArtist[] | undefined => kept.get(identityKey(name));

/** What to save for [kept]; null (nothing saved) for none. */
export const storedSimilarArtistsKept = (kept: SimilarArtistsKept): string | null =>
  storedTuples(kept, "artists", (key, artists) => [
    key,
    artists.map(({ name, browseId }) => [name, browseId]),
  ]);

/** [value] as a kept similar artist (`[name, browseId]`); null when it isn't one. */
const readSimilarArtist = (value: unknown): DiscoverSimilarArtist | null => {
  if (!Array.isArray(value)) return null;
  const [name, browseId] = value as readonly unknown[];
  return typeof name === "string" && typeof browseId === "string" ? { name, browseId } : null;
};

/** The similar artists [stored] holds; none when nothing readable is saved. */
export const parseSimilarArtistsKept = (stored: string | null): SimilarArtistsKept =>
  new Map(
    readStoredTuples(
      stored,
      "artists",
      ([key, list]): readonly [string, DiscoverSimilarArtist[]] | null =>
        typeof key === "string" && Array.isArray(list)
          ? [key, list.flatMap((artist: unknown) => readSimilarArtist(artist) ?? [])]
          : null,
    ),
  );
