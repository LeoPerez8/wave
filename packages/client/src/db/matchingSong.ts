/** Targeted recording candidates, preserving Core's finder and Library ordering. */
import { recordingMatches, recordingMatchTitle, type YtSong } from "@wave/core";
import { eq, isNull, sql, type SQL } from "drizzle-orm";
import type { LibraryDatabase } from "./database.ts";
import { tracks } from "./schema.ts";
import { BY_TITLE, trackQuery } from "./tracks.ts";
import type { SongRow } from "../types.ts";

/** Title candidates only: callers must still apply Core's artist/duration matching. */
export const matchingSongWhere = (song: Pick<YtSong, "title">): SQL =>
  eq(tracks.matchTitle, recordingMatchTitle(song.title));

export const selectMatchingSong = (db: LibraryDatabase, song: YtSong) =>
  trackQuery(db)
    .where(matchingSongWhere(song))
    .orderBy(...BY_TITLE)
    .all()
    .find((candidate) => recordingMatches(candidate, song)) ?? null;

/**
 * Each of [songs]' match (`selectMatchingSong`), in their order, from one
 * statement over all their titles: a mix build matches a radio's songs in one
 * read, not one read a song (#1351). A title's candidates keep their order.
 */
export const selectMatchingSongs = (db: LibraryDatabase, songs: readonly YtSong[]) => {
  const titles = [...new Set(songs.map((song) => recordingMatchTitle(song.title)))];
  if (titles.length === 0) return [];
  const byTitle = new Map<string, SongRow[]>();
  for (const candidate of trackQuery(db)
    .where(sql`${tracks.matchTitle} IN (SELECT value FROM json_each(${JSON.stringify(titles)}))`)
    .orderBy(...BY_TITLE)
    .all()) {
    const title = recordingMatchTitle(candidate.title);
    const same = byTitle.get(title);
    if (same === undefined) byTitle.set(title, [candidate]);
    else same.push(candidate);
  }
  return songs.map(
    (song) =>
      byTitle
        .get(recordingMatchTitle(song.title))
        ?.find((candidate) => recordingMatches(candidate, song)) ?? null,
  );
};

/** One-time upgrade, bounded reads and writes with a task yield between pages. */
export const backfillRecordingTitles = async (db: LibraryDatabase): Promise<void> => {
  while (true) {
    const rows = db
      .select({ id: tracks.id, title: tracks.title })
      .from(tracks)
      .where(isNull(tracks.matchTitle))
      .limit(128)
      .all();
    if (rows.length === 0) return;
    db.transaction((tx) => {
      for (const row of rows)
        tx.update(tracks)
          .set({ matchTitle: recordingMatchTitle(row.title) })
          .where(eq(tracks.id, row.id))
          .run();
    });
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
};
