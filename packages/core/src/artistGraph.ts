/**
 * The artist graph (docs/spec.md, "Artist graph"): which artists are close
 * to which, derived from what Wave already keeps, with no request of its
 * own. An artist is close to another when YouTube Music's radio of one
 * plays the other's songs (the candidate catalog's radio evidence), when a
 * saved YT Music artist page lists the other among "Fans might also like",
 * and when the owner plays one after the other in a listening session.
 * Closeness goes both ways. The app derives the graph once per session; the
 * mix engine reads a seed's neighbourhood from it.
 */

import { catalogSeedKey, type CatalogSong } from "./candidateCatalog.ts";
import type { PlayEvent } from "./playEvents.ts";
import { tastePlaySignal } from "./tasteProfile.ts";
import type { YtArtistPage } from "./ytArtist.ts";

/** What the artist graph is derived from. */
export interface ArtistGraphSources {
  /** The candidate catalog: each song with the radios that brought it. */
  readonly catalog: readonly CatalogSong[];
  /** The saved YT Music artist pages: each artist with who "Fans might also like". */
  readonly pages: readonly Pick<YtArtistPage, "name" | "similar">[];
  /** The play history, in any order, each play with its song's artists. */
  readonly plays: readonly ArtistGraphPlay[];
}

/** A play on record as the artist graph reads it. */
export interface ArtistGraphPlay extends Pick<PlayEvent, "startedAt" | "listenedMs" | "endReason"> {
  /** The artists its song credits. */
  readonly artists: readonly string[];
}

/** One artist close to another. */
export interface ArtistNeighbour {
  /** The artist as the graph tells artists apart (`catalogSeedKey`). */
  readonly key: string;
  /** Their name, as last seen. */
  readonly name: string;
  /** How close, from 0 (not at all) to 1. */
  readonly closeness: number;
  /** How many hops out from the seeds: 1 for a neighbour, 2 for a neighbour's neighbour. */
  readonly hops: number;
}

/** Which artists are close to which: build it with `artistGraph`. */
export interface ArtistGraph {
  /** Each artist's neighbours by key, with their closeness. */
  readonly edges: ReadonlyMap<string, ReadonlyMap<string, number>>;
  /** Each artist's name by key. */
  readonly names: ReadonlyMap<string, string>;
}

/** Evidence from one source, by artist key, then neighbour key: a closeness from 0 to 1. */
type Evidence = Map<string, Map<string, number>>;

/** Records that [a] and [b] are [closeness] close by one source: the closer evidence stands. */
const note = (evidence: Evidence, a: string, b: string, closeness: number): void => {
  for (const [from, to] of [
    [a, b],
    [b, a],
  ] as const) {
    const of = evidence.get(from) ?? new Map<string, number>();
    of.set(to, Math.max(of.get(to) ?? 0, closeness));
    evidence.set(from, of);
  }
};

/** A count of [n] pieces of evidence as a closeness: one is half, each more halves the rest. */
const saturated = (n: number): number => 1 - 0.5 ** n;

/**
 * Radio co-occurrence: an artist whose songs a seed's radio brought is
 * close to the seed, the more songs the closer.
 */
const radioEvidence = (catalog: readonly CatalogSong[], names: Map<string, string>): Evidence => {
  const counts = new Map<string, Map<string, number>>();
  for (const { song, radios } of catalog) {
    const artists = new Set<string>();
    for (const name of song.artists) {
      const key = catalogSeedKey(name);
      if (key === null) continue;
      artists.add(key);
      names.set(key, name);
    }
    for (const radio of radios) {
      if (catalogSeedKey(radio.seedName) === null) continue;
      names.set(radio.seed, radio.seedName);
      const of = counts.get(radio.seed) ?? new Map<string, number>();
      for (const artist of artists)
        if (artist !== radio.seed) of.set(artist, (of.get(artist) ?? 0) + 1);
      counts.set(radio.seed, of);
    }
  }
  const evidence: Evidence = new Map();
  for (const [seed, of] of counts)
    for (const [artist, n] of of) note(evidence, seed, artist, saturated(n));
  return evidence;
};

