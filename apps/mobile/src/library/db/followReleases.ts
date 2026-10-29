import { followArtistKey, type FollowRelease } from "@wave/core";
import { and, eq, gt, inArray } from "drizzle-orm";
import type { LibraryDatabase } from "./database.ts";
import {
  followReleaseCache,
  hiddenFollowReleases,
  tracks,
  albums,
  artists,
  playTotals,
  streamedTotals,
  playEvents,
} from "./schema.ts";
export const readFollowReleases = (db: LibraryDatabase) => ({
  artists: db.select().from(followReleaseCache).all(),
  hidden: db
    .select()
    .from(hiddenFollowReleases)
    .all()
    .map((r) => r.key),
});
export const saveFollowReleases = (
  db: LibraryDatabase,
  key: string,
  releases: readonly FollowRelease[],
  checkedAt: number,
): void => {
  const row = { key, releases: [...releases], checkedAt };
  db.insert(followReleaseCache)
    .values(row)
    .onConflictDoUpdate({ target: followReleaseCache.key, set: row })
    .run();
};
export const hideFollowRelease = (db: LibraryDatabase, key: string): void => {
  db.insert(hiddenFollowReleases).values({ key }).onConflictDoNothing().run();
};
/** Read only candidate albums and their songs; play checks use the existing totals indexes. */
export const followReleaseListening = (
  db: LibraryDatabase,
  releases: readonly FollowRelease[],
  names: Readonly<Record<string, string>>,
) => {
  const played = new Set<string>();
  const enriched = releases.map((r) => {
    const owned = db
      .select({ id: albums.id, name: artists.name })
      .from(albums)
      .innerJoin(artists, eq(albums.albumArtistId, artists.id))
      .where(eq(albums.title, r.title))
      .all()
      .find(
        (a) =>
          followArtistKey(a.name) === r.artistKey ||
          followArtistKey(a.name) === followArtistKey(names[r.artistKey] ?? ""),
      );
    const songs =
      owned === undefined
        ? []
        : db
            .select({ key: tracks.recordingKey, video: tracks.videoId, id: tracks.id })
            .from(tracks)
            .where(eq(tracks.albumId, owned.id))
            .all();
    const ids = [...new Set([...r.videoIds, ...songs.flatMap((s) => (s.video ? [s.video] : []))])];
    if (ids.length)
      for (const t of db
        .select()
        .from(streamedTotals)
        .where(and(inArray(streamedTotals.videoId, ids), gt(streamedTotals.countedPlays, 0)))
        .all())
        played.add(t.videoId);
    const keys = [
      ...new Set([...r.recordingKeys, ...songs.flatMap((s) => (s.key ? [s.key] : []))]),
    ];
    if (keys.length)
      for (const p of db
        .select({ key: playEvents.recordingKey })
        .from(playEvents)
        .where(and(inArray(playEvents.recordingKey, keys), eq(playEvents.counted, true)))
        .all())
        if (p.key) played.add(p.key);
    if (songs.length)
      for (const p of db
        .select()
        .from(playTotals)
        .where(
          and(
            inArray(
              playTotals.trackId,
              songs.map((s) => s.id),
            ),
            gt(playTotals.countedPlays, 0),
          ),
        )
        .all()) {
        const song = songs.find((s) => s.id === p.trackId);
        if (song?.key) played.add(song.key);
      }
    return { ...r, libraryAlbumId: owned?.id ?? null, recordingKeys: keys, videoIds: ids };
  });
  return { releases: enriched, countedPlays: [...played] };
};
export type FollowReleaseCache = ReturnType<typeof readFollowReleases>;
