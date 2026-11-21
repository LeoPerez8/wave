/**
 * DJ (docs/spec.md, DJ): the screen where the owner picks what a Magic Queue
 * starts from. Core builds its grid of tiles, holds the selection and turns
 * the selected tiles into a Magic Queue session with a DJ seed.
 */
import type { PlayedSeedArtist } from "./artistMixes.ts";
import { artistNeighbours, type ArtistGraph } from "./artistGraph.ts";
import { catalogSeedKey } from "./candidateCatalog.ts";
import { DEFAULT_DJ_SETTINGS, djNewMusicShare, type DjSettings } from "./djSettings.ts";
import { magicArtistKey, type MagicSeedSong, type MagicSession } from "./magicQueue.ts";
import type { TasteProfile } from "./tasteProfile.ts";
import { identityKey } from "./library.ts";
import { normalizeSearchText } from "./search.ts";
import { releaseTitle, YT_ARTIST_FRESH_MS } from "./ytArtist.ts";
import {
  genreFamily,
  genreFamilyOfArtist,
  genreMixDjCandidates,
  type GenreMixDjCandidate,
  type GenreMixLibrary,
} from "./genreMixes.ts";
import type { DiscoverSeedArtist } from "./discoverMixes.ts";
import type { GenreProfileOf } from "./genreAffinity.ts";

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

/** An album as DJ is told of it: one the Library has, one a saved artist page lists, or both. */
export interface DjAlbum {
  readonly title: string;
  /** Its album artist, by name. */
  readonly artist: string;
  /** The Library's album, or none. */
  readonly libraryId?: number | null;
  /** Its YT Music page (`MPREb_…`), or none. */
  readonly browseId?: string | null;
  /** Its cover: the Library's cached file, or its address on YouTube Music. */
  readonly cover?: string | null;
  /**
   * A Library compilation: the grid never shows it, but a remembered one is
   * found again among these as DJ reopens (`djReopened`).
   */
  readonly compilation?: boolean;
}

/** An album tile: a square cover with the album's title and artist. */
export interface DjAlbumTile {
  readonly kind: "album";
  /** The album by its title and album artist (`djAlbumTile`). */
  readonly key: DjTileKey;
  /** The album's title. */
  readonly name: string;
  /** Its album artist, whose tile and similar artists it opens. */
  readonly artist: string;
  /** The Library's album, whose cover the tile shows and whose songs it seeds; null without. */
  readonly libraryId: number | null;
  /** Its YT Music page, where the songs of an album the Library doesn't have are read; null without. */
  readonly browseId: string | null;
  /** Its cover as the tile draws it (`DjAlbum.cover`); null without. */
  readonly cover: string | null;
}

/** A genre family tile: a square named for the family and seeded by Genre mixes' artists. */
export interface DjGenreTile {
  readonly kind: "genre";
  readonly key: DjTileKey;
  /** Genre tiles do not correspond to a Library row. */
  readonly libraryId: null;
  readonly name: string;
  /** The family key used by Genre mixes and by Same genres. */
  readonly family: string;
  /** The seed artists Genre mixes selects for this family. */
  readonly artists: readonly DiscoverSeedArtist[];
  /** The family artists and albums this tile opens, already ranked by taste. */
  readonly opens: readonly DjTile[];
}

/** One selectable item of DJ's grid. */
export type DjTile = DjArtistTile | DjAlbumTile | DjGenreTile;

/** The artist [tile] stands for: an artist tile's own, an album tile's album artist. */
export const djTileArtist = (tile: DjTile): string =>
  tile.kind === "album" ? tile.artist : tile.name;

/**
 * The artist tile of [name], the Library's artist [libraryId] when it has
 * them; null for a name that isn't an artist's ("Various Artists").
 */
export const djArtistTile = (
  name: string,
  libraryId: number | null = null,
): DjArtistTile | null => {
  const key = catalogSeedKey(name);
  return key === null
    ? null
    : { kind: "artist", key: `artist:${key}` as DjTileKey, name, libraryId };
};

/**
 * Whether [tile] shows "New to you" under its name: an artist the Library
 * doesn't have. Album and genre tiles never do.
 */
export const djNewToYou = (tile: DjTile): boolean =>
  tile.kind === "artist" && tile.libraryId === null;

