/** Targeted recording candidates, preserving Core's finder and Library ordering. */
import { libraryFinder, recordingMatchTitle, type YtSong } from "@wave/core";
import { eq, isNull, type SQL } from "drizzle-orm";
import type { LibraryDatabase } from "./database.ts";
import { tracks } from "./schema.ts";
import { BY_TITLE, trackQuery } from "./tracks.ts";

/** Title candidates only: callers must still apply Core's artist/duration matching. */
export const matchingSongWhere = (song: Pick<YtSong, "title">): SQL =>
  eq(tracks.matchTitle, recordingMatchTitle(song.title));

export const selectMatchingSong = (db: LibraryDatabase, song: YtSong) =>
  libraryFinder(
    trackQuery(db)
      .where(matchingSongWhere(song))
      .orderBy(...BY_TITLE)
      .all(),
  )(song);

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
