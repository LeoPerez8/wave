import type { PlaySnapshot } from "@wave/core";
import { and, desc, eq, inArray, isNull, sql } from "drizzle-orm";

import type { SongRow } from "../LibraryStore.ts";
import type { LibraryDatabase } from "./database.ts";
import { playEvents, tracks } from "./schema.ts";
import { trackQuery } from "./tracks.ts";

export interface ListeningHistoryRow {
  readonly id: number;
  readonly startedAt: number;
  readonly snapshot: PlaySnapshot;
  /** Current Library metadata for playback/menu actions; null for a removed song. */
  readonly song: SongRow | null;
}

export interface ListeningHistoryCursor {
  readonly startedAt: number;
  readonly id: number;
}

export interface ListeningHistoryPage {
  readonly rows: readonly ListeningHistoryRow[];
  readonly next: ListeningHistoryCursor | null;
}

const UNKNOWN: PlaySnapshot = {
  title: "Unknown song",
  artist: "",
  album: null,
  artworkPath: null,
  thumbPath: null,
};

/** Counted Library plays, including removed songs and a current play once counted. */
export const listeningHistory = (
  db: LibraryDatabase,
  before?: ListeningHistoryCursor,
): ListeningHistoryPage => {
  const plays = db
    .select({
      id: playEvents.id,
      trackId: playEvents.trackId,
      startedAt: playEvents.startedAt,
      snapshot: playEvents.snapshot,
    })
    .from(playEvents)
    .where(
      and(
        eq(playEvents.counted, true),
        isNull(playEvents.importedFrom),
        before === undefined
          ? undefined
          : sql`(${playEvents.startedAt}, ${playEvents.id}) < (${before.startedAt}, ${before.id})`,
      ),
    )
    .orderBy(desc(playEvents.startedAt), desc(playEvents.id))
    .limit(51)
    .all();
  const shown = plays.slice(0, 50);
  const last = shown.at(-1);
  const songs =
    shown.length === 0
      ? []
      : trackQuery(db)
          .where(
            inArray(
              tracks.id,
              shown.map(({ trackId }) => trackId),
            ),
          )
          .all();
  const byId = new Map(songs.map((song) => [song.id, song]));
  return {
    next:
      plays.length > 50 && last !== undefined ? { id: last.id, startedAt: last.startedAt } : null,
    rows: shown.map((play) => ({
      id: play.id,
      startedAt: play.startedAt,
      snapshot: play.snapshot ?? UNKNOWN,
      song: byId.get(play.trackId) ?? null,
    })),
  };
};