/**
 * The album tile of [album]; null for one with no title. Two albums are the
 * same tile when their titles match as releases do (`releaseTitle`: case,
 * accents, punctuation and edition notes don't count) and their album
 * artists as the catalog compares seed artists.
 */
export const djAlbumTile = (album: DjAlbum): DjAlbumTile | null => {
  const title = releaseTitle(album.title);
  if (title === "") return null;
  const artist = catalogSeedKey(album.artist) ?? normalizeSearchText(album.artist);
  return {
    kind: "album",
    key: `album:${artist}:${title}` as DjTileKey,
    name: album.title,
    artist: album.artist,
    libraryId: album.libraryId ?? null,
    browseId: album.browseId ?? null,
    cover: album.cover ?? null,
  };
};

/** A remembered family tile without its current seed artists or opening row. */
export const djGenreTile = (name: string): DjGenreTile | null => {
  const family = genreFamily(name);
  return family === null
    ? null
    : {
        kind: "genre",
        key: `genre:${family.key}` as DjTileKey,
        libraryId: null,
        name: family.name,
        family: family.key,
        artists: [],
        opens: [],
      };
};

/** Whether [artists]' known Genre mixes profile is compatible with a DJ family radio. */
export const djFamilyRadioAllowed = (
  family: string,
  artists: readonly string[],
  profileOf: GenreProfileOf,
  graph: ArtistGraph | null = null,
): boolean => {
  for (const artist of artists) {
    const known = genreFamilyOfArtist(artist, graph, profileOf);
    if (known !== null) return known.key === family;
  }
  return true;
};

/**
 * Whether a song by [artists] on the radio [radioId] (a seed's id, or
 * `artist:` and a catalog seed key) stays in [session]'s batch. A radio a
 * family tile alone brought keeps the songs that fit any of its families
 * (`djFamilyRadioAllowed`); any other radio keeps every song.
 */
export const djRadioSongAllowed = (
  session: Pick<MagicSession, "djGenreRadios">,
  radioId: string,
  artists: readonly string[],
  profileOf: GenreProfileOf,
  graph: ArtistGraph | null = null,
): boolean => {
  const families = session.djGenreRadios?.find(
    (radio) => radio.id === radioId || `artist:${radio.id}` === radioId,
  )?.families;
  return (
    families === undefined ||
    families.length === 0 ||
    families.some((family) => djFamilyRadioAllowed(family, artists, profileOf, graph))
  );
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
  /**
   * The albums the Library and the saved artist pages know, each artist's
   * in the order the grid prefers them; none without.
   */
  readonly albums?: readonly DjAlbum[];
  /** Library inputs for Genre mixes' families and seed artists. */
  readonly genreLibrary?: GenreMixLibrary | null;
  /**
   * Genre mixes' families over [genreLibrary] (`genreMixDjCandidates`),
   * worked out once per Library snapshot; used in its place when given.
   */
  readonly genreCandidates?: readonly GenreMixDjCandidate[] | null;
}

/** How many tiles DJ's grid opens with. */
export const DJ_GRID_TILES = 24;

/** How many family tiles DJ's grid may show. */
export const DJ_GENRE_TILES = 4;