/**
 * "Fans might also like": an artist a saved page lists as similar is close
 * to the page's artist, the earlier on the list the closer (the first fully,
 * the last a little over half).
 */
const similarEvidence = (
  pages: ArtistGraphSources["pages"],
  names: Map<string, string>,
): Evidence => {
  const evidence: Evidence = new Map();
  for (const page of pages) {
    const key = catalogSeedKey(page.name);
    const similar = page.similar ?? [];
    if (key === null) continue;
    names.set(key, page.name);
    similar.forEach((artist, rank) => {
      const other = catalogSeedKey(artist.name);
      if (other === null || other === key) return;
      names.set(other, artist.name);
      note(evidence, key, other, 1 - (0.5 * rank) / similar.length);
    });
  }
  return evidence;
};

/** A play further than this from the one before (from its end to this one's start) starts a new listening session: 30 minutes. */
export const ARTIST_SESSION_GAP_MS = 30 * 60_000;

/**
 * The owner's sessions: artists played one right after the other within a
 * listening session are close, the more often the closer, whichever came
 * first. A song skipped within its first 30 s (`tastePlaySignal`) says the
 * owner didn't want it there: it's left out.
 */
const sessionEvidence = (
  plays: readonly ArtistGraphPlay[],
  names: Map<string, string>,
): Evidence => {
  const counts = new Map<string, Map<string, number>>();
  const count = (a: string, b: string): void => {
    const [low, high] = a < b ? [a, b] : [b, a];
    const of = counts.get(low) ?? new Map<string, number>();
    of.set(high, (of.get(high) ?? 0) + 1);
    counts.set(low, of);
  };
  const heard = plays
    .filter((play) => tastePlaySignal(play) !== "skip")
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts the fresh array filter made; Hermes lacks toSorted
    .sort((a, b) => a.startedAt - b.startedAt);
  let before: { readonly endedAt: number; readonly artists: ReadonlySet<string> } | null = null;
  for (const play of heard) {
    const artists = new Set<string>();
    for (const name of play.artists) {
      const key = catalogSeedKey(name);
      if (key === null) continue;
      artists.add(key);
      names.set(key, name);
    }
    if (before !== null && play.startedAt - before.endedAt < ARTIST_SESSION_GAP_MS)
      for (const a of before.artists) for (const b of artists) if (a !== b) count(a, b);
    before = { endedAt: play.startedAt + play.listenedMs, artists };
  }
  const evidence: Evidence = new Map();
  for (const [a, of] of counts) for (const [b, n] of of) note(evidence, a, b, saturated(n));
  return evidence;
};

/** How much each source counts towards closeness. */
export interface ArtistGraphWeights {
  /** Radio co-occurrence. */
  readonly radio: number;
  /** A saved page's similar artists. */
  readonly similar: number;
  /** The owner's sessions. */
  readonly session: number;
}

/**
 * How much each source counts by default: YouTube Music's radios and pages
 * alike, the owner's sessions half as much (shuffle plays artists one after
 * the other that aren't close).
 */
export const ARTIST_GRAPH_WEIGHTS: ArtistGraphWeights = { radio: 1, similar: 1, session: 0.5 };

/**
 * The artist graph [sources] make: two artists' closeness adds up each
 * source's evidence, as much as [weights] say it counts, so it's 1 only
 * when every source says they're as close as can be. Names are matched as
 * the catalog matches seed artists (`catalogSeedKey`): one that isn't an
 * artist's ("Various Artists") never joins.
 */
export const artistGraph = (
  sources: ArtistGraphSources,
  weights: ArtistGraphWeights = ARTIST_GRAPH_WEIGHTS,
): ArtistGraph => {
  const names = new Map<string, string>();
  const evidence: [Evidence, number][] = [
    [radioEvidence(sources.catalog, names), weights.radio],
    [similarEvidence(sources.pages, names), weights.similar],
    [sessionEvidence(sources.plays, names), weights.session],
  ];
  const total = evidence.reduce((sum, [, weight]) => sum + weight, 0);
  const edges = new Map<string, Map<string, number>>();
  for (const [source, weight] of evidence) {
    if (weight <= 0) continue;
    for (const [artist, of] of source) {
      const combined = edges.get(artist) ?? new Map<string, number>();
      for (const [other, closeness] of of)
        combined.set(other, (combined.get(other) ?? 0) + (closeness * weight) / total);
      edges.set(artist, combined);
    }
  }
  return { edges, names };
};

