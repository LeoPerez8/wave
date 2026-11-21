/**
 * Discoveries, the Magic Queue carousel's third page (docs/spec.md,
 * "Discover's Magic Queue carousel"): songs the owner has never played, from
 * what the phone already keeps. The candidate catalog comes first, ranked by
 * the Taste profile, then the Library's unplayed songs. `carouselPageSongs`
 * cuts the page.
 */

import type { CatalogSong } from "./candidateCatalog.ts";
import type { MagicSong } from "./magicQueue.ts";
import type { MagicQueueSeed } from "./magicQueueRow.ts";
import { tasteWeight, type TasteProfile } from "./tasteProfile.ts";

/** A candidate catalog song with what the Taste profile weighs of it (its queue track id too). */
export interface DiscoveryCatalogSong {
  readonly entry: CatalogSong;
  readonly magic: MagicSong;
}

/** A Library song ([T]) with what the Taste profile weighs of it (its queue track id too). */
export interface DiscoveryLibrarySong<T> {
  readonly song: T;
  readonly magic: MagicSong;
}

export interface DiscoveriesInput<T> {
  /** The candidate catalog. */
  readonly catalog: readonly DiscoveryCatalogSong[];
  /** The Library's songs that can play. */
  readonly library: readonly DiscoveryLibrarySong<T>[];
  /** The queue track id of every song with a counted play, ever. */
  readonly played: ReadonlySet<string>;
  /** The owner's Taste profile, or null when none is derived: every song then weighs the same. */
  readonly taste: TasteProfile | null;
  /**
   * The queue track ids of disliked songs, which never appear. Nothing fills
   * it until the Dislike feature exists.
   */
  readonly disliked?: ReadonlySet<string>;
}

/** [songs] the page may show, each once, the best liked first; [tie] orders equal weights. */
const ranked = <S extends { readonly magic: MagicSong }>(
  songs: readonly S[],
  { played, taste, disliked }: DiscoveriesInput<unknown>,
  tie: (a: S, b: S) => number,
): S[] => {
  const seen = new Set<string>();
  const weighed: { readonly song: S; readonly weight: number; readonly place: number }[] = [];
  for (const song of songs) {
    const { trackId } = song.magic;
    if (played.has(trackId) || disliked?.has(trackId) === true || seen.has(trackId)) continue;
    seen.add(trackId);
    weighed.push({
      song,
      weight: taste === null ? 1 : tasteWeight(taste, song.magic),
      place: weighed.length,
    });
  }
  return (
    weighed
      // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh copy; Hermes lacks toSorted
      .sort((a, b) => b.weight - a.weight || tie(a.song, b.song) || a.place - b.place)
      .map(({ song }) => song)
  );
};

/**
 * Every song Discoveries may show, in the page's order: the candidate
 * catalog's songs without a counted play, the ones the Taste profile likes
 * most first (then those more radios brought, then the ones seen latest),
 * followed by the Library's unplayed songs, ranked by the profile too (then
 * in the order given). A song with a counted play never appears, nor a
 * disliked one. Every ranked song comes back, so the caller can pass over one
 * it can't show before `carouselPageSongs` cuts the page.
 */
export const discoveries = <T>(input: DiscoveriesInput<T>): MagicQueueSeed<T>[] => [
  ...ranked(
    input.catalog,
    input,
    (a, b) =>
      b.entry.radios.length - a.entry.radios.length || b.entry.lastSeenAt - a.entry.lastSeenAt,
  ).map(({ entry }) => ({ source: "stream" as const, song: entry.song })),
  ...ranked(input.library, input, () => 0).map(({ song }) => ({
    source: "library" as const,
    song,
  })),
];
