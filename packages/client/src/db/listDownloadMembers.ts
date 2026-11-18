import {
  albumDownloadMembers,
  readPlaylistEntrySong,
  readUnsearchedTrackId,
  unsearchedTrackId,
  type DownloadListMember,
  type ListDownloadsScope,
} from "@wave/core";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { LibraryDatabase } from "./database.ts";
import { chunks } from "./chunks.ts";
import { playlistItems, playlists, tracks, videoIdIn, listedTitleIn } from "./schema.ts";

/** A common address for progress readers on playlist and album lists. */
export type DownloadListKey = `${"playlist" | "album"}:${number}`;
export type DownloadListMembers = ReadonlyMap<DownloadListKey, readonly DownloadListMember[]>;

/**
 * Read only entries belonging to journal songs or saved files, using the video,
 * listed-title, path and track indexes. No playlist or album page, totals or covers.
 */
export const selectListDownloadMembers = (
  db: LibraryDatabase,
  scope: ListDownloadsScope,
): DownloadListMembers => {
  const result = new Map<DownloadListKey, DownloadListMember[]>();
  const seen = new Set<number>();
  const add = (id: number, playlistId: number, member: DownloadListMember): void => {
    if (seen.has(id)) return;
    seen.add(id);
    const key: DownloadListKey = `playlist:${playlistId}`;
    const members = result.get(key) ?? [];
    members.push(member);
    result.set(key, members);
  };
  const live = and(eq(playlistItems.deleted, false), eq(playlists.deleted, false));
  for (const ids of chunks(scope.videoIds)) {
    const rows = db
      .select({
        id: playlistItems.id,
        playlistId: playlistItems.playlistId,
        videoId: sql<string>`${videoIdIn(playlistItems.ytSong)}`,
      })
      .from(playlistItems)
      .innerJoin(playlists, eq(playlists.id, playlistItems.playlistId))
      .where(
        and(
          live,
          isNotNull(playlistItems.ytSong),
          inArray(videoIdIn(playlistItems.ytSong), [...ids]),
        ),
      )
      .all();
    for (const row of rows) add(row.id, row.playlistId, { kind: "song", videoId: row.videoId });
  }
  const listed = scope.videoIds.flatMap((id) => {
    const song = readUnsearchedTrackId(id);
    return song === null ? [] : [song];
  });
  const wanted = new Set(scope.videoIds);
  for (const titles of chunks([...new Set(listed.map(({ title }) => title))])) {
    const columns = {
      id: playlistItems.id,
      playlistId: playlistItems.playlistId,
      stored: playlistItems.ytSong,
    };
    const rows = db
      .select(columns)
      .from(playlistItems)
      .innerJoin(playlists, eq(playlists.id, playlistItems.playlistId))
      .where(
        and(
          live,
          isNotNull(playlistItems.ytSong),
          inArray(listedTitleIn(playlistItems.ytSong), [...titles]),
        ),
      )
      .all();
    // Unavailable entries whose own search failed still count in the page head.
    for (const row of rows) {
      const stored = row.stored === null ? null : readPlaylistEntrySong(row.stored);
      if (stored === null || stored.source === "stream") continue;
      const videoId = unsearchedTrackId(stored.song);
      if (wanted.has(videoId)) add(row.id, row.playlistId, { kind: "song", videoId });
    }
  }
  for (const paths of chunks(scope.savedPaths)) {
    const rows = db
      .select({ id: playlistItems.id, playlistId: playlistItems.playlistId, path: tracks.path })
      .from(tracks)
      .innerJoin(playlistItems, eq(playlistItems.trackId, tracks.id))
      .innerJoin(playlists, eq(playlists.id, playlistItems.playlistId))
      .where(and(live, inArray(tracks.path, [...paths])))
      .all();
    for (const row of rows)
      if (row.path !== null) add(row.id, row.playlistId, { kind: "file", path: row.path });
  }
  // Albums: one read by path says which album each saved file went to (Core's `albumDownloadMembers`).
  const albumSongs = scope.albumSongs ?? [];
  const albumOfPath = new Map<string, number>();
  const saved = albumSongs.flatMap(({ savedPath }) => (savedPath === null ? [] : [savedPath]));
  for (const paths of chunks([...new Set(saved)])) {
    const rows = db
      .select({ path: tracks.path, albumId: tracks.albumId })
      .from(tracks)
      .where(inArray(tracks.path, [...paths]))
      .all();
    for (const row of rows) if (row.path !== null) albumOfPath.set(row.path, row.albumId);
  }
  for (const [albumId, members] of albumDownloadMembers(
    albumSongs,
    (path) => albumOfPath.get(path) ?? null,
  ))
    result.set(`album:${albumId}`, members);
  return result;
};
