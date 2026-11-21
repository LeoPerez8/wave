/**
 * Artist variety (docs/spec.md, DJ): who a batch of a DJ session may hold,
 * by how far their artists are from the selected ones in the artist graph.
 */
import { artistNeighbourhood, type ArtistGraph } from "./artistGraph.ts";
import type { DjVariety } from "./djSettings.ts";
import { magicArtistKey, type MagicSession } from "./magicQueue.ts";
import { magicLearnedExtras, magicRadioEligible } from "./magicRadioLearning.ts";
import type { RankedRadioSong } from "./radioRanking.ts";

/** The candidates a batch is picked from: the seed's radios' and the learned radios'. */
export interface DjCandidatePools<S> {
  readonly seed: readonly S[];
  readonly liked: readonly S[];
}

/** How many hops from the selected artists each step allows. */
const REACH: { readonly [K in DjVariety]: number } = { low: 0, medium: 1, high: 2 };

/** Where an artist the graph doesn't reach within two hops stands. */
const OUTSIDE = 3;

/**
 * The candidates a batch of [session] may hold, each pool in its ranked
 * order. Any session but a DJ one keeps [pools] as they are. A DJ session's
 * Artist variety limits them by their artists' distance from the selected
 * ones (the session's radio artists) in [graph]:
 *
 * - Low: songs by a selected artist.
 * - Medium: those, and songs by their direct neighbours.
 * - High: the two-hop neighbourhood, with no artist credited on two songs.
 *
 * A song counts by the closest artist it credits. With fewer allowed songs
 * than [size], the rest is filled with the songs of the next hop out, then
 * the one after, then artists outside the neighbourhood; High fills with
 * artists it doesn't hold yet first, and repeats one only when nothing else
 * is left. The fill counts only the songs a batch can take: not played or
 * learned from yet, and in the liked pool not a recording the seed's radios
 * brought too. A batch of [size] picked from both pools then comes out whole
 * whatever its liked share and New music share. A filled song ranks behind
 * the allowed ones, and a farther fill behind a nearer one. So a graph that
 * knows few artists, or none (null), doesn't leave a batch short. With no
 * [size], nothing is filled.
 */
export const djVarietyCandidates = <S extends RankedRadioSong>(
  session: MagicSession,
  graph: ArtistGraph | null,
  pools: DjCandidatePools<S>,
  size = 0,
): DjCandidatePools<S> => {
  if (session.dj === undefined) return pools;
  const hops = new Map<string, number>();
  for (const name of session.radioArtists) hops.set(magicArtistKey(name), 0);
  if (graph !== null)
    for (const neighbour of artistNeighbourhood(graph, session.radioArtists)) {
      const key = magicArtistKey(neighbour.name);
      if (!hops.has(key)) hops.set(key, neighbour.hops);
    }
  const distance = (song: S): number =>
    Math.min(OUTSIDE, ...song.artists.map((artist) => hops.get(artist) ?? OUTSIDE));
  const eligible = magicRadioEligible(session, [...pools.seed, ...pools.liked]);
  const extras = new Set(magicLearnedExtras(pools.seed, pools.liked));
  const reach = REACH[session.dj.variety];
  const once = session.dj.variety === "high";
  const held = new Set<string>();
  const pool = (songs: readonly S[], usable: (song: S) => boolean) => ({
    songs,
    distances: songs.map(distance),
    usable: songs.map(usable),
    /** The pass that took each song, by its place in [songs]. */
    taken: new Map<number, number>(),
  });
  const seed = pool(pools.seed, eligible);
  const liked = pool(pools.liked, (song) => eligible(song) && extras.has(song));
  let pass = 0;
  let count = 0;
  /** Takes the songs from [from] to [to] hops out, in ranked order, while fewer than [limit] usable ones are taken. */
  const take = (from: number, to: number, limit: number, unique: boolean): void => {
    pass++;
    for (const each of [seed, liked])
      for (const [at, song] of each.songs.entries()) {
        if (count >= limit) return;
        if (each.taken.has(at) || each.distances[at]! < from || each.distances[at]! > to) continue;
        if (unique && song.artists.some((artist) => held.has(artist))) continue;
        each.taken.set(at, pass);
        if (each.usable[at]) count++;
        for (const artist of song.artists) held.add(artist);
      }
  };
  take(0, reach, Infinity, once);
  for (let hop = reach + 1; hop <= OUTSIDE; hop++) take(hop, hop, size, once);
  if (once) for (let hop = 0; hop <= OUTSIDE; hop++) take(hop, hop, size, false);
  const kept = (each: typeof seed): S[] =>
    [...each.taken.entries()]
      .sort(([a, passA], [b, passB]) => passA - passB || a - b)
      .map(([at]) => each.songs[at]!);
  return { seed: kept(seed), liked: kept(liked) };
};
