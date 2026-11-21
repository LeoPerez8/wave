/**
 * What DJ remembers (docs/spec.md, DJ): the last selection and Adjust
 * choices a queue was started with, kept on the phone under one setting so
 * DJ reopens with them.
 */
import {
  DJ_MAX_SELECTED,
  djAlbumTile,
  djArtistTile,
  djGenreTiles,
  djGenreTile,
  djOpened,
  type DjAlbum,
  type DjState,
  type DjTile,
  type DjTileKey,
} from "./dj.ts";
import type { GenreMixDjCandidate, GenreMixLibrary } from "./genreMixes.ts";
import { DEFAULT_DJ_SETTINGS, parseDjSettings, type DjSettings } from "./djSettings.ts";
import { isRecord, readStoredRecord } from "./storedJson.ts";
import type { TasteProfile } from "./tasteProfile.ts";

/** Where DJ's last selection and Adjust choices are kept, on this device only (not synced). */
export const DJ_REMEMBERED_SETTING = "dj.remembered";

/** The DJ a queue was last started with. */
export interface DjRemembered {
  /** The selected tiles, in the order they were selected. */
  readonly tiles: readonly DjTile[];
  readonly settings: DjSettings;
}

/**
 * [tile] as it's kept: its kind and what that kind needs to be drawn again.
 * An album keeps its album artist, its YT Music page and its cover too.
 */
const storedTile = (tile: DjTile): Readonly<Record<string, unknown>> =>
  tile.kind === "album"
    ? {
        kind: tile.kind,
        name: tile.name,
        artist: tile.artist,
        browseId: tile.browseId,
        cover: tile.cover,
      }
    : { kind: tile.kind, name: tile.name };

const sameSettings = (a: DjSettings, b: DjSettings): boolean =>
  a.variety === b.variety &&
  a.discovery === b.discovery &&
  a.popularity === b.popularity &&
  a.newReleases === b.newReleases &&
  a.mood === b.mood;

/** What to keep for [remembered]: null (nothing) with no selection and the default choices. */
export const storedDjRemembered = ({ tiles, settings }: DjRemembered): string | null =>
  tiles.length === 0 && sameSettings(settings, DEFAULT_DJ_SETTINGS)
    ? null
    : JSON.stringify({ version: 1, tiles: tiles.map(storedTile), settings });

/** How each kind of tile is read back from what `storedTile` kept; null for one that can't be drawn. */
const TILE_READERS: { readonly [K in DjTile["kind"]]: (kept: StoredTile) => DjTile | null } = {
  // The Library's artist is found again as DJ reopens (`djReopened`): an id kept here could go stale.
  artist: ({ name }) => (typeof name === "string" ? djArtistTile(name) : null),
  // A family keeps its Genre mixes name; its current artist seeds are rebuilt when DJ opens.
  genre: ({ name }) => (typeof name === "string" ? djGenreTile(name) : null),
  // The Library's album is found again too: only what YT Music knows it by is kept.
  album: ({ name, artist, browseId, cover }) =>
    typeof name === "string" && typeof artist === "string"
      ? djAlbumTile({
          title: name,
          artist,
          browseId: typeof browseId === "string" ? browseId : null,
          cover: typeof cover === "string" ? cover : null,
        })
      : null,
};

type StoredTile = Readonly<Record<string, unknown>>;

/** A kept tile, by its kind; null for a kind this Wave doesn't know or a tile it can't draw. */
const readTile = (kept: unknown): DjTile | null => {
  if (!isRecord(kept) || typeof kept["kind"] !== "string") return null;
  if (!Object.hasOwn(TILE_READERS, kept["kind"])) return null;
  return TILE_READERS[kept["kind"] as DjTile["kind"]](kept);
};

/**
 * DJ's last selection and Adjust choices as kept on the phone ([stored],
 * null for none). Nothing stored, or a value that can't be read, is no
 * selection and the default choices. A tile that can't be drawn, of a kind
 * this Wave doesn't know or kept twice is left out, as is any past
 * `DJ_MAX_SELECTED`; a choice that isn't one reads as its default.
 */
export const readDjRemembered = (stored: string | null): DjRemembered => {
  const { tiles, settings } = readStoredRecord(stored);
  const read = new Map<DjTileKey, DjTile>();
  for (const kept of Array.isArray(tiles) ? tiles : []) {
    if (read.size >= DJ_MAX_SELECTED) break;
    const tile = readTile(kept);
    if (tile !== null && !read.has(tile.key)) read.set(tile.key, tile);
  }
  return { tiles: [...read.values()], settings: parseDjSettings(settings) };
};

/**
 * DJ as it reopens: the fresh [grid] with the [remembered] tiles selected,
 * in the order they were selected. A remembered tile the fresh grid wouldn't
 * show is in it anyway, ahead of the grid's own tiles, so the selection is
 * the first thing seen; it shows the Library's artist when [artists] (the
 * Library's) has them, and an album as [albums] know it (the ones the grid
 * may show and the Library's compilations, which it never shows), the first of two alike. A tile remembered twice is selected once, and no more
 * are selected than a DJ seed holds. Nothing remembered is the grid as it
 * opens (`djOpened`).
 */
export const djReopened = ({
  grid,
  remembered,
  artists = [],
  albums = [],
  genreLibrary,
  genreCandidates,
  taste = null,
}: {
  readonly grid: readonly DjTile[];
  readonly remembered: readonly DjTile[];
  readonly artists?: readonly { readonly id: number; readonly name: string }[];
  readonly albums?: readonly DjAlbum[];
  /** Current Genre mixes inputs, used to restore only families that still have seed artists. */
  readonly genreLibrary?: GenreMixLibrary | null;
  /** Genre mixes' families worked out once (`genreMixDjCandidates`), used in place of [genreLibrary]. */
  readonly genreCandidates?: readonly GenreMixDjCandidate[] | null;
  readonly taste?: TasteProfile | null;
}): DjState => {
  const fresh = new Set(grid.map((tile) => tile.key));
  const library = new Map<DjTileKey, DjTile>();
  for (const artist of artists) {
    const tile = djArtistTile(artist.name, artist.id);
    if (tile !== null && !library.has(tile.key)) library.set(tile.key, tile);
  }
  for (const album of albums) {
    const tile = djAlbumTile(album);
    if (tile !== null && !library.has(tile.key)) library.set(tile.key, tile);
  }
  const genres = new Map(
    djGenreTiles(
      {
        artists,
        albums,
        taste,
        genreLibrary: genreLibrary ?? null,
        genreCandidates: genreCandidates ?? null,
      },
      { includeUnscored: true },
    ).map((tile) => [tile.key, tile]),
  );
  const selected = new Map<DjTileKey, DjTile>();
  for (const tile of remembered) {
    if (selected.size >= DJ_MAX_SELECTED) break;
    if (selected.has(tile.key)) continue;
    if (tile.kind === "genre") {
      const current = genres.get(tile.key);
      if (current !== undefined) selected.set(tile.key, current);
    } else selected.set(tile.key, library.get(tile.key) ?? tile);
  }
  const added = [...selected.values()].filter((tile) => !fresh.has(tile.key));
  return { ...djOpened([...added, ...grid]), selected: [...selected.keys()] };
};