/** The families DJ can seed, ranked by taste; remembered families may include unscored candidates. */
export const djGenreTiles = (
  {
    artists,
    taste,
    albums = [],
    genreLibrary,
    genreCandidates,
  }: Pick<DjGridSources, "artists" | "taste" | "albums" | "genreLibrary" | "genreCandidates">,
  { includeUnscored = false }: { readonly includeUnscored?: boolean } = {},
): DjGenreTile[] => {
  const candidates =
    genreCandidates ?? (genreLibrary == null ? null : genreMixDjCandidates(genreLibrary));
  if (candidates === null) return [];
  const library = new Map<string, DjArtistTile>();
  for (const artist of artists) {
    const tile = djArtistTile(artist.name, artist.id);
    if (tile !== null && !library.has(tile.key)) library.set(tile.key, tile);
  }
  const records = new Map<string, DjAlbumTile>();
  for (const album of albums) {
    if (album.compilation === true) continue;
    const by = djArtistTile(album.artist)?.key;
    const tile = djAlbumTile(album);
    if (by !== undefined && tile !== null && !records.has(by)) records.set(by, tile);
  }
  const known = (name: string): DjArtistTile | null => {
    const tile = djArtistTile(name);
    return tile === null ? null : (library.get(tile.key) ?? tile);
  };
  return candidates
    .flatMap(({ seed, artists: members }) => {
      const family = genreFamily(seed.genre ?? seed.name);
      const score = taste?.genres.get(family?.key ?? "") ?? 0;
      if (family === null || (!includeUnscored && score <= 0)) return [];
      const seedArtists = seed.artists ?? [];
      const opens = members
        .map((artist) => ({
          artist,
          score: taste?.artists.get(magicArtistKey(artist.name)) ?? 0,
        }))
        .sort((a, b) => b.score - a.score)
        .flatMap(({ artist }) => {
          const tile = known(artist.name);
          if (tile === null) return [];
          const album = records.get(tile.key);
          return album === undefined ? [tile] : [tile, album];
        })
        .filter(
          (tile, index, all) => all.findIndex((candidate) => candidate.key === tile.key) === index,
        )
        .slice(0, DJ_GRID_TILES + DJ_OPENED_TILES);
      return [
        {
          score,
          tile: {
            kind: "genre",
            key: `genre:${family.key}` as DjTileKey,
            libraryId: null,
            name: family.name,
            family: family.key,
            artists: seedArtists,
            opens,
          } satisfies DjGenreTile,
        },
      ];
    })
    .sort((a, b) => b.score - a.score)
    .map(({ tile }) => tile);
};

/**
 * DJ's grid, built without the network or a derivation: the taste profile's
 * highest-scored artists, the highest first, each followed by the closest
 * artist graph neighbour of theirs that the Library doesn't have and the
 * grid doesn't show yet. Each artist is followed by the first of [albums]
 * that is theirs and isn't a compilation, when one is known. Before the profile's first derivation the most
 * played artists stand in for it, in their order. An artist the Library
 * doesn't have shows by the name the plays or the graph know. No tile
 * appears twice, and the grid holds `DJ_GRID_TILES` at most; it's empty with
 * no taste signal and no plays.
 */
export const djGrid = ({
  artists,
  taste,
  played = [],
  graph,
  albums = [],
  genreLibrary,
  genreCandidates,
}: DjGridSources): DjTile[] => {
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
  const records = new Map<string, DjAlbumTile>();
  for (const album of albums) {
    if (album.compilation === true) continue;
    const by = djArtistTile(album.artist)?.key;
    const tile = djAlbumTile(album);
    if (by !== undefined && tile !== null && !records.has(by)) records.set(by, tile);
  }
  const grid = new Map<string, DjTile>();
  const genreTiles = djGenreTiles({
    artists,
    taste,
    albums,
    genreLibrary: genreLibrary ?? null,
    genreCandidates: genreCandidates ?? null,
  }).slice(0, DJ_GENRE_TILES);
  let nextGenre = 0;
  /** Shows [artist], then the album of theirs while the grid has room for it. */
  const show = (artist: DjArtistTile): void => {
    grid.set(artist.key, artist);
    const record = records.get(artist.key);
    if (record !== undefined && grid.size < DJ_GRID_TILES) grid.set(record.key, record);
  };
  for (const favourite of favourites) {
    if (grid.size >= DJ_GRID_TILES) break;
    if (favourite === null || grid.has(favourite.key)) continue;
    show(favourite);
    if (graph !== null && grid.size < DJ_GRID_TILES) {
      for (const neighbour of artistNeighbours(graph, favourite.name)) {
        const tile = djArtistTile(neighbour.name);
        if (tile === null || library.has(tile.key) || grid.has(tile.key)) continue;
        show(tile);
        break;
      }
    }
    const genre = genreTiles[nextGenre];
    if (genre !== undefined && grid.size < DJ_GRID_TILES) {
      grid.set(genre.key, genre);
      nextGenre += 1;
    }
  }
  while (nextGenre < genreTiles.length && grid.size < DJ_GRID_TILES) {
    const genre = genreTiles[nextGenre++]!;
    grid.set(genre.key, genre);
  }
  return [...grid.values()];
};

/** How many similar artists a selected tile opens at most. */
export const DJ_OPENED_TILES = 3;

/** The row of similar artists a tile opened when it was selected; a tile opens one row per opening of DJ. */
export interface DjRow {
  /** The tile that opened it. */
  readonly of: DjTileKey;
  /** The tile its placeholders stand right after: the last one it opened, or its own. */
  readonly after: DjTileKey;
  /** How many places it still holds for the artist's YT Music page; 0 once the row is settled. */
  readonly waiting: number;
}

