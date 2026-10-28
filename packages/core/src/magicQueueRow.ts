/**
 * What Discover's Magic Queue row shows (docs/spec.md, "Discover's Magic
 * Queue row"): nine of the Library's songs with a file, or, while the
 * Library has none, nine streamed songs of the Artist mixes (the cold-start
 * ones seeded from YouTube Music's chart), so someone with nothing to start
 * from still gets songs to start a Magic Queue from.
 */

import type { BlendedDiscoverMix } from "./discoverMixLevels.ts";
import type { DiscoverMixesSection } from "./discoverMixesSection.ts";
import { MAGIC_QUEUE_PICKS } from "./magicQueueSection.ts";
import type { RandomSource } from "./weightedPick.ts";
import type { YtAlbumSong } from "./ytDiscover.ts";

/** What the row draws. */
export type MagicQueueRow<T> =
  | { readonly kind: "hidden" }
  /** Placeholder tiles in the row's grid: the first mixes are on their way. */
  | { readonly kind: "skeleton" }
  /** The Library's songs, as Home read them. */
  | { readonly kind: "library"; readonly songs: readonly T[] }
  /** Songs of these mixes (`magicQueueMixPicks`): the Library has none to show. */
  | { readonly kind: "mixes"; readonly mixes: readonly BlendedDiscoverMix[] };

/**
 * What the row shows: nothing while YT Music is off ([ytMusic]) or before
 * the Library's songs are read ([library] null); the Library's songs when it
 * has any; else songs of the Artist mixes ([artistMixes], what their row
 * shows): a skeleton while the first ones build, nothing when there are none
 * or none has a streamed song to start from.
 */
export const magicQueueRow = <T>({
  ytMusic,
  library,
  artistMixes,
}: {
  readonly ytMusic: boolean;
  readonly library: readonly T[] | null;
  readonly artistMixes: DiscoverMixesSection;
}): MagicQueueRow<T> => {
  if (!ytMusic || library === null) return { kind: "hidden" };
  if (library.length > 0) return { kind: "library", songs: library };
  if (artistMixes.kind === "skeleton") return { kind: "skeleton" };
  if (artistMixes.kind !== "mixes" || !artistMixes.mixes.some((mix) => streamedOf(mix).length > 0))
    return { kind: "hidden" };
  return { kind: "mixes", mixes: artistMixes.mixes };
};

/** [mix]'s songs that stream, in its order. */
const streamedOf = (mix: BlendedDiscoverMix): YtAlbumSong[] =>
  mix.songs.flatMap((song) => (song.source === "stream" ? [song.song] : []));

/**
 * Nine of [mixes]' streamed songs, a video once, spread over the mixes:
 * each place goes to a mix that gave the fewest so far ([random] among
 * them), then to one of its songs at random. Fewer songs, every one. Pass the
 * row's [previous] videos to keep those still in the mixes in their places
 * (a rebuild or a re-rank), filling the others; omit it for a fresh draw.
 */
export const magicQueueMixPicks = (
  mixes: readonly BlendedDiscoverMix[],
  random: RandomSource,
  previous: readonly string[] = [],
): YtAlbumSong[] => {
  const seen = new Set<string>();
  const pools = mixes.map((mix) =>
    streamedOf(mix).filter((song) => {
      if (seen.has(song.videoId)) return false;
      seen.add(song.videoId);
      return true;
    }),
  );
  const mixOf = new Map(
    pools.flatMap((pool, place) => pool.map((song) => [song.videoId, { song, place }] as const)),
  );
  const before = [...new Set(previous)].slice(0, MAGIC_QUEUE_PICKS);
  const given = pools.map(() => 0);
  const taken = new Set<string>();
  for (const videoId of before) {
    const known = mixOf.get(videoId);
    if (known === undefined) continue;
    given[known.place]!++;
    taken.add(videoId);
  }
  const left = pools.map((pool) => pool.filter((song) => !taken.has(song.videoId)));
  const added: YtAlbumSong[] = [];
  const count = Math.min(MAGIC_QUEUE_PICKS, mixOf.size) - taken.size;
  for (let place = 0; place < count; place++) {
    const open = left.flatMap((pool, mix) => (pool.length > 0 ? [mix] : []));
    const fewest = Math.min(...open.map((mix) => given[mix]!));
    const ties = open.filter((mix) => given[mix] === fewest);
    const mix = ties[Math.floor(random() * ties.length)]!;
    const pool = left[mix]!;
    const [song] = pool.splice(Math.floor(random() * pool.length), 1);
    given[mix]!++;
    added.push(song!);
  }
  let next = 0;
  const kept = before.flatMap((videoId) => {
    const known = mixOf.get(videoId);
    if (known !== undefined) return [known.song];
    return next < added.length ? [added[next++]!] : [];
  });
  return [...kept, ...added.slice(next)];
};
