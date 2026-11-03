import {
  findListeningHistory,
  hasFindQuery,
  UNKNOWN_SONG_TITLE,
  type PlaySnapshot,
  type YtAlbumSong,
} from "@wave/core";
import { and, asc, desc, eq, inArray, isNull, min, sql, type SQL } from "drizzle-orm";

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
  /** Where older plays go on, or null at the first play. */
  readonly next: ListeningHistoryCursor | null;
  /** Where newer plays go on, for a page opened at a moment; null when it reaches the newest play. */
  readonly newer: ListeningHistoryCursor | null;
}

const UNKNOWN: PlaySnapshot = {
  title: UNKNOWN_SONG_TITLE,
  artist: "",
  album: null,
  artworkPath: null,
  thumbPath: null,
};

const PAGE = 50;

/** Counted plays in [order] by start, past [where]: the rows history shows. */
const readPlays = (
  db: LibraryDatabase,
  where: SQL | undefined,
  order: "newest" | "oldest",
  limit: number,
) => {
  const by = order === "newest" ? desc : asc;
  return db
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
    .where(and(eq(playEvents.counted, true), isNull(playEvents.importedFrom), where))
    .orderBy(by(playEvents.startedAt), by(playEvents.id))
    .limit(limit)
    .all();
};

type Play = ReturnType<typeof readPlays>[number];

const olderThan = (cursor: ListeningHistoryCursor) =>
  sql`(${playEvents.startedAt}, ${playEvents.id}) < (${cursor.startedAt}, ${cursor.id})`;
const newerThan = (cursor: ListeningHistoryCursor) =>
  sql`(${playEvents.startedAt}, ${playEvents.id}) > (${cursor.startedAt}, ${cursor.id})`;
const cursorOf = ({ id, startedAt }: Play): ListeningHistoryCursor => ({ id, startedAt });

/** The cursor a read older than starts at [play] itself: ids are integers, so none sits between. */
export const startingAt = (play: ListeningHistoryCursor): ListeningHistoryCursor => ({
  startedAt: play.startedAt,
  id: play.id + 1,
});

/** Counted plays, including streamed and removed songs and a current play once counted. */
export const listeningHistory = (
  db: LibraryDatabase,
  before?: ListeningHistoryCursor,
  query = "",
): ListeningHistoryPage => {
  const read = (cursor: ListeningHistoryCursor | undefined) =>
    readPlays(db, cursor === undefined ? undefined : olderThan(cursor), "newest", PAGE + 1);
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
    plays.push(...matches.slice(0, PAGE + 1 - plays.length));
    const lastScanned = batch.at(-1);
    if (plays.length > PAGE || batch.length <= PAGE || lastScanned === undefined) break;
    batch = read(lastScanned);
  }
  const shown = plays.slice(0, PAGE);
  const last = shown.at(-1);
  return {
    next: plays.length > PAGE && last !== undefined ? cursorOf(last) : null,
    newer: null,
    rows: hydrate(db, shown),
  };
};

/** The 50 plays just newer than [after], newest first, as a page opened at a moment reads upward. */
export const newerListeningHistory = (
  db: LibraryDatabase,
  after: ListeningHistoryCursor,
): ListeningHistoryPage => {
  const plays = readPlays(db, newerThan(after), "oldest", PAGE + 1);
  const shown = plays.slice(0, PAGE).reverse();
  const newest = shown[0];
  return {
    next: startingAt(after),
    newer: plays.length > PAGE && newest !== undefined ? cursorOf(newest) : null,
    rows: hydrate(db, shown),
  };
};

/**
 * The plays around [playId], newest first: 25 newer than it, then it and 24
 * older, fewer newer near the newest play. A play history doesn't show
 * (uncounted, imported, gone) opens the newest page instead.
 */
export const listeningHistoryAround = (
  db: LibraryDatabase,
  playId: number,
): ListeningHistoryPage => {
  const target = readPlays(db, eq(playEvents.id, playId), "newest", 1)[0];
  if (target === undefined) return listeningHistory(db);
  const half = PAGE / 2;
  const newer = readPlays(db, newerThan(target), "oldest", half + 1);
  const older = readPlays(db, olderThan(target), "newest", PAGE - Math.min(newer.length, half));
  const above = newer.slice(0, half).reverse();
  const shown = [...above, target, ...older.slice(0, PAGE - 1 - above.length)];
  const newest = shown[0]!;
  const oldest = shown.at(-1)!;
  return {
    next: older.length > shown.length - 1 - above.length ? cursorOf(oldest) : null,
    newer: newer.length > half ? cursorOf(newest) : null,
    rows: hydrate(db, shown),
  };
};

/** [shown] plays with the Library songs they replay now, read in one query for the page. */
const hydrate = (db: LibraryDatabase, shown: readonly Play[]): ListeningHistoryRow[] => {
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
  return shown.map((play) => ({
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
  }));
};