/** DJ as it stands on screen: the grid's tiles in order and the selected ones. */
export interface DjState {
  readonly tiles: readonly DjTile[];
  /** The selected tiles' keys, in the order they were selected. */
  readonly selected: readonly DjTileKey[];
  /** The rows the selected tiles opened, in the order they opened. */
  readonly rows: readonly DjRow[];
}

/** The Library's artists, for the tiles a selection opens to show theirs. */
type DjLibraryArtists = readonly { readonly id: number; readonly name: string }[];

/** What the owner does in DJ, and what DJ reads for it. */
export type DjAction =
  | {
      /**
       * A tap on a tile: selects it, or unselects it when it's selected. The
       * first time it's selected it opens its row of similar artists from
       * [graph] (`DJ_OPENED_TILES`); none known when it's cold or left out.
       */
      readonly type: "toggle";
      readonly key: DjTileKey;
      readonly graph?: ArtistGraph | null;
      readonly library?: DjLibraryArtists;
    }
  | {
      /**
       * The YT Music page of [artist] was read (`djPagesNeeded`): [artists]
       * is its "Fans might also like" list in the page's order, or null when
       * it couldn't be read (offline, a failed request, no such page). It
       * settles every row waiting for that artist's page.
       */
      readonly type: "similar";
      readonly artist: string;
      readonly artists: readonly { readonly name: string }[] | null;
      readonly library?: DjLibraryArtists;
    }
  | {
      /**
       * A tap on a result of the grid's search (`djSearchTiles`): [tile]
       * joins the grid first, selected, and opens its row from [graph] as a
       * tapped tile does. One the grid already shows is selected where it is.
       */
      readonly type: "add";
      readonly tile: DjTile;
      readonly graph?: ArtistGraph | null;
      readonly library?: DjLibraryArtists;
    };

/** How many tiles a DJ seed holds at most, so every pick still weighs in the queue. */
export const DJ_MAX_SELECTED = 30;

/** DJ as it opens over [tiles], each kept once (the first of two alike): nothing selected. */
export const djOpened = (tiles: readonly DjTile[]): DjState => {
  const once = new Map<DjTileKey, DjTile>();
  for (const tile of tiles) if (!once.has(tile.key)) once.set(tile.key, tile);
  return { tiles: [...once.values()], selected: [], rows: [] };
};

/** Whether the tile [key] is selected in [state]. */
export const djSelected = (state: DjState, key: DjTileKey): boolean => state.selected.includes(key);

/**
 * Whether a tap on the tile [key] does something in [state]: it's selected
 * (the tap unselects it), or the seed still has room for it.
 */
export const djSelectable = (state: DjState, key: DjTileKey): boolean =>
  djSelected(state, key) || !djSeedFull(state);

/** Whether [state]'s seed is full: `DJ_MAX_SELECTED` tiles are selected, and no further one can be. */
export const djSeedFull = (state: DjState): boolean => state.selected.length >= DJ_MAX_SELECTED;

/** Whether Done starts a queue from [state]: between 1 and `DJ_MAX_SELECTED` tiles are selected. */
export const djCanStart = (state: DjState): boolean =>
  state.selected.length > 0 && state.selected.length <= DJ_MAX_SELECTED;

/** [state]'s DJ seed: the selected tiles, in the order they were selected. */
export const djSeedTiles = (state: DjState): DjTile[] =>
  state.selected.flatMap((key) => state.tiles.find((tile) => tile.key === key) ?? []);

/**
 * The tiles of up to [room] of [names]' artists, in their order, that [state]'s
 * grid doesn't show yet, each one once: the Library's artist where [library] has them.
 */
const tilesToOpen = (
  state: DjState,
  names: readonly string[],
  room: number,
  library: DjLibraryArtists,
): DjArtistTile[] => {
  const shown = new Set<string>(state.tiles.map((tile) => tile.key));
  const opened: DjArtistTile[] = [];
  for (const name of names) {
    if (opened.length >= room) break;
    const tile = djArtistTile(name);
    if (tile === null || shown.has(tile.key)) continue;
    shown.add(tile.key);
    const owned = library.find((artist) => djArtistTile(artist.name)?.key === tile.key);
    opened.push(owned === undefined ? tile : { ...tile, name: owned.name, libraryId: owned.id });
  }
  return opened;
};

