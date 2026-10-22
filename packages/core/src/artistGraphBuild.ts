/** Incremental graph derivation. Feed sources in historical source/row order; plays in time/id order. */
import { catalogSeedKey, type CatalogSong } from "./candidateCatalog.ts";
import {
  ARTIST_GRAPH_WEIGHTS,
  ARTIST_SESSION_GAP_MS,
  type ArtistGraph,
  type ArtistGraphPlay,
  type ArtistGraphSources,
  type ArtistGraphWeights,
} from "./artistGraph.ts";
import { tastePlaySignal } from "./tasteProfile.ts";

export type ArtistGraphCatalogEntry = {
  readonly song: Pick<CatalogSong["song"], "artists">;
  readonly radios: CatalogSong["radios"];
};

type Evidence = Map<string, Map<string, number>>;
const note = (map: Evidence, a: string, b: string, value: number) => {
  for (const [from, to] of [
    [a, b],
    [b, a],
  ]) {
    const of = map.get(from!) ?? new Map<string, number>();
    of.set(to!, Math.max(of.get(to!) ?? 0, value));
    map.set(from!, of);
  }
};
const count = (map: Evidence, a: string, b: string) => {
  const of = map.get(a) ?? new Map<string, number>();
  of.set(b, (of.get(b) ?? 0) + 1);
  map.set(a, of);
};
/** Each next() performs at most one name, pair or edge operation, including final combination. */
export const createArtistGraphBuild = (weights: ArtistGraphWeights = ARTIST_GRAPH_WEIGHTS) => {
  const names = new Map<string, string>();
  const radios: Evidence = new Map();
  const similar: Evidence = new Map();
  const sessions: Evidence = new Map();
  let before: { endedAt: number; artists: Set<string> } | null = null;
  return {
    *catalog(entries: Iterable<ArtistGraphCatalogEntry>): Generator<void> {
      for (const { song, radios: seeds } of entries) {
        const artists = new Set<string>();
        for (const name of song.artists) {
          const key = catalogSeedKey(name);
          if (key !== null) {
            artists.add(key);
            names.set(key, name);
          }
          yield;
        }
        for (const radio of seeds) {
          if (catalogSeedKey(radio.seedName) === null) {
            yield;
            continue;
          }
          names.set(radio.seed, radio.seedName);
          // Keep empty seed maps too, matching the historical insertion order.
          if (!radios.has(radio.seed)) radios.set(radio.seed, new Map());
          for (const artist of artists) {
            if (artist !== radio.seed) count(radios, radio.seed, artist);
            yield;
          }
          yield;
        }
        yield;
      }
    },
    *pages(pages: Iterable<ArtistGraphSources["pages"][number]>): Generator<void> {
      for (const page of pages) {
        const key = catalogSeedKey(page.name);
        if (key === null) {
          yield;
          continue;
        }
        names.set(key, page.name);
        const artists = page.similar ?? [];
        for (let rank = 0; rank < artists.length; rank++) {
          const artist = artists[rank]!;
          const other = catalogSeedKey(artist.name);
          if (other !== null && other !== key) {
            names.set(other, artist.name);
            note(similar, key, other, 1 - (0.5 * rank) / artists.length);
          }
          yield;
        }
        yield;
      }
    },
    *plays(plays: Iterable<ArtistGraphPlay>): Generator<void> {
      for (const play of plays) {
        if (tastePlaySignal(play) === "skip") {
          yield;
          continue;
        }
        const artists = new Set<string>();
        for (const name of play.artists) {
          const key = catalogSeedKey(name);
          if (key !== null) {
            artists.add(key);
            names.set(key, name);
          }
          yield;
        }
        if (before !== null && play.startedAt - before.endedAt < ARTIST_SESSION_GAP_MS)
          for (const a of before.artists)
            for (const b of artists) {
              if (a !== b) count(sessions, a < b ? a : b, a < b ? b : a);
              yield;
            }
        before = { endedAt: play.startedAt + play.listenedMs, artists };
        yield;
      }
    },
    *finish(): Generator<void, ArtistGraph> {
      const radio: Evidence = new Map();
      const session: Evidence = new Map();
      for (const [counts, evidence] of [
        [radios, radio],
        [sessions, session],
      ] as const)
        for (const [a, of] of counts)
          for (const [b, n] of of) {
            note(evidence, a, b, 1 - 0.5 ** n);
            yield;
          }
      const edges: Evidence = new Map();
      const total = weights.radio + weights.similar + weights.session;
      for (const [source, weight] of [
        [radio, weights.radio],
        [similar, weights.similar],
        [session, weights.session],
      ] as const) {
        if (weight <= 0) continue;
        for (const [artist, of] of source) {
          const combined = edges.get(artist) ?? new Map<string, number>();
          for (const [other, closeness] of of) {
            combined.set(other, (combined.get(other) ?? 0) + (closeness * weight) / total);
            yield;
          }
          edges.set(artist, combined);
          yield;
        }
      }
      return { edges, names };
    },
  };
};
