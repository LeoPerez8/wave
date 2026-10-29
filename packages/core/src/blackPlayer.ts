/**
 * Importing BlackPlayer's listening history: its track-stat files
 * (`BlackPlayer EX Track Stat Autosave.bpstat`) hold each song's play count,
 * cumulatively. Several snapshots of the file, compared, date the plays.
 */

import { foldAccentsAndCase } from "./library.ts";
import { catalogueOf, type AppLanguage } from "./localisation.ts";
import { libraryPathIndex, pathKey, type M3uImportSummary } from "./m3u.ts";
import { normalizeSearchText } from "./search.ts";
import { libraryMatches } from "./ytMusic.ts";

/** One line of a `.bpstat` file: a song and its play count when the file was saved. */
export interface BpstatRow {
  readonly plays: number;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  /** The file's absolute path on the phone. */
  readonly path: string;
  /** When BlackPlayer first saw the file (ms). */
  readonly addedAt: number;
  /** When it was last played (ms). */
  readonly lastPlayedAt: number;
}

/** A picked file: its name, and its text (null when it couldn't be read). */
export interface BlackPlayerFile {
  readonly name: string;
  readonly text: string | null;
}

/** A Library track as an import matches it. */
export interface BlackPlayerTrack<Id> {
  readonly id: Id;
  readonly path: string;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  /** 0 when the file's length couldn't be read. */
  readonly durationMs: number;
}

/** The BlackPlayer plays of a track already in the play history. */
export interface ImportedPlays<Id> {
  readonly trackId: Id;
  readonly plays: number;
  /** When the latest of them started. */
  readonly latestAt: number;
}

/** A play to add to the history, dated by the snapshots. */
export interface BlackPlayerPlay<Id> {
  readonly trackId: Id;
  readonly startedAt: number;
}

/** A song in the snapshots that matched no Library song. */
export interface BlackPlayerUnmatched {
  readonly title: string;
  readonly artist: string;
  /** Its plays, which weren't imported. */
  readonly plays: number;
}

/** What importing a set of snapshots adds. */
export interface BlackPlayerImport<Id> {
  /** The plays not in the history yet, oldest first. */
  readonly plays: readonly BlackPlayerPlay<Id>[];
  /** The songs with plays that matched no Library song, by artist, then title. */
  readonly unmatched: readonly BlackPlayerUnmatched[];
  /** How many of the files were snapshots. */
  readonly snapshots: number;
  /** The files that weren't, in the order picked. */
  readonly skipped: readonly {
    readonly file: string;
    readonly reason: "unreadable" | "notStats";
  }[];
}

/** One song of the snapshots: its latest row and its plays' dates. */
interface Timeline {
  latest: BpstatRow;
  /** Its play count so far: the highest any snapshot gave. */
  plays: number;
  readonly dates: number[];
}

/**
 * The plays a set of `.bpstat` snapshots adds to the play history. Snapshots
 * are ordered by their content (a snapshot's time is its latest last play),
 * and the plays a song gained between two of them are spread evenly over that
 * interval; those already in the earliest are spread from when the song was
 * added. No play is dated after the song's last play.
 *
 * A row is the Library song at its path (in any case, as Android's storage
 * is), else the one with its title and artist (compared as YT Music songs are,
 * `libraryFinder`), so moved files still match. A row has no length to tell
 * recordings apart, so when several Library songs have its title and artist
 * it takes the only one on its album, and is unmatched rather than guess.
 */
