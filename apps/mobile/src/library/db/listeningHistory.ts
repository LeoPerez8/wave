import {
  findListeningHistory,
  hasFindQuery,
  UNKNOWN_SONG_TITLE,
  type PlaySnapshot,
  type YtAlbumSong,
} from "@wave/core";
import { and, asc, desc, eq, inArray, isNull, min, sql } from "drizzle-orm";

import type { SongRow } from "../LibraryStore.ts";
import type { LibraryDatabase } from "./database.ts";
import { playEvents, tracks } from "./schema.ts";
import { hasFile, trackQuery } from "./tracks.ts";

export interface ListeningHistoryRow {
  readonly id: number;
  readonly startedAt: number;
  readonly snapshot: PlaySnapshot;
  readonly videoId: string | null;
  readonly recordingKey: string | null;
  readonly streamedSong: YtAlbumSong | null;
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
  title: UNKNOWN_SONG_TITLE,
  artist: "",
  album: null,
  artworkPath: null,
  thumbPath: null,
};

/** Counted plays, including streamed and removed songs and a current play once counted. */
export const listeningHistory = (
  db: LibraryDatabase,
  before?: ListeningHistoryCursor,
  query = "",
): ListeningHistoryPage => {
  const read = (cursor: ListeningHistoryCursor | undefined) =>
    db
      .select({
        id: playEvents.id,
        trackId: playEvents.trackId,
        videoId: playEvents.videoId,
        recordingKey: playEvents.recordingKey,
        streamedSong: playEvents.streamedSong,
        startedAt: playEvents.startedAt,
        snapshot: playEvents.snapshot,
      })
      .from(playEvents)
      .where(
        and(
          eq(playEvents.counted, true),
          isNull(playEvents.importedFrom),
          cursor === undefined
            ? undefined
            : sql`(${playEvents.startedAt}, ${playEvents.id}) < (${cursor.startedAt}, ${cursor.id})`,
        ),
      )
      .orderBy(desc(playEvents.startedAt), desc(playEvents.id))
      .limit(51)
      .all();
  // Scan saved snapshots in bounded pages, hydrating only the 50 displayed matches.
  // Filtering a loaded screen page would miss older plays and removed Library songs.
  let batch = read(before);
  const plays = [] as typeof batch;
  const searching = hasFindQuery(query);
  for (;;) {
    const matches = searching
      ? findListeningHistory(
          batch.map((play) => ({ ...play, snapshot: play.snapshot ?? UNKNOWN })),
          query,
        )
      : batch;
    plays.push(...matches.slice(0, 51 - plays.length));
    const lastScanned = batch.at(-1);
    if (plays.length >= 51 || batch.length < 51 || lastScanned === undefined) break;
    batch = read(lastScanned);
  }
  const shown = plays.slice(0, 50);
  const last = shown.at(-1);
  const videoIds = [
    ...new Set(shown.flatMap(({ videoId }) => (videoId === null ? [] : [videoId]))),
  ];
  const downloaded =
    videoIds.length === 0
      ? []
      : db
          .select({ id: min(tracks.id), videoId: tracks.videoId })
          .from(tracks)
          .where(and(inArray(tracks.videoId, videoIds), hasFile))
          .groupBy(tracks.videoId)
          .all();
  const downloadedByVideo = new Map(downloaded.map(({ id, videoId }) => [videoId, id]));
  const recordingKeys = shown.flatMap((play) =>
    play.trackId === null && play.recordingKey !== null ? [play.recordingKey] : [],
  );
  const recordings =
    recordingKeys.length === 0
      ? []
      : db
          .select({ id: tracks.id, key: tracks.recordingKey })
          .from(tracks)
          .where(and(inArray(tracks.recordingKey, recordingKeys), hasFile))
          .orderBy(asc(tracks.id))
          .all();
  const byKey = new Map<string | null, number>();
  for (const { id, key } of recordings) if (!byKey.has(key)) byKey.set(key, id);
  const songs =
    shown.length === 0
      ? []
      : trackQuery(db)
          .where(
            inArray(tracks.id, [
              ...shown.flatMap(({ trackId }) => (trackId === null ? [] : [trackId])),
              ...downloaded.flatMap(({ id }) => (id === null ? [] : [id])),
              ...byKey.values(),
            ]),
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
      videoId: play.videoId,
      recordingKey: play.recordingKey,
      streamedSong: play.streamedSong,
      song:
        byId.get(
          play.trackId ?? downloadedByVideo.get(play.videoId) ?? byKey.get(play.recordingKey) ?? -1,
        ) ?? null,
    })),
  };
};
