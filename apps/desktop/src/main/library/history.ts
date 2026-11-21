/**
 * Listening History as the window's table shows it (docs/spec.md, "Listening History"): the
 * shared history reads, each play as a song row with what it does now.
 */
import type { LibraryDatabase } from "@wave/client/db/database";
import {
  listeningHistory,
  listeningHistoryAround,
  newerListeningHistory,
  type ListeningHistoryRow,
} from "@wave/client/db/listeningHistory";
import {
  listeningHistoryRowState,
  ytTrackId,
  type ListeningHistoryFrom,
  type YtAlbumSong,
} from "@wave/core";
import type { BrowseRow } from "../../shared/browse.ts";
import type { HistoryPage } from "../../shared/history.ts";
import { ytRow } from "../../shared/yt.ts";
import { browseSongs } from "./browse.ts";

/** What the rows need from the rest of main. */
export interface HistoryHost {
  /** Whether YT Music is on: off, streamed plays are dimmed and nothing asks YouTube. */
  readonly ytMusic: boolean;
  /** Tells YT Music's service the streamed songs shown, for their menus and replays. */
  readonly keep: (songs: readonly YtAlbumSong[]) => void;
  /** Whether a Library file's folder is disconnected. */
  readonly unavailable: (path: string) => boolean;
}

/** Videos YouTube refused this session: the desktop doesn't track them yet. */
const NONE_REFUSED: ReadonlySet<string> = new Set();

const removed = (play: ListeningHistoryRow): BrowseRow => ({
  id: 0,
  title: play.snapshot.title,
  artist: play.snapshot.artist,
  album: play.snapshot.album ?? "",
  artworkHash: null,
  durationMs: 0,
  count: 0,
  year: null,
  genre: null,
  trackNumber: null,
  favorite: false,
  path: null,
  unavailable: true,
});

/** A page older than a cursor (the newest without one), newer than one, or around a play. */
export const historyPage = (
  db: LibraryDatabase,
  from: ListeningHistoryFrom,
  query: string,
  host: HistoryHost,
): HistoryPage => {
  const page =
    "around" in from
      ? listeningHistoryAround(db, from.around)
      : "after" in from
        ? newerListeningHistory(db, from.after)
        : listeningHistory(db, from.before, query);
  const songs = new Map(
    browseSongs(
      db,
      page.rows.flatMap(({ song }) => (song === null ? [] : [song.id])),
    ).map((row) => [row.id, row]),
  );
  const streams: YtAlbumSong[] = [];
  const rows = page.rows.map((play) => {
    const { replays } = listeningHistoryRowState(play, host.ytMusic, NONE_REFUSED);
    const { id, startedAt, snapshot } = play;
    const row = play.song === null ? undefined : songs.get(play.song.id);
    // The row shows the title and artists the song was played as.
    const shown = { title: snapshot.title, artist: snapshot.artist };
    if (row !== undefined)
      return {
        id,
        startedAt,
        replays,
        song: {
          ...row,
          ...shown,
          unavailable: row.path !== null && host.unavailable(row.path),
        },
      };
    if (replays === "stream" && play.streamedSong !== null) {
      streams.push(play.streamedSong);
      return { id, startedAt, replays, song: { ...ytRow(play.streamedSong), ...shown } };
    }
    return { id, startedAt, replays: null, song: removed(play) };
  });
  if (streams.length > 0) host.keep(streams);
  return { rows, next: page.next, newer: page.newer };
};

/** What replaying the play [playId] queues: its Library song or its stream, or null for neither. */
export const historyReplay = (
  db: LibraryDatabase,
  playId: number,
  ytMusic: boolean,
): { readonly id: string; readonly streams: readonly YtAlbumSong[] } | null => {
  const play = listeningHistoryAround(db, playId).rows.find(({ id }) => id === playId);
  if (play === undefined) return null;
  const { replays } = listeningHistoryRowState(play, ytMusic, NONE_REFUSED);
  if (replays === "library" && play.song !== null) return { id: String(play.song.id), streams: [] };
  if (replays === "stream" && play.streamedSong !== null)
    return { id: ytTrackId(play.streamedSong.videoId), streams: [play.streamedSong] };
  return null;
};
