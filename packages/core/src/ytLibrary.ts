/**
 * Importing playlists from the signed-in account's YouTube Music library
 * (docs/spec.md, "Importing playlists from a link", From YT Music): the
 * picker's rows and ticks, and the playlists Import makes. The app reads the
 * library page and each playlist; Core decides what's listed, what's ticked
 * and what each playlist is named.
 */

import { catalogueOf, type AppLanguage } from "./localisation.ts";
import { importNameClash, importedPlaylistName, keepBothName } from "./m3u.ts";
import {
  isSpotifyLibrarySource,
  SPOTIFY_LIKED_SONGS_SOURCE,
  type SpotifyLibraryPlaylist,
} from "./spotifyLibrary.ts";
import { readStoredRecord } from "./storedJson.ts";
import type { YtQuietReason } from "./ytSearch.ts";

/**
 * Who a playlist in the account's library comes from: the account made it,
 * saved it from someone else, or YouTube Music generates it (Liked Music,
 * Episodes for Later, Supermix and the other mixes, podcasts).
 */
export type YtLibraryPlaylistKind = "own" | "saved" | "generated";

/** A playlist on the account's library page (`FEmusic_liked_playlists`), as the native parser reads it. */
export interface YtLibraryPlaylist {
  /** YouTube's playlist id, without `VL`. */
  readonly playlistId: string;
  readonly title: string;
  readonly artworkUrl: string | null;
  /** How many songs the library page says it has; null when it doesn't say. */
  readonly songCount: number | null;
  readonly kind: YtLibraryPlaylistKind;
}

/** One of the picker's rows: a playlist to import, ticked or not. */
export interface YtLibraryRow {
  /** The YouTube Music playlist Import reads, without `VL`. */
  readonly playlistId: string;
  /** Its name on YouTube Music. */
  readonly title: string;
  readonly artworkUrl: string | null;
  /** "N songs", from the library page; null when it doesn't say. */
  readonly line: string | null;
  /** That count; null when the page doesn't say. An Import's read keeps it (`YtLibraryRead.expected`). */
  readonly songCount: number | null;
  /** Imported on this phone before (its origin is kept): the row says Imported. */
  readonly imported: boolean;
  readonly ticked: boolean;
}

/**
 * Where the playlists From YT Music made on this phone came from: each
 * YouTube Music playlist id (without `VL`; `LM` for Liked Songs) and the Wave
 * playlist its last import made or refreshed. Kept on this phone only.
 */
export type YtLibraryOrigins = ReadonlyMap<string, number>;

const NO_ORIGINS: YtLibraryOrigins = new Map();

/**
 * The [origins] whose Wave playlist is still one of [playlists]: a playlist
 * deleted, here or on another phone, forgets where it came from.
 */
export const liveYtLibraryOrigins = (
  origins: YtLibraryOrigins,
  playlists: readonly { readonly id: number }[],
): YtLibraryOrigins => {
  const ids = new Set(playlists.map((playlist) => playlist.id));
  return new Map([...origins].filter(([, playlistId]) => ids.has(playlistId)));
};

const ORIGINS_VERSION = 1;

/** [origins] as the key-value store keeps them (`readYtLibraryOrigins`). */
export const writeYtLibraryOrigins = (origins: YtLibraryOrigins): string =>
  JSON.stringify({ version: ORIGINS_VERSION, origins: Object.fromEntries(origins) });

/**
 * The origins kept as [stored] (`writeYtLibraryOrigins`). Nothing kept, or
 * anything unreadable, is none; an entry kept wrong is dropped.
 */
export const readYtLibraryOrigins = (stored: string | null): YtLibraryOrigins => {
  const { version, origins } = readStoredRecord(stored);
  if (
    version !== ORIGINS_VERSION ||
    typeof origins !== "object" ||
    origins === null ||
    Array.isArray(origins)
  ) {
    return NO_ORIGINS;
  }
  return new Map(
    Object.entries(origins).filter(
      (entry): entry is [string, number] => Number.isSafeInteger(entry[1]) && entry[1] > 0,
    ),
  );
};

/** The From YT Music picker: its rows in the order they show. */
export interface YtLibraryPicker {
  readonly rows: readonly YtLibraryRow[];
  /** The origins it was opened with: the playlists an Imported row refreshes. */
  readonly origins: YtLibraryOrigins;
  /**
   * Also add to Favorites, under Liked Songs: Import stars the liked songs
   * the Library has. It applies only while Liked Songs is ticked.
   */
  readonly favorites: boolean;
}

/**
 * YouTube Music's Liked music, read as a playlist with this id (the library
 * page lists it as `VLLM`): the picker's Liked Songs row.
 */
export const YT_LIKED_SONGS_ID = "LM";

/**
 * [rows] as this phone's [origins] mark them: a row imported before says
 * Imported and starts unticked, any other starts ticked. By source id alone,
 * so it holds for every row the picker lists, Liked Songs included.
 */
const markImported = (
  rows: readonly Omit<YtLibraryRow, "imported" | "ticked">[],
  origins: YtLibraryOrigins,
): readonly YtLibraryRow[] =>
  rows.map((row) => {
    const imported = origins.has(row.playlistId);
    return { ...row, imported, ticked: !imported };
  });

