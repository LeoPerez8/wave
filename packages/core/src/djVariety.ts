/**
 * Artist variety (docs/spec.md, DJ): who a batch of a DJ session may hold,
 * by how far their artists are from the selected ones in the artist graph.
 */
import { artistNeighbourhood, type ArtistGraph } from "./artistGraph.ts";
import { djRadioSongAllowed } from "./dj.ts";
import type { DjVariety } from "./djSettings.ts";
import { isDisliked, NO_DISLIKES, type DislikedSongs } from "./dislikes.ts";
import type { GenreProfileOf } from "./genreAffinity.ts";
import { magicArtistKey, type MagicSession } from "./magicQueue.ts";
import { finishSteps, sortSteps } from "./buildSteps.ts";
import {
  magicLearnedExtrasSteps,
  magicRadioEligibleSteps,
  magicRadioExclusions,
} from "./magicRadioLearning.ts";
import type { RankedRadioSong } from "./radioRanking.ts";
import type { YtAlbumSong } from "./ytDiscover.ts";
import { ytTrackId } from "./ytMusic.ts";

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
 * How far the closest of [artists] (Magic Queue keys) is from [session]'s
 * selected artists in [graph]: 0 for a selected one, `OUTSIDE` for one the
 * graph doesn't reach within two hops.
 */
const djArtistHops = (
  session: MagicSession,
  graph: ArtistGraph | null,
): ((artists: readonly string[]) => number) => {
  const hops = new Map<string, number>();
  for (const name of session.radioArtists) hops.set(magicArtistKey(name), 0);
  if (graph !== null)
    for (const neighbour of artistNeighbourhood(graph, session.radioArtists)) {
      const key = magicArtistKey(neighbour.name);
      if (!hops.has(key)) hops.set(key, neighbour.hops);
    }
  return (artists) => Math.min(OUTSIDE, ...artists.map((artist) => hops.get(artist) ?? OUTSIDE));
};

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
): DjCandidatePools<S> => finishSteps(djVarietyCandidatesSteps(session, graph, pools, size));

/** A pool's songs, each one's hops and whether a batch can take it, and the pass that took it. */
interface VarietyPool<S> {
  readonly songs: readonly S[];
  readonly distances: readonly number[];
  readonly usable: readonly boolean[];
  /** The pass that took each song, by its place in [songs]. */
  readonly taken: Map<number, number>;
}

/** `djVarietyCandidates`, a step per candidate and pass, for a background slice (#1448). */
export function* djVarietyCandidatesSteps<S extends RankedRadioSong>(
  session: MagicSession,
  graph: ArtistGraph | null,
  pools: DjCandidatePools<S>,
  size = 0,
): Generator<void, DjCandidatePools<S>> {
  if (session.dj === undefined) return pools;
  const hopsOf = djArtistHops(session, graph);
  const eligible = yield* magicRadioEligibleSteps(session, [...pools.seed, ...pools.liked]);
  const extras = new Set(yield* magicLearnedExtrasSteps(pools.seed, pools.liked));
  const reach = REACH[session.dj.variety];
  const once = session.dj.variety === "high";
  const held = new Set<string>();
  function* pool(
    songs: readonly S[],
    usable: (song: S) => boolean,
  ): Generator<void, VarietyPool<S>> {
    const distances: number[] = [];
    const usables: boolean[] = [];
    for (const song of songs) {
      distances.push(hopsOf(song.artists));
      usables.push(usable(song));
      yield;
    }
    return { songs, distances, usable: usables, taken: new Map() };
  }
  const seed = yield* pool(pools.seed, eligible);
  const liked = yield* pool(pools.liked, (song) => eligible(song) && extras.has(song));
  let pass = 0;
  let count = 0;
  /** Takes the songs from [from] to [to] hops out, in ranked order, while fewer than [limit] usable ones are taken. */
  function* take(from: number, to: number, limit: number, unique: boolean): Generator<void> {
    pass++;
    for (const each of [seed, liked])
      for (const [at, song] of each.songs.entries()) {
        if (count >= limit) return;
        yield;
        if (each.taken.has(at) || each.distances[at]! < from || each.distances[at]! > to) continue;
        if (unique && song.artists.some((artist) => held.has(artist))) continue;
        each.taken.set(at, pass);
        if (each.usable[at]) count++;
        for (const artist of song.artists) held.add(artist);
      }
  }
  yield* take(0, reach, Infinity, once);
  for (let hop = reach + 1; hop <= OUTSIDE; hop++) yield* take(hop, hop, size, once);
  if (once) for (let hop = 0; hop <= OUTSIDE; hop++) yield* take(hop, hop, size, false);
  function* kept(each: VarietyPool<S>): Generator<void, S[]> {
    const order = yield* sortSteps(
      [...each.taken.entries()],
      ([a, passA], [b, passB]) => passA - passB || a - b,
    );
    return order.map(([at]) => each.songs[at]!);
  }
  return { seed: yield* kept(seed), liked: yield* kept(liked) };
}

/**
 * The song of the radio [radioId]'s page [songs] that starts a DJ queue
 * before its first batch is read: the first one that batch could take. Not a
 * video, not [disliked], not played or learned from yet
 * (`magicRadioEligible`), on a family tile's radio of its family
 * (`djRadioSongAllowed`), and within the Artist variety's reach of the
 * selected artists in [graph] (Low: a selected artist's song). With none in
 * reach, the nearest, as the batch fills (`djVarietyCandidates`). Null when
 * the page has no song the batch could take.
 */
export const djFirstRadioSong = <S extends YtAlbumSong & { readonly video?: boolean }>(
  session: MagicSession,
  radioId: string,
  songs: readonly S[],
  {
    profileOf,
    graph = null,
    disliked = NO_DISLIKES,
  }: {
    readonly profileOf: GenreProfileOf;
    readonly graph?: ArtistGraph | null;
    readonly disliked?: DislikedSongs;
  },
): S | null => {
  const exclude = magicRadioExclusions(session, songs);
  const reach = session.dj === undefined ? OUTSIDE : REACH[session.dj.variety];
  const hopsOf = djArtistHops(session, graph);
  let nearest: { readonly song: S; readonly hops: number } | null = null;
  for (const song of songs) {
    if (
      song.video === true ||
      exclude.has(ytTrackId(song.videoId)) ||
      isDisliked(disliked, { videoId: song.videoId }) ||
      !djRadioSongAllowed(session, radioId, song.artists, profileOf, graph)
    )
      continue;
    const hops = hopsOf(song.artists.map(magicArtistKey));
    if (hops <= reach) return song;
    if (nearest === null || hops < nearest.hops) nearest = { song, hops };
  }
  return nearest?.song ?? null;
};