/** [graph]'s neighbours of [name], closest first (by name on a tie); none for a name that isn't an artist's. */
export const artistNeighbours = (graph: ArtistGraph, name: string): ArtistNeighbour[] =>
  artistNeighbourhood(graph, [name], { hops: 1 });

/** How far out a neighbourhood goes by default: the seeds' neighbours and theirs. */
export const ARTIST_NEIGHBOURHOOD_HOPS = 2;

/** What each hop past the first keeps of the closeness its path adds up to. */
export const ARTIST_HOP_DECAY = 0.5;

/** How far out a neighbourhood goes. */
export interface ArtistNeighbourhoodOptions {
  /** How many hops out (`ARTIST_NEIGHBOURHOOD_HOPS`). */
  readonly hops?: number;
  /** What each hop past the first keeps (`ARTIST_HOP_DECAY`), from 0 to 1. */
  readonly decay?: number;
}

/** [closeness]'s artists as neighbours [hops] out, closest first (by key on a tie). */
const ranked = (
  graph: ArtistGraph,
  closeness: ReadonlyMap<string, number>,
  hops: number,
): ArtistNeighbour[] =>
  [...closeness]
    .map(([key, value]) => ({ key, name: graph.names.get(key) ?? key, closeness: value, hops }))
    // oxlint-disable-next-line unicorn/no-array-sort -- sorts the fresh array map made; Hermes lacks toSorted
    .sort((a, b) => b.closeness - a.closeness || (a.key < b.key ? -1 : 1));

/**
 * The artists around [seeds] in [graph], closest first, the seeds left out:
 * their neighbours (one hop out), then those neighbours' (two hops), as many
 * hops out as [options] say. An artist is as close as the closest path from
 * a seed makes them: its closenesses multiplied, each hop past the first
 * keeping [decay] of it. Every artist of a hop ranks below every artist of
 * the hop before: when a hop's closest would reach the one before's least
 * close, the whole hop is scaled down below it. A seed that isn't an
 * artist's ("Various Artists") has no neighbourhood.
 */
export const artistNeighbourhood = (
  graph: ArtistGraph,
  seeds: readonly string[],
  { hops = ARTIST_NEIGHBOURHOOD_HOPS, decay = ARTIST_HOP_DECAY }: ArtistNeighbourhoodOptions = {},
): ArtistNeighbour[] => {
  const reached = new Set<string>();
  let frontier = new Map<string, number>();
  for (const seed of seeds) {
    const key = catalogSeedKey(seed);
    if (key === null) continue;
    reached.add(key);
    frontier.set(key, 1);
  }
  const around: ArtistNeighbour[] = [];
  let leastBefore = 1;
  for (let hop = 1; hop <= hops && frontier.size > 0; hop++) {
    const kept = hop === 1 ? 1 : decay;
    const next = new Map<string, number>();
    for (const [artist, closeness] of frontier)
      for (const [other, edge] of graph.edges.get(artist) ?? []) {
        if (reached.has(other)) continue;
        next.set(other, Math.max(next.get(other) ?? 0, closeness * edge * kept));
      }
    let closest = 0;
    let least = 1;
    for (const closeness of next.values()) {
      closest = Math.max(closest, closeness);
      least = Math.min(least, closeness);
    }
    const scale = hop > 1 && closest >= leastBefore ? (decay * leastBefore) / closest : 1;
    for (const [other, closeness] of next) {
      reached.add(other);
      next.set(other, closeness * scale);
    }
    around.push(...ranked(graph, next, hop));
    leastBefore = least * scale;
    frontier = next;
  }
  return around;
};
