/**
 * DJ (docs/spec.md, DJ): the screen where the owner picks what a Magic Queue
 * starts from. Core builds its grid of tiles, holds the selection and turns
 * the selected tiles into a Magic Queue session with a DJ seed.
 */
import type { PlayedSeedArtist } from "./artistMixes.ts";
import { artistNeighbours, type ArtistGraph } from "./artistGraph.ts";
import { catalogSeedKey } from "./candidateCatalog.ts";
import type { TasteProfile } from "./tasteProfile.ts";

/** A tile as the grid tells tiles apart: its kind and what that kind compares by. */
export type DjTileKey = string & { readonly djTile: true };

/** An artist tile: a circle with the artist's image and name. */
export interface DjArtistTile {
  readonly kind: "artist";
  /** The artist as the catalog compares seed artists (`catalogSeedKey`). */
  readonly key: DjTileKey;
  readonly name: string;
  /** The Library's artist, whose image the tile shows; null for one the Library doesn't have. */
  readonly libraryId: number | null;
}

/** One selectable item of DJ's grid. */
export type DjTile = DjArtistTile;

/**
 * The artist tile of [name], the Library's artist [libraryId] when it has
 * them; null for a name that isn't an artist's ("Various Artists").
 */
export const djArtistTile = (name: string, libraryId: number | null = null): DjArtistTile | null => {
  const key = catalogSeedKey(name);
  return key === null ? null : { kind: "artist", key: `artist:${key}` as DjTileKey, name, libraryId };
};

/** What DJ's grid is built from, all of it already on the phone. */
export interface DjGridSources {
  /** The Library's artists. */
  readonly artists: readonly { readonly id: number; readonly name: string }[];
  /** The taste profile as last derived, or null before its first derivation. */
  readonly taste: TasteProfile | null;
  /** The owner's most played artists, most played first: what ranks while [taste] is null. */
  readonly played?: readonly PlayedSeedArtist[];
  /** The artist graph of the last recommendation snapshot, or null while it's cold. */
  readonly graph: ArtistGraph | null;
}

/** How many tiles DJ's grid opens with. */
export const DJ_GRID_TILES = 24;

/**
 * DJ's grid, built without the network or a derivation: the taste profile's
 * highest-scored artists, the highest first, each followed by the closest
 * artist graph neighbour of theirs that the Library doesn't have and the
 * grid doesn't show yet. Before the profile's first derivation the most
 * played artists stand in for it, in their order. An artist the Library
 * doesn't have shows by the name the plays or the graph know. No tile
 * appears twice, and the grid holds `DJ_GRID_TILES` at most; it's empty with
 * no taste signal and no plays.
 */
export const djGrid = ({ artists, taste, played = [], graph }: DjGridSources): DjTile[] => {
  const library = new Map<string, DjArtistTile>();
  for (const artist of artists) {
    const tile = djArtistTile(artist.name, artist.id);
    if (tile !== null && !library.has(tile.key)) library.set(tile.key, tile);
  }
  const known = (name: string | undefined): DjArtistTile | null => {
    const tile = name === undefined ? null : djArtistTile(name);
    return tile === null ? null : (library.get(tile.key) ?? tile);
  };
  const names = new Map(played.map((artist) => [catalogSeedKey(artist.name), artist.name]));
  const scored = [...(taste?.artists ?? [])].filter(([, score]) => score > 0);
  // oxlint-disable-next-line unicorn/no-array-sort -- sorts a fresh array; Hermes lacks toSorted
  scored.sort((a, b) => b[1] - a[1]);
  const favourites =
    taste === null
      ? played.filter((artist) => artist.countedPlays > 0).map((artist) => known(artist.name))
      : scored.map(
          ([key]) => library.get(`artist:${key}`) ?? known(names.get(key) ?? graph?.names.get(key)),
        );
  const grid = new Map<string, DjTile>();
  for (const favourite of favourites) {
    if (grid.size >= DJ_GRID_TILES) break;
    if (favourite === null || grid.has(favourite.key)) continue;
    grid.set(favourite.key, favourite);
    if (graph === null || grid.size >= DJ_GRID_TILES) continue;
    for (const neighbour of artistNeighbours(graph, favourite.name)) {
      const tile = djArtistTile(neighbour.name);
      if (tile === null || library.has(tile.key) || grid.has(tile.key)) continue;
      grid.set(tile.key, tile);
      break;
    }
  }
  return [...grid.values()];
};

/** DJ as it stands on screen: the grid's tiles in order and the selected ones. */
export interface DjState {
  readonly tiles: readonly DjTile[];
  /** The selected tiles' keys, in the order they were selected. */
  readonly selected: readonly DjTileKey[];
}

/** What the owner does in DJ. */
export type DjAction =
  /** A tap on a tile: selects it, or unselects it when it's selected. */
  { readonly type: "toggle"; readonly key: DjTileKey };

/** How many tiles a DJ seed holds at most, so every pick still weighs in the queue. */
export const DJ_MAX_SELECTED = 30;

/** DJ as it opens over [tiles], each kept once (the first of two alike): nothing selected. */
export const djOpened = (tiles: readonly DjTile[]): DjState => {
  const once = new Map<DjTileKey, DjTile>();
  for (const tile of tiles) if (!once.has(tile.key)) once.set(tile.key, tile);
  return { tiles: [...once.values()], selected: [] };
};

/** Whether the tile [key] is selected in [state]. */
export const djSelected = (state: DjState, key: DjTileKey): boolean => state.selected.includes(key);

/**
 * Whether a tap on the tile [key] does something in [state]: it's selected
 * (the tap unselects it), or the seed still has room for it.
 */
export const djSelectable = (state: DjState, key: DjTileKey): boolean =>
  djSelected(state, key) || state.selected.length < DJ_MAX_SELECTED;

/** Whether Done starts a queue from [state]: between 1 and `DJ_MAX_SELECTED` tiles are selected. */
export const djCanStart = (state: DjState): boolean =>
  state.selected.length > 0 && state.selected.length <= DJ_MAX_SELECTED;

/** [state]'s DJ seed: the selected tiles, in the order they were selected. */
export const djSeedTiles = (state: DjState): DjTile[] =>
  state.selected.flatMap((key) => state.tiles.find((tile) => tile.key === key) ?? []);

/**
 * [state] after [action]. A tap on a tile the grid doesn't hold, or on a
 * further tile once `DJ_MAX_SELECTED` are selected, leaves it as it is.
 */
export const djReduce = (state: DjState, action: DjAction): DjState => {
  if (djSelected(state, action.key))
    return { ...state, selected: state.selected.filter((key) => key !== action.key) };
  if (!djSelectable(state, action.key) || !state.tiles.some((tile) => tile.key === action.key))
    return state;
  return { ...state, selected: [...state.selected, action.key] };
};