const pickerRow = (
  { playlistId, artworkUrl, songCount }: Omit<YtLibraryPlaylist, "kind" | "title">,
  title: string,
  language: AppLanguage,
): Omit<YtLibraryRow, "imported" | "ticked"> => ({
  playlistId,
  title,
  artworkUrl,
  line: songCount === null ? null : catalogueOf(language).imports.songs(songCount),
  songCount,
});

/**
 * The picker for the account's library [playlists]: Liked Songs first (its
 * cover and count from the page's Liked Music, when it lists it), always
 * listed, then the account's own and saved playlists in YouTube Music's
 * order. What YouTube Music generates is left out. Every row starts ticked
 * but those [origins] say were imported on this phone
 * (`liveYtLibraryOrigins` first, so a deleted playlist's row is ticked
 * again).
 */
export const ytLibraryPicker = (
  playlists: readonly YtLibraryPlaylist[],
  origins: YtLibraryOrigins = NO_ORIGINS,
  language: AppLanguage = "en",
): YtLibraryPicker => {
  const liked = playlists.find((playlist) => playlist.playlistId === YT_LIKED_SONGS_ID) ?? {
    playlistId: YT_LIKED_SONGS_ID,
    artworkUrl: null,
    songCount: null,
  };
  return {
    rows: markImported(
      [
        // Liked Songs is Wave's name for it, saved in [language] as its playlist's.
        pickerRow(liked, catalogueOf(language).imports.likedSongs, language),
        ...playlists
          .filter(
            (playlist) =>
              playlist.kind !== "generated" && playlist.playlistId !== YT_LIKED_SONGS_ID,
          )
          .map((playlist) => pickerRow(playlist, playlist.title, language)),
      ],
      origins,
    ),
    origins,
    favorites: false,
  };
};

const spotifyPickerRow = (
  { source, artworkUrl, songCount }: SpotifyLibraryPlaylist,
  title: string,
  language: AppLanguage,
): Omit<YtLibraryRow, "imported" | "ticked"> =>
  pickerRow({ playlistId: source, artworkUrl, songCount }, title, language);

/**
 * The From Spotify picker for the account's library [playlists]
 * (`readSpotifyLibrary`): Liked Songs first, always listed (its cover and
 * count from the library when it lists it), then the created and followed
 * playlists in Spotify's order. Rows are keyed by their Spotify source, so
 * From Spotify shares From YT Music's ticks, Import, batch and origins. It
 * has no Also add to Favorites: Spotify's songs the Library lacks go in
 * unsearched, with nothing to star yet. Rows start ticked but those
 * [origins] say were imported on this phone.
 */
export const spotifyLibraryPicker = (
  playlists: readonly SpotifyLibraryPlaylist[],
  origins: YtLibraryOrigins = NO_ORIGINS,
  language: AppLanguage = "en",
): YtLibraryPicker => {
  const liked = playlists.find((playlist) => playlist.source === SPOTIFY_LIKED_SONGS_SOURCE);
  const likedSongs = catalogueOf(language).imports.likedSongs;
  return {
    rows: markImported(
      [
        spotifyPickerRow(
          liked ?? {
            source: SPOTIFY_LIKED_SONGS_SOURCE,
            title: likedSongs,
            artworkUrl: null,
            songCount: null,
          },
          likedSongs,
          language,
        ),
        ...playlists
          .filter((playlist) => playlist !== liked)
          .map((playlist) => spotifyPickerRow(playlist, playlist.title, language)),
      ],
      origins,
    ),
    origins,
    favorites: false,
  };
};

/** [picker] with the row for [playlistId] ticked if it wasn't, unticked if it was. */
export const toggleYtLibraryRow = (
  picker: YtLibraryPicker,
  playlistId: string,
): YtLibraryPicker => ({
  ...picker,
  rows: picker.rows.map((row) =>
    row.playlistId === playlistId ? { ...row, ticked: !row.ticked } : row,
  ),
});

/** What the picker offers around its rows. */
export interface YtLibraryPickerView {
  /**
   * The button above the list: Select All while any row is unticked,
   * Deselect All once all are; none without rows.
   */
  readonly selectAll: "Select All" | "Deselect All" | null;
  /** Whether Import does anything: some row is ticked. */
  readonly canImport: boolean;
  /**
   * The Also add to Favorites switch under Liked Songs: enabled only while
   * Liked Songs is ticked, and shown off while it isn't (Import stars
   * nothing then).
   */
  readonly favorites: { readonly on: boolean; readonly enabled: boolean };
}

/** Whether [picker]'s Liked Songs row is ticked. */
const likedTicked = (picker: YtLibraryPicker): boolean =>
  picker.rows.some((row) => row.playlistId === YT_LIKED_SONGS_ID && row.ticked);

export const ytLibraryPickerView = (picker: YtLibraryPicker): YtLibraryPickerView => {
  const { rows } = picker;
  const enabled = likedTicked(picker);
  return {
    selectAll:
      rows.length === 0 ? null : rows.every((row) => row.ticked) ? "Deselect All" : "Select All",
    canImport: rows.some((row) => row.ticked),
    favorites: { on: enabled && picker.favorites, enabled },
  };
};

