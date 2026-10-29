/**
 * An importing playlist's progress (docs/spec.md, "Importing playlists from
 * a link", Progress): the phase it's in, its counts, the line that stands in
 * for "0 songs" on its Library row and its page, and the whole import as one
 * fraction for its cover's ring.
 *
 * A From YT Music or From Spotify playlist waits in the batch (Core's
 * `YtLibraryBatch`, which keeps its expected count), then its source's pages
 * are read, its songs matched with the Library (and starred when asked),
 * then added to it a slice at a time. A From a Link import has read and
 * matched before its playlist exists, so it only shows adding. The phases
 * past waiting live while Wave runs, on a board kept by playlist
 * (`ImportProgressBoard`); once a playlist's import is done its entry goes
 * and the live count is back.
 */

import { formatNumber } from "./formatting.ts";
import { catalogueOf, type AppLanguage } from "./localisation.ts";
import { YT_PLAYLIST_SONG_CAP } from "./ytPlaylist.ts";
import type { YtLibraryBatch, YtLibraryRead } from "./ytLibraryBatch.ts";

/** Queued in the batch, not read yet; [total] is the count its picker showed, if any. */
export interface WaitingProgress {
  readonly phase: "waiting";
  readonly total: number | null;
}

/** The source's pages arriving: [done] songs read of [total] (null when nothing says). */
export interface ReadingProgress {
  readonly phase: "reading";
  readonly done: number;
  readonly total: number | null;
}

/** The songs read being matched with the Library, then starred if asked. No count. */
export interface MatchingProgress {
  readonly phase: "matching";
}

/** The songs landing in the playlist: [done] of [total]. */
export interface AddingProgress {
  readonly phase: "adding";
  readonly done: number;
  readonly total: number;
}

/** Where an importing playlist is. A playlist that's done has none. */
export type ImportProgress = WaitingProgress | ReadingProgress | MatchingProgress | AddingProgress;

/** The live phases (past waiting) of the playlists importing while Wave runs, by playlist id. */
export type ImportProgressBoard = ReadonlyMap<number, ImportProgress>;

/** No playlist importing past waiting. */
export const NO_IMPORT_PROGRESS: ImportProgressBoard = new Map();

/** Matching with the Library. */
export const MATCHING_PROGRESS: MatchingProgress = { phase: "matching" };

/** [read]'s source read up to [done] songs. Its total is [sourceTotal] when the source gives one
 * (Spotify's first page), else the count its picker showed; a capped read (a YouTube Music
 * playlist other than Liked Songs) counts up to `YT_PLAYLIST_SONG_CAP`, and a count gone stale
 * never reads past what's been read.
 */
export const readingProgress = (
  read: Pick<YtLibraryRead, "capped" | "expected">,
  done: number,
  sourceTotal: number | null,
): ReadingProgress => {
  const given = sourceTotal ?? read.expected;
  if (given === null) return { phase: "reading", done, total: null };
  const capped = read.capped ? Math.min(given, YT_PLAYLIST_SONG_CAP) : given;
  return { phase: "reading", done, total: Math.max(capped, done) };
};

/** [done] of [total] songs added to the playlist. */
export const addingProgress = (done: number, total: number): AddingProgress => ({
  phase: "adding",
  done,
  total,
});

/** Waiting for [read], with the count its picker showed. */
const waitingProgress = (read: YtLibraryRead): WaitingProgress => ({
  phase: "waiting",
  total: read.expected,
});

/**
 * The whole import as a fraction from 0 to 1: reading fills the first half
 * (none while nothing gives a total), matching holds at half, adding fills
 * the second half. Waiting is empty.
 */
export const importProgressFraction = (progress: ImportProgress): number => {
  switch (progress.phase) {
    case "waiting":
      return 0;
    case "reading":
      return progress.total === null || progress.total === 0
        ? 0
        : Math.min(progress.done / progress.total, 1) / 2;
    case "matching":
      return 0.5;
    case "adding":
      return progress.total === 0 ? 1 : 0.5 + Math.min(progress.done / progress.total, 1) / 2;
  }
};

/** The ring over an importing playlist's cover: how full it is, and whether it pulses. */
export interface ImportRing {
  /** The whole import, 0 to 1 (`importProgressFraction`). */
  readonly fraction: number;
  /** Matching with the Library, which has no count: the ring holds at half and pulses. */
  readonly pulses: boolean;
}

/**
 * The ring an importing playlist's cover shows for [progress]; none when it
 * isn't importing. Waiting, it's empty; reading and adding fill it, still
 * between steps (a read paused offline holds where it stopped); matching
 * holds it at half, pulsing.
 */