/** [tiles] with [opened] right after the tile [after]. */
const placedAfter = (
  tiles: readonly DjTile[],
  after: DjTileKey,
  opened: readonly DjTile[],
): readonly DjTile[] => {
  const at = tiles.findIndex((tile) => tile.key === after) + 1;
  return opened.length === 0 ? tiles : [...tiles.slice(0, at), ...opened, ...tiles.slice(at)];
};

/**
 * [state] once [tile], just selected, opened its row: the closest artist
 * graph neighbours the grid doesn't show yet, up to `DJ_OPENED_TILES`, right
 * after it. With fewer, the row holds the places left for the artist's page
 * (`djPagesNeeded`). An album opens its album artist's tile first when the
 * grid lacks it, then that artist's similar artists, `DJ_OPENED_TILES` in
 * all; one whose album artist isn't an artist ("Various Artists") opens
 * nothing. A tile that opened a row before opens nothing more.
 */
const withRowOpened = (
  state: DjState,
  tile: DjTile,
  graph: ArtistGraph | null,
  library: DjLibraryArtists,
): DjState => {
  if (state.rows.some((row) => row.of === tile.key)) return state;
  const artist = djTileArtist(tile);
  const close = graph === null ? [] : artistNeighbours(graph, artist);
  const opened: DjTile[] =
    tile.kind === "genre"
      ? tile.opens
          .filter((candidate) => !state.tiles.some((shown) => shown.key === candidate.key))
          .slice(0, DJ_OPENED_TILES)
      : tilesToOpen(
          state,
          [...(tile.kind === "album" ? [artist] : []), ...close.map((neighbour) => neighbour.name)],
          DJ_OPENED_TILES,
          library,
        );
  const row: DjRow = {
    of: tile.key,
    after: opened[opened.length - 1]?.key ?? tile.key,
    waiting:
      tile.kind === "genre" || djArtistTile(artist) === null ? 0 : DJ_OPENED_TILES - opened.length,
  };
  return {
    ...state,
    tiles: placedAfter(state.tiles, tile.key, opened),
    rows: [...state.rows, row],
  };
};

/**
 * [state] once the page the row of [key] waits for was read: [artists] fill
 * the places it held, in the page's order, skipping tiles the grid shows by
 * now; with null (the page couldn't be read) what the graph gave stands. The
 * places not filled are let go. Rows that wait at the same tile keep their order.
 */
const withRowFilled = (
  state: DjState,
  key: DjTileKey,
  artists: readonly { readonly name: string }[] | null,
  library: DjLibraryArtists,
): DjState => {
  const at = state.rows.findIndex((row) => row.of === key && row.waiting > 0);
  const filled = state.rows[at];
  if (filled === undefined) return state;
  const opened = tilesToOpen(
    state,
    (artists ?? []).map((artist) => artist.name),
    filled.waiting,
    library,
  );
  const last = opened[opened.length - 1]?.key ?? filled.after;
  return {
    ...state,
    tiles: placedAfter(state.tiles, filled.after, opened),
    rows: state.rows.map((row, index) => {
      if (index === at) return { ...row, after: last, waiting: 0 };
      return index > at && row.after === filled.after ? { ...row, after: last } : row;
    }),
  };
};

/**
 * [state] after [action]. A tap on a tile the grid doesn't hold, or on a
 * further tile once `DJ_MAX_SELECTED` are selected, leaves it as it is, and
 * so does a page no row waits for. Unselecting a tile keeps the tiles it opened.
 * A search result never unselects: one that's selected stays so, and at
 * `DJ_MAX_SELECTED` another can't be added (`djSelectable` says so ahead).
 */
