/**
 * Library pages drawn from memory (#1352): an album's and an artist's page
 * come from the Library's lists Search's index keeps for the session
 * (`libraryRows`, #1354), so opening one draws its tracks in its first frame
 * and reads nothing from the Library. Their bound is the index's: the rows
 * are the index's own, and the lookups add one id map per list (Core's
 * `createLibraryDetails`). Until the index has read the lists, or for an id
 * it doesn't hold, a screen reads the Library as before.
 */
import { canFixSong, createLibraryDetails, type LibraryDetails } from "@wave/core";

import { libraryRows, subscribeLibraryRows, type LibraryRows } from "./libraryRows";
import { useSightedStore } from "@/lib/screenSight";
import type { SongSummary } from "@wave/client/db/songOrder";
import type { AlbumDetail, AlbumRow, ArtistDetail, ArtistRow, SongRow } from "@wave/client";

interface Built {
  readonly rows: LibraryRows;
  readonly details: LibraryDetails<SongRow, AlbumRow, ArtistRow>;
  /** The Artists list's rows by id, made on first use. */
  artistRows: ReadonlyMap<number, ArtistRow> | null;
  /** The Songs list's rows by id, made on first use. */
  songRows: ReadonlyMap<number, SongRow> | null;
}

let built: Built | null = null;

const builtNow = (): Built | null => {
  const rows = libraryRows();
  if (rows === null) return null;
  if (built?.rows !== rows)
    built = { rows, details: createLibraryDetails(rows), artistRows: null, songRows: null };
  return built;
};

/** The pages over the rows in memory now, made once per change of the rows; null before. */
export const libraryDetailsNow = (): LibraryDetails<SongRow, AlbumRow, ArtistRow> | null =>
  builtNow()?.details ?? null;

/** Artist [id]'s row as the Artists list shows it, from memory; undefined when it can't say. */
const artistRowNow = (id: number): ArtistRow | undefined => {
  const now = builtNow();
  if (now === null) return undefined;
  now.artistRows ??= new Map(now.rows.artists.map((artist) => [artist.id, artist]));
  return now.artistRows.get(id);
};

/** A song row's summary, as the client's `toSongSummary` makes it from the same columns. */
const summaryOf = (song: SongRow): SongSummary => ({
  id: song.id,
  title: song.title,
  artist: song.artist,
  durationMs: song.durationMs,
  thumbPath: song.thumbPath,
  explicit: song.explicit,
  albumId: song.albumId,
  artistId: song.artistId,
  hasFile: song.path !== null,
  fixable: canFixSong(song),
});

/**
 * The summaries of the songs [ids] from memory, in that order, or null when
 * memory doesn't hold one of them (the Library is asked instead): a Songs
 * page drawn this way is in its list's first frame.
 */
export const songSummariesInMemory = (ids: readonly number[]): readonly SongSummary[] | null => {
  const now = builtNow();
  if (now === null) return null;
  now.songRows ??= new Map(now.rows.songs.map((song) => [song.id, song]));
  const summaries: SongSummary[] = [];
  for (const id of ids) {
    const song = now.songRows.get(id);
    if (song === undefined) return null;
    summaries.push(summaryOf(song));
  }
  return summaries;
};

/** Album [id]'s row as the Albums list shows it, from memory; undefined when it can't say. */
export const useMemoryAlbumRow = (id: number | undefined): AlbumRow | undefined =>
  useSightedStore(subscribeLibraryRows, () =>
    id === undefined ? undefined : libraryDetailsNow()?.album(id)?.album,
  );

/** Artist [id]'s row as the Artists list shows it, from memory; undefined when it can't say. */
export const useMemoryArtistRow = (id: number | undefined): ArtistRow | undefined =>
  useSightedStore(subscribeLibraryRows, () => (id === undefined ? undefined : artistRowNow(id)));

/** Album [id]'s page from memory, or undefined when memory can't answer it (`libraryMemory.ts`). */
export const useMemoryAlbum = (id: number): AlbumDetail | undefined =>
  useSightedStore(subscribeLibraryRows, () => libraryDetailsNow()?.album(id));

/** Artist [id]'s page from memory, or undefined when memory can't answer it. */
export const useMemoryArtist = (id: number): ArtistDetail | undefined =>
  useSightedStore(subscribeLibraryRows, () => libraryDetailsNow()?.artist(id));
