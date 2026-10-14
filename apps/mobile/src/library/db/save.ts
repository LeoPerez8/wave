/**
 * Saving scanned tracks into the library database and pruning what removed
 * tracks leave empty. Kept free of Expo so the store tests run it against a
 * real SQLite (`testDatabase.ts`).
 */
import { eq, sql, type SQL } from "drizzle-orm";
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
import { linkPlaylistEntries } from "./playlists.ts";
import * as schema from "./schema.ts";
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

/**
 * Upserts one scanner batch (and the artwork it references) in a single
 * transaction. [moves] first re-point indexed tracks to the paths they were
 * found under, so they keep their id (and with it history and favorites).
 * Tracks and albums are filed under every artist their credit names (see
 * `credits.ts`), split with the store's [splits]. Playlists' YT Music entries
 * that the saved tracks positively are become those tracks
 * (`linkPlaylistEntries`), so a download brings them in; a scan passes
 * [linkEntries] false and links once against the whole Library when it ends.
 */
export const saveBatch = (
  db: LibraryDatabase,
  splits: CreditSplits,
  tracks: readonly IndexedTrack[],
  artworkRows: readonly IndexedArtwork[],
  moves: readonly PathMove[],
  now: number,
  { linkEntries = true }: { readonly linkEntries?: boolean } = {},
): void => {
  const { genres, folders, albums, artwork } = schema;
  db.transaction((tx) => {
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
    if (tracks.length === 0) return;

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

    const t = schema.tracks;
    const trackIds = new Map(
      tx
        .insert(t)
        .values(
          tracks.map((track) => ({
            path: track.path,
            folderId: requireId(folderIds, track.folder, "folder"),
            fileName: track.fileName,
            sizeBytes: track.sizeBytes,
            modifiedAt: track.modifiedAt,
            title: track.title,
            titleSort: track.titleSort,
            artistId: primary(credited(track.artistCredits)),
            artistCredit: track.artist,
            artistCredits: storedCredits(track.artistCredits),
            albumId: requireId(albumIds, track.albumKey, "album"),
            genreId: track.genreKey === null ? null : (genreIds.get(track.genreKey) ?? null),
            year: track.year,
            trackNumber: track.trackNumber,
            trackTotal: track.trackTotal,
            discNumber: track.discNumber,
            discTotal: track.discTotal,
            durationMs: track.durationMs,
            sampleRate: track.sampleRate,
            bitrateKbps: track.bitrateKbps,
            artworkHash: track.artworkHash,
            hasLyrics: track.hasLyrics,
            addedAt: now,
            scannedAt: now,
          })),
        )
        .onConflictDoUpdate({
          target: t.path,
          // Everything but added_at, which keeps the first time the file was seen.
          set: {
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
            scannedAt: excluded(t.scannedAt),
          },
        })
        .returning({ id: t.id, path: t.path })
        .all()
        // Every saved track has its file.
        .flatMap((row) => (row.path === null ? [] : [[row.path, row.id] as const])),
    );

    linkTracks(
      tx,
      tracks.map((track) => ({
        id: requireId(trackIds, track.path, "track"),
        artistIds: credited(track.artistCredits),
      })),
    );
    linkAlbums(
      tx,
      uniqueBy(tracks, (track) => track.albumKey).map((track) => ({
        id: requireId(albumIds, track.albumKey, "album"),
        artistIds: credited(track.albumArtistCredits),
      })),
    );
    // A song a playlist streamed from YT Music becomes this Library song there.
    if (linkEntries) linkPlaylistEntries(tx, now, [...trackIds.values()]);
  });
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
