/**
 * Saving scanned tracks and the Wave account's missing songs into the library
 * database, and pruning what removed tracks leave empty. Kept free of Expo so
 * the store tests run it against a real SQLite (`testDatabase.ts`).
 */
import {
  fillMissingSongs,
  recordingKey,
  type LibraryTrack,
  type MissingSongSave,
} from "@wave/core";
import { and, eq, inArray, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import type { SQLiteColumn } from "drizzle-orm/sqlite-core";

import type { IndexedArtwork, IndexedTrack, PathMove } from "../LibraryStore.ts";
import { refreshArtistImages } from "./artists.ts";
import {
  creditArtists,
  linkAlbums,
  linkTracks,
  relinkCredits,
  storedCredits,
  type CreditSplits,
} from "./credits.ts";
import type { LibraryDatabase } from "./database.ts";
import { settlePendingFavorites } from "./pendingFavorites.ts";
import { linkPlaylistEntries } from "./playlists.ts";
import * as schema from "./schema.ts";
import { leaveKeys, selectJoinedAccount } from "./syncRows.ts";
import { deleteTracks } from "./tracks.ts";

const excluded = (column: SQLiteColumn): SQL => sql.raw(`excluded."${column.name}"`);

const basename = (path: string): string => path.slice(path.lastIndexOf("/") + 1) || path;

const uniqueBy = <A>(items: Iterable<A>, key: (item: A) => string): A[] => {
  const seen = new Map<string, A>();
  for (const item of items) if (!seen.has(key(item))) seen.set(key(item), item);
  return [...seen.values()];
};

const idMap = (rows: readonly { id: number; key: string }[]): Map<string, number> =>
  new Map(rows.map((row) => [row.key, row.id]));

const requireId = (ids: Map<string, number>, key: string, kind: string): number => {
  const id = ids.get(key);
  if (id === undefined) throw new Error(`Missing ${kind} id for ${key}`);
  return id;
};

const primary = (artistIds: readonly number[]): number => {
  const [first] = artistIds;
  if (first === undefined) throw new Error("A credit names no artist");
  return first;
};

/** Paths per statement, well under SQLite's limit on bound values. */
const CHUNK = 500;

/** A Track as it's filed: its tags, its folder and its cover. */
type FiledTrack = Omit<LibraryTrack, "path" | "fileName"> & {
  readonly artworkHash: string | null;
};

/** Where saved Tracks are filed: the rows their tags were saved as. */
interface Filing {
  /** The artists a credit names, primary first. */
  readonly artists: (credits: readonly string[]) => number[];
  readonly genreId: (track: FiledTrack) => number | null;
  readonly folderId: (track: FiledTrack) => number;
  readonly albumId: (track: FiledTrack) => number;
}

/**
 * Saves the artists, genres, folders and albums [tracks] are filed under,
 * their credits split with the store's [splits] (see `credits.ts`).
 */
const fileTracks = (
  tx: LibraryDatabase,
  splits: CreditSplits,
  tracks: readonly FiledTrack[],
): Filing => {
  const { genres, folders, albums } = schema;
  const credited = creditArtists(
    tx,
    splits,
    tracks.flatMap((t) => [t.artistCredits, t.albumArtistCredits]),
  );

  const genreRows = uniqueBy(
    tracks.flatMap((t) =>
      t.genre !== null && t.genreKey !== null && t.genreSort !== null
        ? [{ key: t.genreKey, name: t.genre, sort: t.genreSort }]
        : [],
    ),
    (row) => row.key,
  );
  const genreIds =
    genreRows.length === 0
      ? new Map<string, number>()
      : idMap(
          tx
            .insert(genres)
            .values(genreRows)
            .onConflictDoUpdate({
              target: genres.key,
              set: { name: excluded(genres.name), sort: excluded(genres.sort) },
            })
            .returning({ id: genres.id, key: genres.key })
            .all(),
        );

  const folderRows = uniqueBy(
    tracks.map((t) => ({ path: t.folder, name: basename(t.folder) })),
    (row) => row.path,
  );
  const folderIds = new Map(
    tx
      .insert(folders)
      .values(folderRows)
      .onConflictDoUpdate({ target: folders.path, set: { name: excluded(folders.name) } })
      .returning({ id: folders.id, path: folders.path })
      .all()
      .map((row) => [row.path, row.id] as const),
  );

  const albumRows = uniqueBy(
    tracks.map((t) => ({
      key: t.albumKey,
      title: t.album,
      titleSort: t.albumSort,
      albumArtistId: primary(credited(t.albumArtistCredits)),
      albumArtistCredit: t.albumArtist,
      albumArtistCredits: storedCredits(t.albumArtistCredits),
      year: t.year,
      artworkHash: t.artworkHash,
      compilation: t.compilation,
    })),
    (row) => row.key,
  );
  const albumIds = idMap(
    tx
      .insert(albums)
      .values(albumRows)
      .onConflictDoUpdate({
        target: albums.key,
        set: {
          title: excluded(albums.title),
          titleSort: excluded(albums.titleSort),
          albumArtistCredit: excluded(albums.albumArtistCredit),
          albumArtistCredits: excluded(albums.albumArtistCredits),
          // The first track that has a year or a cover gives it to the album.
          year: sql`coalesce(${albums.year}, ${excluded(albums.year)})`,
          artworkHash: sql`coalesce(${albums.artworkHash}, ${excluded(albums.artworkHash)})`,
          compilation: sql`${albums.compilation} or ${excluded(albums.compilation)}`,
        },
      })
      .returning({ id: albums.id, key: albums.key })
      .all(),
  );

  return {
    artists: credited,
    genreId: (t) => (t.genreKey === null ? null : (genreIds.get(t.genreKey) ?? null)),
    folderId: (t) => requireId(folderIds, t.folder, "folder"),
    albumId: (t) => requireId(albumIds, t.albumKey, "album"),
  };
};

/** Files each saved Track (by id) and its album under every artist their credits name. */
const linkFiled = (
  tx: LibraryDatabase,
  filing: Filing,
  saved: readonly { readonly id: number; readonly track: FiledTrack }[],
): void => {
  linkTracks(
    tx,
    saved.map(({ id, track }) => ({ id, artistIds: filing.artists(track.artistCredits) })),
  );
  linkAlbums(
    tx,
    uniqueBy(saved, ({ track }) => track.albumKey).map(({ track }) => ({
      id: filing.albumId(track),
      artistIds: filing.artists(track.albumArtistCredits),
    })),
  );
};

/** The tag columns of a Track filed by [filing]. */
const tagColumns = (filing: Filing, track: FiledTrack) => ({
  title: track.title,
  titleSort: track.titleSort,
  artistId: primary(filing.artists(track.artistCredits)),
  artistCredit: track.artist,
  artistCredits: storedCredits(track.artistCredits),
  albumId: filing.albumId(track),
  genreId: filing.genreId(track),
  year: track.year,
  trackNumber: track.trackNumber,
  trackTotal: track.trackTotal,
  discNumber: track.discNumber,
  discTotal: track.discTotal,
  durationMs: track.durationMs,
});

/**
 * Gives the files among [tracks] the Library doesn't index yet to the
 * missing songs they are (Core's `fillMissingSongs`: by recording key,
 * length breaking a tie), so the save that follows fills each song in: it
 * keeps its id, and with it its favorites, playlist entries and plays. Files
 * Syncthing brings, or a download, never show twice. A download asked for a
 * missing song (`IndexedTrack.fills`) fills that one in whatever its tags
 * say, and keeps its recording key, so it stays the account's song: the
 * keys kept, by path, for the save to write.
 */
const fillMissing = (tx: LibraryDatabase, tracks: readonly IndexedTrack[]): Map<string, string> => {
  const t = schema.tracks;
  const kept = new Map<string, string>();
  const indexed = new Set<string>();
  for (let i = 0; i < tracks.length; i += CHUNK) {
    const paths = tracks.slice(i, i + CHUNK).map((track) => track.path);
    for (const row of tx.select({ path: t.path }).from(t).where(inArray(t.path, paths)).all()) {
      if (row.path !== null) indexed.add(row.path);
    }
  }
  for (const track of tracks) {
    if (track.fills === undefined) continue;
    const target = tx
      .select({ path: t.path, recordingKey: t.recordingKey })
      .from(t)
      .where(eq(t.id, track.fills))
      .get();
    // Gone (removed meanwhile), or another file's: the file is saved as any other.
    if (target === undefined || (target.path !== null && target.path !== track.path)) continue;
    if (target.path === null) {
      if (indexed.has(track.path)) continue;
      tx.update(t).set({ path: track.path }).where(eq(t.id, track.fills)).run();
      indexed.add(track.path);
    }
    if (target.recordingKey !== null) kept.set(track.path, target.recordingKey);
  }
  const missing = tx
    .select({ id: t.id, recordingKey: t.recordingKey, durationMs: t.durationMs })
    .from(t)
    .where(and(isNull(t.path), isNotNull(t.recordingKey)))
    .all()
    .flatMap(({ recordingKey: key, ...song }) =>
      key === null ? [] : [{ ...song, recordingKey: key }],
    );
  if (missing.length === 0) return kept;
  const found = tracks
    .filter((track) => !indexed.has(track.path))
    .map((track) => ({
      path: track.path,
      recordingKey: recordingKey(track),
      durationMs: track.durationMs,
    }));
  for (const { file, song } of fillMissingSongs(found, missing).filled) {
    tx.update(t).set({ path: file.path }).where(eq(t.id, song.id)).run();
  }
  return kept;
};

/**
 * The Tracks among [paths] that have a recording key, by path: what a save
 * that retags them changes (`saveBatch`).
 */
const selectKeysByPath = (
  tx: LibraryDatabase,
  paths: readonly string[],
): Map<string, { readonly trackId: number; readonly recordingKey: string }> => {
  const t = schema.tracks;
  const keyed = new Map<string, { trackId: number; recordingKey: string }>();
  for (let i = 0; i < paths.length; i += CHUNK) {
    const rows = tx
      .select({ trackId: t.id, path: t.path, recordingKey: t.recordingKey })
      .from(t)
      .where(and(inArray(t.path, paths.slice(i, i + CHUNK)), isNotNull(t.recordingKey)))
      .all();
    for (const { path, recordingKey: key, trackId } of rows) {
      if (path !== null && key !== null) keyed.set(path, { trackId, recordingKey: key });
    }
  }
  return keyed;
};

/**
 * Upserts one scanner batch (and the artwork it references) in a single
 * transaction. [moves] first re-point indexed tracks to the paths they were
 * found under, so they keep their id (and with it history and favorites);
 * new files fill in the missing songs they are (`fillMissing`). Each track
 * is keyed by its tags (Core's `recordingKey`), and keeps the video id a
 * YouTube Music download gave it (`IndexedTrack.videoId`). Signed in, a
 * file retagged to another key leaves its old one (`leaveKeys`): its old
 * version leaves the account, and its star and entries go up under the new key. Tracks and albums
 * are filed under every artist their credit names (see `credits.ts`), split
 * with the store's [splits]. Playlists' YT Music entries that the saved
 * tracks positively are become those tracks (`linkPlaylistEntries`), so a
 * download brings them in; a scan passes [linkEntries] false and links once
 * against the whole Library when it ends. The saved tracks that are pending
 * favorites (a liked song Also add to Favorites couldn't star yet) get their
 * star, and those favorites are settled (`settlePendingFavorites`): what's
 * returned as [SavedBatch.starred].
 */
export const saveBatch = (
  db: LibraryDatabase,
  splits: CreditSplits,
  tracks: readonly IndexedTrack[],
  artworkRows: readonly IndexedArtwork[],
  moves: readonly PathMove[],
  now: number,
  { linkEntries = true }: { readonly linkEntries?: boolean } = {},
): SavedBatch => {
  const { artwork } = schema;
  return db.transaction((tx): SavedBatch => {
    // The upsert below then updates the moved rows by their new path.
    for (const move of moves) {
      tx.update(schema.tracks)
        .set({ path: move.to })
        .where(eq(schema.tracks.path, move.from))
        .run();
    }
    if (artworkRows.length > 0) {
      tx.insert(artwork)
        .values(artworkRows.map((row) => ({ ...row })))
        .onConflictDoUpdate({
          target: artwork.hash,
          set: {
            path: excluded(artwork.path),
            thumbPath: excluded(artwork.thumbPath),
            palette: excluded(artwork.palette),
          },
        })
        .run();
    }
    if (tracks.length === 0) return NOTHING_STARRED;

    const keptKeys = fillMissing(tx, tracks);
    const keys = new Map(
      tracks.map((track) => [track.path, keptKeys.get(track.path) ?? recordingKey(track)]),
    );
    const keyedBefore =
      selectJoinedAccount(tx) === null
        ? new Map<string, { trackId: number; recordingKey: string }>()
        : selectKeysByPath(
            tx,
            tracks.map((track) => track.path),
          );
    const filing = fileTracks(tx, splits, tracks);
    const t = schema.tracks;
    const trackIds = new Map(
      tx
        .insert(t)
        .values(
          tracks.map((track) => ({
            ...tagColumns(filing, track),
            path: track.path,
            recordingKey: keys.get(track.path) ?? recordingKey(track),
            videoId: track.videoId ?? null,
            folderId: filing.folderId(track),
            fileName: track.fileName,
            sizeBytes: track.sizeBytes,
            modifiedAt: track.modifiedAt,
            sampleRate: track.sampleRate,
            bitrateKbps: track.bitrateKbps,
            artworkHash: track.artworkHash,
            hasLyrics: track.hasLyrics,
            explicit: track.explicit,
            addedAt: now,
            scannedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: t.path,
          // Everything but added_at, which keeps the first time the file was seen.
          set: {
            recordingKey: excluded(t.recordingKey),
            // A download's video id stays when the file is saved again without one.
            videoId: sql`coalesce(${excluded(t.videoId)}, ${t.videoId})`,
            folderId: excluded(t.folderId),
            fileName: excluded(t.fileName),
            sizeBytes: excluded(t.sizeBytes),
            modifiedAt: excluded(t.modifiedAt),
            title: excluded(t.title),
            titleSort: excluded(t.titleSort),
            artistId: excluded(t.artistId),
            artistCredit: excluded(t.artistCredit),
            artistCredits: excluded(t.artistCredits),
            albumId: excluded(t.albumId),
            genreId: excluded(t.genreId),
            year: excluded(t.year),
            trackNumber: excluded(t.trackNumber),
            trackTotal: excluded(t.trackTotal),
            discNumber: excluded(t.discNumber),
            discTotal: excluded(t.discTotal),
            durationMs: excluded(t.durationMs),
            sampleRate: excluded(t.sampleRate),
            bitrateKbps: excluded(t.bitrateKbps),
            artworkHash: excluded(t.artworkHash),
            hasLyrics: excluded(t.hasLyrics),
            explicit: excluded(t.explicit),
            scannedAt: excluded(t.scannedAt),
          },
        })
        .returning({ id: t.id, path: t.path })
        .all()
        // Every saved track has its file.
        .flatMap((row) => (row.path === null ? [] : [[row.path, row.id] as const])),
    );

    linkFiled(
      tx,
      filing,
      tracks.map((track) => ({ id: requireId(trackIds, track.path, "track"), track })),
    );
    leaveKeys(
      tx,
      [...keyedBefore].flatMap(([path, before]) =>
        keys.get(path) === before.recordingKey ? [] : [before],
      ),
      { removed: false, now },
    );
    // A song a playlist streamed from YT Music becomes this Library song there.
    if (linkEntries) linkPlaylistEntries(tx, now, [...trackIds.values()]);
    const starred = settlePendingFavorites(
      tx,
      tracks.map((track) => ({
        id: requireId(trackIds, track.path, "track"),
        title: track.title,
        artist: track.artist,
        durationMs: track.durationMs,
        videoId: track.videoId ?? null,
      })),
      now,
    );
    return starred.length === 0 ? NOTHING_STARRED : { starred };
  });
};

/** What a saved batch did besides saving its tracks. */
export interface SavedBatch {
  /** The saved tracks starred as pending favorites (`settlePendingFavorites`). */
  readonly starred: readonly number[];
}

const NOTHING_STARRED: SavedBatch = { starred: [] };

/** Where missing songs are filed: they have no folder on this phone. */
const NO_FOLDER = "";

/**
 * Saves missing songs: Tracks without a file, filed under the album,
 * artists and genre their tags give (as a scanned copy would be). New ones
 * are added; those in the Library get the account's tags. Run it in a
 * transaction, then `pruneOrphans` if tags changed.
 */
export const saveMissingSongs = (
  tx: LibraryDatabase,
  splits: CreditSplits,
  songs: readonly MissingSongSave[],
  now: number,
): number[] => {
  if (songs.length === 0) return [];
  const filed = songs.map((song) => ({
    ...song,
    filed: { ...song.track, folder: NO_FOLDER, artworkHash: null } satisfies FiledTrack,
  }));
  const filing = fileTracks(
    tx,
    splits,
    filed.map((song) => song.filed),
  );
  const t = schema.tracks;
  const saved = filed.map((song) => {
    const tags = {
      ...tagColumns(filing, song.filed),
      recordingKey: song.recordingKey,
      videoId: song.videoId,
    };
    if (song.trackId !== null) {
      tx.update(t).set(tags).where(eq(t.id, song.trackId)).run();
      return { id: song.trackId, track: song.filed };
    }
    const { id } = tx
      .insert(t)
      .values({
        ...tags,
        path: null,
        folderId: filing.folderId(song.filed),
        fileName: "",
        sizeBytes: 0,
        modifiedAt: 0,
        artworkHash: null,
        addedAt: song.addedAt,
        scannedAt: now,
      })
      .returning({ id: t.id })
      .get();
    return { id, track: song.filed };
  });
  linkFiled(tx, filing, saved);
  return saved.map((song) => song.id);
};

/**
 * Deletes the albums, genres and folders no track uses any more, splits the
 * Library's credits again (what left can change how others split) and
 * deletes the artists left without songs, then re-picks the artists' images
 * from the albums left. Run it in the transaction that removed tracks.
 */
export const pruneOrphans = (tx: LibraryDatabase, splits: CreditSplits): void => {
  // Albums first: they hold album artists.
  tx.run(sql`DELETE FROM albums WHERE id NOT IN (SELECT album_id FROM tracks)`);
  relinkCredits(tx, splits);
  tx.run(sql`DELETE FROM genres
    WHERE id NOT IN (SELECT genre_id FROM tracks WHERE genre_id IS NOT NULL)`);
  tx.run(sql`DELETE FROM folders WHERE id NOT IN (SELECT folder_id FROM tracks)`);
  refreshArtistImages(tx);
};

/**
 * Removes the tracks at [paths] and what they leave empty (`pruneOrphans`);
 * a scan runs it when it completes, with the files it no longer found.
 */
export const removeTracks = (
  db: LibraryDatabase,
  splits: CreditSplits,
  paths: readonly string[],
): void => {
  db.transaction((tx) => {
    deleteTracks(tx, paths);
    pruneOrphans(tx, splits);
  });
};

/**
 * Whether one of [roots] has never finished a scan: Music folders shows those
 * without a song count, so their first scan has it re-read even when the
 * scan found nothing.
 */
export const hasUnscannedRoot = (db: LibraryDatabase, roots: readonly string[]): boolean => {
  if (roots.length === 0) return false;
  const { scanRoots } = schema;
  return (
    db
      .select({ path: scanRoots.path })
      .from(scanRoots)
      .where(and(inArray(scanRoots.path, [...roots]), isNull(scanRoots.lastScannedAt)))
      .limit(1)
      .get() !== undefined
  );
};