export const djReduce = (state: DjState, action: DjAction): DjState => {
  if (action.type === "similar") {
    const page = identityKey(action.artist);
    return waitingRows(state)
      .filter(({ tile }) => identityKey(djTileArtist(tile)) === page)
      .reduce(
        (filled, { row }) => withRowFilled(filled, row.of, action.artists, action.library ?? []),
        state,
      );
  }
  if (action.type === "add") {
    if (djSelected(state, action.tile.key) || !djSelectable(state, action.tile.key)) return state;
    const shown = state.tiles.find((each) => each.key === action.tile.key);
    return withRowOpened(
      {
        ...state,
        tiles: shown === undefined ? [action.tile, ...state.tiles] : state.tiles,
        selected: [...state.selected, action.tile.key],
      },
      shown ?? action.tile,
      action.graph ?? null,
      action.library ?? [],
    );
  }
  if (djSelected(state, action.key))
    return { ...state, selected: state.selected.filter((key) => key !== action.key) };
  const tile = state.tiles.find((each) => each.key === action.key);
  if (!djSelectable(state, action.key) || tile === undefined) return state;
  return withRowOpened(
    { ...state, selected: [...state.selected, action.key] },
    tile,
    action.graph ?? null,
    action.library ?? [],
  );
};

/** The rows still holding places for a YT Music page, each with the tile that opened it. */
const waitingRows = (state: DjState): { row: DjRow; tile: DjTile }[] =>
  state.rows.flatMap((row) => {
    const tile = row.waiting > 0 ? state.tiles.find((each) => each.key === row.of) : undefined;
    return tile === undefined ? [] : [{ row, tile }];
  });

/** A YT Music page DJ reads for the rows waiting for it. */
export interface DjPageNeeded {
  /** The artist whose page it is, as the first row waiting for it names them. */
  readonly artist: string;
  /** The artist as pages are saved and asked for by (`identityKey`), one read per key. */
  readonly key: string;
}

/**
 * The pages the rows that still hold places wait for, which DJ reads now:
 * the page of each row's tile's artist (`djTileArtist`), an album's album
 * artist. An artist's page is read once however many rows wait for it (an
 * album's row and its album artist's own), and that read settles them all.
 */
export const djPagesNeeded = (state: DjState): DjPageNeeded[] => {
  const pages = new Map<string, DjPageNeeded>();
  for (const { tile } of waitingRows(state)) {
    const artist = djTileArtist(tile);
    const key = identityKey(artist);
    if (!pages.has(key)) pages.set(key, { artist, key });
  }
  return [...pages.values()];
};

/** One place of DJ's grid as it's drawn: a tile, or a still placeholder holding a place. */
export type DjCell =
  | { readonly kind: "tile"; readonly key: string; readonly tile: DjTile }
  | { readonly kind: "placeholder"; readonly key: string };

/**
 * [state]'s grid as it's drawn, in order: its tiles, and after a row that
 * waits for its artist's page a placeholder for each place it holds.
 */
export const djCells = (state: DjState): DjCell[] =>
  state.tiles.flatMap((tile): DjCell[] => [
    { kind: "tile", key: tile.key, tile },
    ...state.rows.flatMap((row) =>
      row.after === tile.key
        ? Array.from({ length: row.waiting }, (_, at): DjCell => ({
            kind: "placeholder",
            key: `placeholder:${row.of}:${at}`,
          }))
        : [],
    ),
  ]);

/** What a DJ seed is called; Up Next's label comes from the catalogue (`magicQueueLabel`). */
const DJ_SEED_TITLE = "DJ";

/** [artist]'s radio as a seed a batch may read, as an artist seed reads it. */
const artistSeed = (artist: DjArtistTile, plays: number): MagicSeedSong => ({
  id: artist.key,
  title: artist.name,
  artists: [artist.name],
  durationMs: null,
  kind: "artist",
  plays,
});

/**
 * Starts a Magic Queue from a DJ seed, the selected [tiles] (`djSeedTiles`):
 * no seed song plays first, so the session has queued nothing and its first
 * batch of 10 is its whole queue. An artist tile contributes that artist's
 * radio; an album tile its songs in [albumSongs] (`magicListSeedSongs`), as
 * an album seed does, or its album artist's radio when none of its songs
 * could be read. Each batch reads up to 3 of those radios by different
 * artists (`magicBatchRadios`), artists and albums in one draw: the artists
 * with more counted plays in [played], and the songs with more of their own,
 * most often. A family tile contributes its seed artists' radios, whose songs
 * keep to the family (`djRadioSongAllowed`) unless that artist was also
 * picked as an artist tile or as a selected album's artist. It ranks with [settings], DJ's own, and starts at their New
 * music share. Null when the tiles give no radio to read.
 */