export const planBlackPlayerImport = <Id>(
  files: readonly BlackPlayerFile[],
  library: readonly BlackPlayerTrack<Id>[],
  imported: readonly ImportedPlays<Id>[],
): BlackPlayerImport<Id> => {
  const byPath = libraryPathIndex(library.map(({ id, path }) => ({ id, path })));
  const byTags = tagMatcher(library);
  const snapshots: BpstatRow[][] = [];
  const skipped: BlackPlayerImport<Id>["skipped"][number][] = [];
  for (const file of files) {
    const rows = file.text === null ? [] : parseBpstat(file.text);
    if (rows.length > 0) snapshots.push(rows);
    else skipped.push({ file: file.name, reason: file.text === null ? "unreadable" : "notStats" });
  }
  // Several rows (a file BlackPlayer saw under two paths) may be one Library song.
  const datesByTrack = new Map<Id, number[]>();
  const unmatched: BlackPlayerUnmatched[] = [];
  for (const { latest, plays: count, dates } of timelines(snapshots)) {
    if (count === 0) continue;
    const trackId = byPath.find(latest.path) ?? byTags(latest)?.id;
    if (trackId === undefined) {
      unmatched.push({ title: latest.title, artist: latest.artist, plays: count });
      continue;
    }
    datesByTrack.set(trackId, [...(datesByTrack.get(trackId) ?? []), ...dates]);
  }
  const before = new Map(imported.map((track) => [track.trackId, track]));
  const plays: BlackPlayerPlay<Id>[] = [];
  for (const [trackId, dates] of datesByTrack) {
    const done = before.get(trackId);
    const fresh = notYetImported(
      dates.sort((a, b) => a - b),
      done ?? { plays: 0, latestAt: -Infinity },
    );
    for (const startedAt of fresh) plays.push({ trackId, startedAt });
  }
  return {
    plays: plays.sort((a, b) => a.startedAt - b.startedAt),
    unmatched: unmatched.sort(
      (a, b) =>
        compareFolded(a.artist, b.artist) || compareFolded(a.title, b.title) || b.plays - a.plays,
    ),
    snapshots: snapshots.length,
    skipped,
  };
};

/**
 * The Library song a row with no song at its path is: the only one with its
 * title and artist, or else the only one of those on its album. Null when none
 * is, or the row can't tell which.
 */
const tagMatcher = <Id>(
  library: readonly BlackPlayerTrack<Id>[],
): ((row: BpstatRow) => BlackPlayerTrack<Id> | null) => {
  const matches = libraryMatches(library);
  return (row) => {
    const found = matches({ title: row.title, artists: [row.artist], durationMs: null });
    if (found.length === 1) return found[0] ?? null;
    const album = normalizeSearchText(row.album);
    if (album === "") return null;
    const onAlbum = found.filter((track) => normalizeSearchText(track.album) === album);
    return onAlbum.length === 1 ? (onAlbum[0] ?? null) : null;
  };
};

/** The summary shown once an import is done, in the shape of the M3U import's. */
export const summarizeBlackPlayerImport = <Id>(
  plan: BlackPlayerImport<Id>,
  language: AppLanguage = "en",
): M3uImportSummary => {
  const text = catalogueOf(language).imports;
  const plays = plan.plays.length;
  const songs = new Set(plan.plays.map((play) => play.trackId)).size;
  const unmatchedPlays = plan.unmatched.reduce((sum, song) => sum + song.plays, 0);
  return {
    title: plays === 0 ? text.nothingNewImported : text.importedBlackPlayer,
    sections: [
      ...(plan.snapshots === 0
        ? []
        : [
            {
              heading: text.newPlays(plays),
              detail: plays === 0 ? text.allPlaysKnown : text.playsFrom(songs, plan.snapshots),
              missing: [],
            },
          ]),
      ...(plan.unmatched.length === 0
        ? []
        : [
            {
              heading: text.songsNotInLibrary(plan.unmatched.length),
              detail: text.playsNotImported(plan.unmatched.length, unmatchedPlays),
              missing: plan.unmatched.map(({ title, artist }) =>
                artist === "" ? title : `${artist} – ${title}`,
              ),
            },
          ]),
      ...plan.skipped.map(({ file, reason }) => ({
        heading: file,
        detail: reason === "unreadable" ? text.couldntBeRead : text.notBlackPlayer,
        missing: [],
      })),
    ],
  };
};

/**
 * A song's plays (oldest first) beyond those imported already. They follow
 * the latest imported one: when the snapshots date some at or before it (the
 * earlier snapshots weren't picked this time), they're spread evenly from it.
 */
const notYetImported = (
  dates: readonly number[],
  done: { readonly plays: number; readonly latestAt: number },
): number[] => {
  const fresh = dates.slice(done.plays);
  const first = fresh[0];
  const last = fresh[fresh.length - 1];
  if (first === undefined || last === undefined || first > done.latestAt) return fresh;
  return spread(done.latestAt, Math.max(last, done.latestAt), fresh.length);
};

