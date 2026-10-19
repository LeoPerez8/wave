/**
 * The similar artists the harvest read (docs/spec.md, "Artist mixes"): the
 * artists a Library artist's YouTube Music page lists as "Fans might also
 * like", kept on the phone by the Library artist's name, so Artist mixes
 * build with similar artists offline. Not synced.
 */

import type { DiscoverSimilarArtist } from "./discoverMixes.ts";
import { identityKey } from "./library.ts";
import { isRecord, readStoredRecord } from "./storedJson.ts";

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
): SimilarArtistsKept => {
  const next = new Map(kept);
  const key = identityKey(of);
  next.delete(key);
  next.set(key, artists);
  return new Map([...next].slice(-KEPT));
};

/** The similar artists [name]'s page listed, as kept; undefined when it was never read. */
export const similarArtistsKeptOf = (
  kept: SimilarArtistsKept,
  name: string,
): readonly DiscoverSimilarArtist[] | undefined => kept.get(identityKey(name));

/** What to save for [kept]; null (nothing saved) for none. */
export const storedSimilarArtistsKept = (kept: SimilarArtistsKept): string | null =>
  kept.size === 0
    ? null
    : JSON.stringify({
        version: 1,
        artists: [...kept].map(([key, artists]) => [
          key,
          artists.map(({ name, browseId }) => [name, browseId]),
        ]),
      });

/** The similar artists [stored] holds; none when nothing readable is saved. */
export const parseSimilarArtistsKept = (stored: string | null): SimilarArtistsKept => {
  const { version, artists } = readStoredRecord(stored);
  if (version !== 1 || !Array.isArray(artists)) return NO_SIMILAR_ARTISTS_KEPT;
  return new Map(
    artists.flatMap((entry: unknown): (readonly [string, DiscoverSimilarArtist[]])[] => {
      if (!Array.isArray(entry) || isRecord(entry)) return [];
      const [key, list] = entry as unknown[];
      if (typeof key !== "string" || !Array.isArray(list)) return [];
      return [
        [
          key,
          list.flatMap((artist: unknown): DiscoverSimilarArtist[] => {
            if (!Array.isArray(artist)) return [];
            const [name, browseId] = artist as unknown[];
            return typeof name === "string" && typeof browseId === "string"
              ? [{ name, browseId }]
              : [];
          }),
        ],
      ];
    }),
  );
};