export const startDjQueue = (
  tiles: readonly DjTile[],
  {
    id,
    played = [],
    settings = DEFAULT_DJ_SETTINGS,
    albumSongs = new Map(),
  }: {
    readonly id: string;
    readonly played?: readonly PlayedSeedArtist[];
    readonly settings?: DjSettings;
    /** Each selected album's songs, by its tile's key; none for one that couldn't be read. */
    readonly albumSongs?: ReadonlyMap<DjTileKey, readonly MagicSeedSong[]>;
  },
): MagicSession | null => {
  const plays = new Map<string, number>();
  for (const artist of played) {
    const tile = djArtistTile(artist.name);
    if (tile !== null) plays.set(tile.key, (plays.get(tile.key) ?? 0) + artist.countedPlays);
  }
  const seeds = new Map<string, MagicSeedSong>();
  const artists = new Map<string, string>();
  const genreRadios = new Map<string, Set<string>>();
  // Artists picked as an artist tile or as a selected album's artist: their radios stay open.
  const picked = new Set<string>();
  const credit = (name: string): void => {
    const key = djArtistTile(name)?.key;
    if (key !== undefined && !artists.has(key)) artists.set(key, name);
  };
  for (const tile of tiles) {
    if (tile.kind === "genre") {
      for (const artist of tile.artists) {
        const seedArtist = djArtistTile(artist.name);
        if (seedArtist === null) continue;
        credit(artist.name);
        if (!seeds.has(seedArtist.key))
          seeds.set(seedArtist.key, artistSeed(seedArtist, plays.get(seedArtist.key) ?? 0));
        const families = genreRadios.get(seedArtist.key) ?? new Set<string>();
        families.add(tile.family);
        genreRadios.set(seedArtist.key, families);
      }
      continue;
    }
    const songs = tile.kind === "album" ? (albumSongs.get(tile.key) ?? []) : [];
    const artist = tile.kind === "album" ? djArtistTile(tile.artist) : tile;
    if (artist !== null) {
      picked.add(artist.key);
      credit(artist.name);
    }
    // A compilation is nobody's: its songs' own artists are the session's.
    else for (const song of songs) if (song.artists[0] !== undefined) credit(song.artists[0]);
    if (songs.length === 0 && artist !== null && !seeds.has(artist.key))
      seeds.set(artist.key, artistSeed(artist, plays.get(artist.key) ?? 0));
    for (const song of songs) if (!seeds.has(song.id)) seeds.set(song.id, song);
  }
  if (seeds.size === 0) return null;
  for (const key of picked) genreRadios.delete(key);
  return {
    id,
    seed: { kind: "dj", id, title: DJ_SEED_TITLE },
    dj: settings,
    seedSongs: [...seeds.values()],
    seedDraws: [],
    used: [],
    batches: 0,
    ytShare: djNewMusicShare(settings),
    radioArtists: [...artists.values()],
    ...(genreRadios.size > 0
      ? {
          djGenreRadios: [...genreRadios].map(([id, families]) => ({
            id,
            families: [...families],
          })),
        }
      : {}),
    seedProfile: null,
    seedStyle: null,
    seedVideoIds: [],
  };
};

/** What's saved for an artist's YT Music page, as DJ reads it (a `YtArtistSaved`). */
export type DjSavedPage =
  | {
      readonly outcome: "found";
      readonly checkedAt: number;
      readonly page: { readonly similar?: readonly { readonly name: string }[] };
    }
  | { readonly outcome: "unmatched"; readonly checkedAt: number };

/** How DJ gets a tile's "Fans might also like" list, given what's saved for its page. */
export interface DjPageRead {
  /** Whether YouTube Music is asked for the page: nothing is saved, or it's a week old. */
  readonly ask: boolean;
  /**
   * The list the saved page gives, for the `similar` action: what fills the
   * row with no request, and what stands when the request fails. Null with
   * nothing saved or no such artist.
   */
  readonly artists: readonly { readonly name: string }[] | null;
}

/**
 * How DJ reads the page a row waits for (`djPagesNeeded`) at [now], given
 * what's [saved] for it: an answer saved within the week (`YT_ARTIST_FRESH_MS`)
 * is used as it is, with no request; otherwise the page is asked for.
 */
export const djPageRead = (saved: DjSavedPage | null, now: number): DjPageRead => ({
  ask: saved === null || now - saved.checkedAt >= YT_ARTIST_FRESH_MS,
  artists: saved?.outcome === "found" ? (saved.page.similar ?? []) : null,
});