/**
 * Also add to Favorites flipped: on if it was off, off if it was on. While
 * Liked Songs is unticked it's disabled, and [picker] stays as it is.
 */
export const toggleYtLibraryFavorites = (picker: YtLibraryPicker): YtLibraryPicker =>
  likedTicked(picker) ? { ...picker, favorites: !picker.favorites } : picker;

/** The Select All / Deselect All button: every row ticked, or, when all were, none. */
export const pressYtLibrarySelectAll = (picker: YtLibraryPicker): YtLibraryPicker => {
  const tick = !picker.rows.every((row) => row.ticked);
  return { ...picker, rows: picker.rows.map((row) => ({ ...row, ticked: tick })) };
};

/** One playlist Import makes or refreshes: the YouTube Music playlist it's read from, and its Wave name. */
export interface YtLibraryImportItem {
  /** Without `VL`. */
  readonly playlistId: string;
  /** Its name in Wave, free of every other playlist's (a refreshed one keeps its own). */
  readonly name: string;
  /**
   * The Wave playlist an earlier import of it made, emptied and filled again
   * from the source (as Replace does); null to make a new one.
   */
  readonly replaces: number | null;
  /**
   * Read whole (`readYtPlaylist`'s `uncapped`): Liked Songs, and every
   * Spotify playlist (read with no song limit, as a link import reads it).
   * The other YouTube Music ones stop at `YT_PLAYLIST_SONG_CAP`.
   */
  readonly uncapped: boolean;
  /**
   * Its songs the Library has get the Favorite star once it's read: Liked
   * Songs, with Also add to Favorites on.
   */
  readonly favorites: boolean;
  /** How many songs its picker row said it has; null when it said none (`YtLibraryRead.expected`). */
  readonly expected: number | null;
}

/**
 * The playlists Import makes from [picker], one per ticked row in its order,
 * Liked Songs read whole. A row imported before refreshes the playlist that
 * import made, which keeps its name. Any other is named as a link import
 * names it (`importedPlaylistName`; Liked Songs is "Liked Songs"), and a name
 * one of [playlists] (or an earlier one of these) has goes in under Keep
 * Both's name ("Name 2"), without asking. With Also add to Favorites on,
 * YouTube Music's Liked Songs' read stars its songs the Library has. The
 * From Spotify picker's rows plan alike, each read whole.
 */
export const planYtLibraryImport = (
  picker: YtLibraryPicker,
  playlists: readonly { readonly id: number; readonly name: string }[],
): readonly YtLibraryImportItem[] => {
  const taken = playlists.map((playlist) => ({ name: playlist.name }));
  const items: YtLibraryImportItem[] = [];
  for (const row of picker.rows) {
    if (!row.ticked) continue;
    const ytLiked = row.playlistId === YT_LIKED_SONGS_ID;
    const uncapped = ytLiked || isSpotifyLibrarySource(row.playlistId);
    const favorites = ytLiked && picker.favorites;
    const origin = picker.origins.get(row.playlistId);
    const refreshed = playlists.find((playlist) => playlist.id === origin);
    if (refreshed !== undefined) {
      items.push({
        playlistId: row.playlistId,
        name: refreshed.name,
        replaces: refreshed.id,
        uncapped,
        favorites,
        expected: row.songCount,
      });
      continue;
    }
    const wanted = importedPlaylistName(row.title);
    const name =
      importNameClash(wanted, taken) === undefined
        ? wanted
        : keepBothName(
            wanted,
            taken.map((playlist) => playlist.name),
          );
    taken.push({ name });
    items.push({
      playlistId: row.playlistId,
      name,
      replaces: null,
      uncapped,
      favorites,
      expected: row.songCount,
    });
  }
  return items;
};

/**
 * Why the library page wasn't read: offline, YouTube Music failed, YT Music
 * turned off meanwhile, or the session ended (YouTube stopped accepting it,
 * or answered as to someone signed out).
 */
export type YtLibraryFailure = YtQuietReason | "disabled" | "signedOut";

/** What the picker shows in place of its rows when the library page wasn't read. */
export interface YtLibraryFailureView {
  readonly line: string;
  /** Try Again, Sign In Again, or nothing to offer. */
  readonly action: "tryAgain" | "signIn" | null;
}

const FAILURES = {
  offline: { line: "offline", action: "tryAgain" },
  failed: { line: "ytLibraryFailed", action: "tryAgain" },
  signedOut: { line: "ytSignedOut", action: "signIn" },
  disabled: { line: "ytMusicOffInSettings", action: null },
} as const satisfies Record<
  YtLibraryFailure,
  { line: string; action: YtLibraryFailureView["action"] }
>;

/** The picker's message for a library page that wasn't read, and what it offers, in [language]. */
export const ytLibraryFailure = (
  reason: YtLibraryFailure,
  language: AppLanguage = "en",
): YtLibraryFailureView => {
  const { line, action } = FAILURES[reason];
  return { line: catalogueOf(language).imports[line], action };
};