/** [count] times spread evenly after [start], the last at [end]. */
const spread = (start: number, end: number, count: number): number[] =>
  Array.from({ length: count }, (_, i) => Math.round(start + ((end - start) * (i + 1)) / count));

/** Each song of the snapshots (by path, in any case), with its plays dated. */
const timelines = (snapshots: readonly (readonly BpstatRow[])[]): Timeline[] => {
  const ordered = snapshots
    .map((rows) => ({ time: Math.max(...rows.map((row) => row.lastPlayedAt)), rows }))
    .sort((a, b) => a.time - b.time);
  const songs = new Map<string, Timeline>();
  let previous: number | null = null;
  for (const { time, rows } of ordered) {
    for (const row of rows) {
      const key = pathKey(row.path);
      const song = songs.get(key) ?? { latest: row, plays: 0, dates: [] };
      songs.set(key, song);
      song.latest = row;
      const added = row.plays - song.plays;
      if (added <= 0) continue;
      song.plays = row.plays;
      const end = Math.min(time, row.lastPlayedAt);
      const start = Math.min(end, Math.max(previous ?? row.addedAt, row.addedAt));
      song.dates.push(...spread(start, end, added));
    }
    previous = time;
  }
  return [...songs.values()];
};

const compareFolded = (a: string, b: string): number => {
  const [x, y] = [foldAccentsAndCase(a), foldAccentsAndCase(b)];
  return x < y ? -1 : x > y ? 1 : 0;
};

const COUNT = /^\d+$/;

/**
 * The rows of a `.bpstat` file's text. A line is
 * `plays;unknown;title;artist;album;path;addedAt;lastPlayedAt` (the second
 * field isn't understood and is ignored). Titles, albums and paths may hold a
 * `;` of their own; lines that aren't track stats are skipped.
 */
export const parseBpstat = (text: string): BpstatRow[] => {
  const rows: BpstatRow[] = [];
  for (const line of text.split(/\r\n|\n|\r/)) {
    const row = parseLine(line.replace(/^﻿/, ""));
    if (row !== null) rows.push(row);
  }
  return rows;
};

const parseLine = (line: string): BpstatRow | null => {
  const fields = line.split(";");
  if (fields.length < 8) return null;
  const [plays, unknown] = fields;
  const addedAt = fields[fields.length - 2];
  const lastPlayedAt = fields[fields.length - 1];
  if (![plays, unknown, addedAt, lastPlayedAt].every((field) => COUNT.test(field ?? ""))) {
    return null;
  }
  const middle = fields.slice(2, -2);
  // The path is the first field after the title and artist that's absolute.
  const pathAt = middle.findIndex((field, i) => i >= 2 && field.startsWith("/"));
  if (pathAt < 0) return null;
  const path = middle.slice(pathAt).join(";");
  const tags = splitTags(middle.slice(0, pathAt), path);
  if (tags === null) return null;
  return {
    plays: Number(plays),
    ...tags,
    path,
    addedAt: Number(addedAt),
    lastPlayedAt: Number(lastPlayedAt),
  };
};

/**
 * Title, artist and album from the fields before the path. With more than
 * three, some `;` belong to a title or album: those are written "; " (the
 * separators aren't followed by a space), and the artist is the one the file
 * is named after.
 */
const splitTags = (
  fields: readonly string[],
  path: string,
): { title: string; artist: string; album: string } | null => {
  if (fields.length < 3) return null;
  const fileName = path.slice(path.lastIndexOf("/") + 1).toLowerCase();
  let best: { title: string; artist: string; album: string } | null = null;
  let bestScore = -1;
  for (let a = 1; a < fields.length - 1; a++) {
    for (let b = a + 1; b < fields.length; b++) {
      const artist = fields.slice(a, b).join(";");
      const score =
        (fields[a]?.startsWith(" ") ? 0 : 1) +
        (fields[b]?.startsWith(" ") ? 0 : 1) +
        (artist !== "" && fileName.includes(artist.toLowerCase()) ? 2 : 0);
      if (score > bestScore) {
        bestScore = score;
        best = {
          title: fields.slice(0, a).join(";"),
          artist,
          album: fields.slice(b).join(";"),
        };
      }
    }
  }
  return best;
};
