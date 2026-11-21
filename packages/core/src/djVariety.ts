/**
 * Artist variety (docs/spec.md, DJ): who a batch of a DJ session may hold,
 * by how far their artists are from the selected ones in the artist graph.
 */
import { artistNeighbourhood, type ArtistGraph } from "./artistGraph.ts";
import type { DjVariety } from "./djSettings.ts";
import { magicArtistKey, type MagicSession, type MagicSong } from "./magicQueue.ts";

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
 * is left. So a graph that knows few artists, or none (null), doesn't leave
 * a batch empty. With no [size], nothing is filled.
 */
export const djVarietyCandidates = <S extends Pick<MagicSong, "artists">>(
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
  const songs = [...pools.seed, ...pools.liked];
  const distances = songs.map((song) =>
    Math.min(OUTSIDE, ...song.artists.map((artist) => hops.get(artist) ?? OUTSIDE)),
  );
  const reach = REACH[session.dj.variety];
  const once = session.dj.variety === "high";
  const taken = new Set<number>();
  const held = new Set<string>();
  /** Takes the songs from [from] to [to] hops out, in ranked order, while fewer than [limit] are taken. */
  const take = (from: number, to: number, limit: number, unique: boolean): void => {
    for (const [at, song] of songs.entries()) {
      if (taken.size >= limit) return;
      if (taken.has(at) || distances[at]! < from || distances[at]! > to) continue;
      if (unique && song.artists.some((artist) => held.has(artist))) continue;
      taken.add(at);
      for (const artist of song.artists) held.add(artist);
    }
  };
  take(0, reach, Infinity, once);
  for (let hop = reach + 1; hop <= OUTSIDE; hop++) take(hop, hop, size, once);
  if (once) for (let hop = 0; hop <= OUTSIDE; hop++) take(hop, hop, size, false);
  return {
    seed: pools.seed.filter((_, at) => taken.has(at)),
    liked: pools.liked.filter((_, at) => taken.has(pools.seed.length + at)),
  };
};
