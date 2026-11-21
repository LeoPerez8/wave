/**
 * What DJ's grid opens with (docs/spec.md, DJ): the taste profile's grid
 * (`djGrid`) when there's a taste signal, else the artists the cold-start
 * Artist mixes were seeded from, YouTube Music's chart, so DJ works on a
 * fresh install.
 */
import type { DiscoverMixesSection } from "./discoverMixesSection.ts";
import { DJ_GRID_TILES, djArtistTile, djGrid, type DjGridSources, type DjTile } from "./dj.ts";

/** What DJ's grid opens from: `djGrid`'s sources and the Artist mixes row. */
export interface DjOpeningSources extends DjGridSources {
  /** What Discover's Artist mixes row shows (`discoverMixesSection`). */
  readonly artistMixes: DiscoverMixesSection;
}

/** What DJ's grid draws as it opens. */
export type DjOpeningGrid =
  | { readonly kind: "tiles"; readonly tiles: readonly DjTile[] }
  /** Placeholder tiles: the chart-seeded Artist mixes are on their way. */
  | { readonly kind: "skeleton" }
  /** A line saying there's nothing to pick yet; Done stays disabled. */
  | { readonly kind: "nothing" };

/** Work a DJ opening needs; a stored grid renders while its full candidates are read. */
export const djOpeningWork = ({
  libraryReady,
}: {
  readonly keptGrid: boolean;
  readonly libraryReady: boolean;
}): {
  readonly readLibrary: boolean;
  readonly buildGrid: boolean;
  readonly prepareStartup: boolean;
} => ({
  readLibrary: !libraryReady,
  buildGrid: libraryReady,
  prepareStartup: true,
});

/**
 * DJ's grid as it opens. With a taste signal (`djGrid` has a tile: a scored
 * artist, or a counted play before the profile's first derivation) the grid
 * is `djGrid`'s, whatever the Artist mixes show. With none, it's the seed
 * artists of the Artist mixes seeded from YouTube Music's chart
 * ([artistMixes], what their row shows), in the row's order, each once and
 * `DJ_GRID_TILES` at most; one the Library has shows as the Library's
 * artist. A mix seeded from plays, the Library or similar artists stays
 * out. A skeleton while the first mixes build; nothing to pick when the row
 * has no chart-seeded mix and none is coming.
 */
export const djOpeningGrid = ({ artistMixes, ...sources }: DjOpeningSources): DjOpeningGrid => {
  const taste = djGrid(sources);
  if (taste.length > 0) return { kind: "tiles", tiles: taste };
  if (artistMixes.kind === "skeleton") return { kind: "skeleton" };
  if (artistMixes.kind !== "mixes") return { kind: "nothing" };
  const library = new Map<string, DjTile>();
  for (const artist of sources.artists) {
    const tile = djArtistTile(artist.name, artist.id);
    if (tile !== null && !library.has(tile.key)) library.set(tile.key, tile);
  }
  const chart = new Map<string, DjTile>();
  for (const { seed } of artistMixes.mixes) {
    if (chart.size >= DJ_GRID_TILES) break;
    if (seed.kind !== "artist" || seed.from !== "chart") continue;
    const tile = djArtistTile(seed.name);
    if (tile !== null && !chart.has(tile.key)) chart.set(tile.key, library.get(tile.key) ?? tile);
  }
  return chart.size === 0 ? { kind: "nothing" } : { kind: "tiles", tiles: [...chart.values()] };
};
