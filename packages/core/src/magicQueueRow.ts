/**
 * What Discover's Magic Queue row shows (docs/spec.md, "Discover's Magic
 * Queue row"): nine seeds drawn from the Library's songs with a file and the
 * YT Music entries of the owner's playlists (`randomMagicQueuePicks`), or,
 * while both are empty, nine streamed songs of the Artist mixes (the
 * cold-start ones seeded from YouTube Music's chart), so someone with
 * nothing to start from still gets songs to start a Magic Queue from.
 */

import type { BlendedDiscoverMix } from "./discoverMixLevels.ts";
import type { DiscoverMixesSection } from "./discoverMixesSection.ts";
import { MAGIC_QUEUE_PICKS } from "./magicQueueSection.ts";
import type { RandomSource } from "./weightedPick.ts";
import type { YtAlbumSong } from "./ytDiscover.ts";

/** A seed the row drew from its pool: a Library song ([T]) or a playlist's YT Music entry, streamed. */
export type MagicQueueSeed<T> =
  | { readonly source: "library"; readonly song: T }
  | { readonly source: "stream"; readonly song: YtAlbumSong };

/** What the row draws. */
export type MagicQueueRow<T> =
  | { readonly kind: "hidden" }
  /** Placeholder tiles in the row's grid: the first mixes are on their way. */
  | { readonly kind: "skeleton" }
  /** Library songs and playlist entries, as Home read them. */
  | { readonly kind: "seeds"; readonly seeds: readonly MagicQueueSeed<T>[] }
  /** Songs of these mixes (`magicQueueMixPicks`): the pool is empty. */
  | { readonly kind: "mixes"; readonly mixes: readonly BlendedDiscoverMix[] };

/**
 * What the row shows: nothing while YT Music is off ([ytMusic]) or before
 * its pool is read ([seeds] null); the seeds drawn from the Library's files
 * and the playlists' YT Music entries when there are any; else songs of the
 * Artist mixes seeded from YouTube Music's chart ([artistMixes], what their
 * row shows; a mix seeded from plays or similar artists stays out): a
 * skeleton while the first ones build, nothing when there are none or none
 * has a streamed song to start from.
 */
export const magicQueueRow = <T>({
  ytMusic,
  seeds,
  artistMixes,
}: {
  readonly ytMusic: boolean;
  readonly seeds: readonly MagicQueueSeed<T>[] | null;
  readonly artistMixes: DiscoverMixesSection;
}): MagicQueueRow<T> => {
  if (!ytMusic || seeds === null) return { kind: "hidden" };
  if (seeds.length > 0) return { kind: "seeds", seeds };
  if (artistMixes.kind === "skeleton") return { kind: "skeleton" };
  if (artistMixes.kind !== "mixes") return { kind: "hidden" };
  const chart = artistMixes.mixes.filter((mix) => mix.seed.from === "chart");
  if (!chart.some((mix) => streamedOf(mix).length > 0)) return { kind: "hidden" };
  return { kind: "mixes", mixes: chart };
};

/** The mixes' songs the row shows, and the mixes they were picked from. */
export interface MagicQueueMixPicks {
  readonly mixes: readonly BlendedDiscoverMix[];
  readonly songs: readonly YtAlbumSong[];
}

/** What the row draws, its mixes' songs picked (`magicQueueShown`). */
export type MagicQueueShown<T> =
  | Exclude<MagicQueueRow<T>, { readonly kind: "mixes" }>
  | { readonly kind: "mixes"; readonly songs: readonly YtAlbumSong[] };

/** Whether [a] and [b] are the same mixes, in the same order. */
const sameMixes = (a: readonly BlendedDiscoverMix[], b: readonly BlendedDiscoverMix[]): boolean =>
  a.length === b.length && a.every((mix, place) => mix === b[place]);

/**
 * What the row draws for [row] (`magicQueueRow`), given the songs it last
 * picked from the mixes ([picked], null for a fresh draw: a new visit). The
 * same picks while the mixes are the same ones; mixes rebuilt or re-ranked
 * keep the songs still in them in their places and fill the others
 * (`magicQueueMixPicks`, [random]). Hidden when the mixes give no song.
 * [picks] is what to pass the next time.
 */
export const magicQueueShown = <T>(
  row: MagicQueueRow<T>,
  picked: MagicQueueMixPicks | null,
  random: RandomSource,
): { readonly shown: MagicQueueShown<T>; readonly picks: MagicQueueMixPicks | null } => {
  if (row.kind !== "mixes") return { shown: row, picks: picked };
  const picks =
    picked !== null && sameMixes(picked.mixes, row.mixes)
      ? picked
      : {
          mixes: row.mixes,
          songs: magicQueueMixPicks(
            row.mixes,
            random,
            (picked?.songs ?? []).map((song) => song.videoId),
          ),
        };
  return {
    shown: picks.songs.length === 0 ? { kind: "hidden" } : { kind: "mixes", songs: picks.songs },
    picks,
  };
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