export const importRing = (progress: ImportProgress | null): ImportRing | null =>
  progress === null
    ? null
    : { fraction: importProgressFraction(progress), pulses: progress.phase === "matching" };

/** A count as the import lines show it ("2,300"). */
export const importCount = (count: number, language: AppLanguage = "en"): string =>
  formatNumber(language, count);

/**
 * The line under an importing playlist's name (its Library row) and under
 * its length (its page): "Waiting · 1,234 songs" (or "Waiting"), "Reading
 * 2,300 of 10,000" (or "Reading 2,300"), "Matching with Library…", "Adding
 * 340 of 10,000".
 */
export const importProgressLine = (
  progress: ImportProgress,
  language: AppLanguage = "en",
): string => {
  const text = catalogueOf(language).imports;
  const count = (value: number) => importCount(value, language);
  switch (progress.phase) {
    case "waiting":
      return progress.total === null ? text.waiting : text.waitingSongs(progress.total);
    case "reading":
      return progress.total === null
        ? text.readingCount(count(progress.done))
        : text.readingOf(count(progress.done), count(progress.total));
    case "matching":
      return text.matching;
    case "adding":
      return text.addingOf(count(progress.done), count(progress.total));
  }
};

const sameProgress = (a: ImportProgress, b: ImportProgress): boolean =>
  a.phase === b.phase &&
  ("done" in a ? a.done : null) === ("done" in b ? b.done : null) &&
  ("total" in a ? a.total : null) === ("total" in b ? b.total : null);

/**
 * [board] with [playlistId] now at [progress]. It never runs backwards: a
 * read started again (the batch resumed after a pause) keeps the furthest
 * line until it passes it. A step that changes nothing gives [board] back.
 * A playlist starting over (refreshed) is cleared first (`clearImportProgress`).
 */
export const setImportProgress = (
  board: ImportProgressBoard,
  playlistId: number,
  progress: ImportProgress,
): ImportProgressBoard => {
  const previous = board.get(playlistId);
  if (previous !== undefined) {
    if (sameProgress(previous, progress)) return board;
    if (importProgressFraction(progress) < importProgressFraction(previous)) return board;
  }
  return new Map(board).set(playlistId, progress);
};

/** [board] without [playlistId]: its import is done, ended, or starts over. */
export const clearImportProgress = (
  board: ImportProgressBoard,
  playlistId: number,
): ImportProgressBoard => {
  if (!board.has(playlistId)) return board;
  const next = new Map(board);
  next.delete(playlistId);
  return next;
};

/**
 * Where [playlistId]'s import stands, from the [batch] and the live
 * [board]; null when it isn't importing (or is done), so its live count
 * shows. Waiting in the batch, it's the board's phase, or Waiting with its
 * expected count when nothing has happened since it was queued (Wave
 * started again, it's still to come), so a resumed batch shows the same
 * lines. A paused batch keeps the line it paused on. A failed read shows
 * none: its page says "Couldn't read it online" (`ytLibraryReadView`). A
 * playlist not in the batch (a link import, or a read done) shows the
 * board's phase, if any.
 */
export const importProgress = (
  batch: YtLibraryBatch,
  board: ImportProgressBoard,
  playlistId: number,
): ImportProgress | null => {
  const read = batch.reads.find((queued) => queued.playlistId === playlistId);
  if (read?.state === "failed") return null;
  const live = board.get(playlistId);
  if (live !== undefined) return live;
  return read?.state === "waiting" ? waitingProgress(read) : null;
};

/**
 * Every importing playlist's progress, by playlist id (`importProgress` for
 * each playlist the [batch] or the [board] has). Given the map it last
 * gave as [previous], a playlist whose progress didn't change keeps the
 * same object, so a row reading its own entry draws again only when its
 * line does.
 */
export const importProgressByPlaylist = (
  batch: YtLibraryBatch,
  board: ImportProgressBoard,
  previous: ReadonlyMap<number, ImportProgress> = new Map(),
): ReadonlyMap<number, ImportProgress> => {
  const ids = new Set([...batch.reads.map((read) => read.playlistId), ...board.keys()]);
  const all = new Map<number, ImportProgress>();
  for (const id of ids) {
    const progress = importProgress(batch, board, id);
    if (progress === null) continue;
    const before = previous.get(id);
    all.set(id, before !== undefined && sameProgress(before, progress) ? before : progress);
  }
  return all;
};
