/**
 * The decisions of the music folder job (organize.ts): which files get their
 * genre folder's name as genre, where every MP3 goes, which copies are
 * duplicates, and what is cleaned up. Pure: paths are relative to the music
 * folder, "/"-separated, and nothing here touches the disk.
 */

import {
  VARIOUS_ARTISTS,
  creditSplitter,
  normalizeTrack,
  ytDownloadTarget,
  type LibraryTrack,
  type RawTrack,
} from "../../packages/core/src/index.ts";

/** An MP3 in the music folder, with its tags as Wave's scanner reads them. */
export interface FolderFile {
  /** Relative to the music folder, e.g. `Rock/Artist - Title.mp3`. */
  readonly path: string;
  readonly sizeBytes: number;
  readonly durationMs: number | null;
  readonly tags: Omit<RawTrack, "path">;
}

/** The music folder's genre folders: a song directly inside one gets its name as genre. */
export const GENRE_FOLDERS: readonly string[] = [
  "Alternative",
  "Brasileiras",
  "Eletrônica",
  "Funk",
  "Kpop",
  "Metal",
  "Nostalgic",
  "Pagode",
  "Pop",
  "Rap",
  "Reggae",
  "Rock",
  "Rock BR",
  "Rock Classic",
  "Trap",
];

/** The genre folder [path] sits directly in, if any. */
const genreFolderOf = (path: string): string | null => {
  const parts = path.split("/");
  if (parts.length !== 2) return null;
  const folder = parts[0] ?? "";
  return GENRE_FOLDERS.find((genre) => genre.normalize("NFC") === folder.normalize("NFC")) ?? null;
};

/** A genre to write into a file that has none. */
export interface GenreWrite {
  readonly path: string;
  readonly genre: string;
}

/** Phase (a): every file in a genre folder without a genre (as Wave reads it) gets the folder's name. */
export const genreTagPlan = (files: readonly FolderFile[]): GenreWrite[] =>
  files.flatMap((file) => {
    const genre = genreFolderOf(file.path);
    if (genre === null) return [];
    if (normalizeTrack({ ...file.tags, path: file.path }).genre !== null) return [];
    return [{ path: file.path, genre }];
  });

/** A file going from one place in the music folder to another, bytes untouched. */
export interface Move {
  readonly from: string;
  readonly to: string;
}

/** Copies of one song that land on the same name: one is kept, the rest deleted. */
export interface Duplicate {
  readonly kept: string;
  /** Where the kept copy ends up. */
  readonly keptAs: string;
  readonly deleted: readonly string[];
}

/** Different songs that would land on one name: the first keeps it, the others are numbered. */
export interface Collision {
  readonly name: string;
  readonly paths: readonly string[];
}

export interface MovePlan {
  readonly moves: readonly Move[];
  readonly duplicates: readonly Duplicate[];
  readonly collisions: readonly Collision[];
  /** Songs already where they belong. */
  readonly inPlace: readonly string[];
  /**
   * Copies of one song (artist, title and length) kept under different names,
   * by their new paths: their tags differ (another album, say), so they aren't
   * deleted; listed for the owner to look at.
   */
  readonly lookAlikes: readonly (readonly string[])[];
}

/** Windows and Android's shared storage see names that differ only in case as one. */
const pathKey = (path: string): string => path.normalize("NFC").toLowerCase();

const inThumbnails = (path: string): boolean => pathKey(path).startsWith(".thumbnails/");

/** The copy to keep comes first: outside .thumbnails, then the higher cutoff. */
const keepOrder =
  (cutoffs: ReadonlyMap<string, number>) =>
  (a: FolderFile, b: FolderFile): number =>
    Number(inThumbnails(a.path)) - Number(inThumbnails(b.path)) ||
    (cutoffs.get(b.path) ?? 0) - (cutoffs.get(a.path) ?? 0);

const hasValue = (value: string | null | undefined): boolean =>
  value != null && value.replaceAll("\u0000", "").trim() !== "";

/**
 * The first folder, as a download names it: the album artist credit, else
 * "Various Artists" for a compilation, else the primary artist of the track's
 * credit, split the way the Library splits it.
 */
const folderArtist = (
  file: FolderFile,
  track: LibraryTrack,
  split: (credit: readonly string[]) => string[],
): string => {
  const { albumArtist, albumArtists } = file.tags;
  if (hasValue(albumArtist) || (albumArtists ?? []).some(hasValue)) return track.albumArtist;
  if (track.compilation) return VARIOUS_ARTISTS;
  return split(track.artistCredits)[0] ?? track.artist;
};

/** Phase (b): where every MP3 goes. */
export const movePlan = (
  files: readonly FolderFile[],
  cutoffs: ReadonlyMap<string, number>,
): MovePlan => {
  const tracks = files.map((file) => normalizeTrack({ ...file.tags, path: file.path }));
  const known = new Set<string>();
  for (const track of tracks) {
    for (const credit of [track.artist, ...track.artistCredits]) known.add(credit);
    for (const credit of [track.albumArtist, ...track.albumArtistCredits]) known.add(credit);
  }
  const split = creditSplitter(known);
  const targets = files.map((file, i) => {
    const track = tracks[i] as LibraryTrack;
    const target = ytDownloadTarget("", {
      title: track.title,
      artist: track.artist,
      album: hasValue(file.tags.album) ? track.album : null,
      albumArtist: folderArtist(file, track, split),
      trackNumber: track.trackNumber,
    });
    return target.path.replace(/^\//, "");
  });
  const spelled = oneSpellingPerFolder(targets);

  const byName = new Map<string, { name: string; songs: Song[] }>();
  files.forEach((file, i) => {
    const name = spelled[i] as string;
    const song = { file, track: tracks[i] as LibraryTrack };
    const group = byName.get(pathKey(name));
    if (group === undefined) byName.set(pathKey(name), { name, songs: [song] });
    else group.songs.push(song);
  });

  const taken = new Set(byName.keys());
  const moves: Move[] = [];
  const duplicates: Duplicate[] = [];
  const collisions: Collision[] = [];
  const inPlace: string[] = [];
  const bySong = new Map<string, Song[]>();
  const newPath = new Map<Song, string>();
  for (const { name, songs } of byName.values()) {
    const kept: string[] = [];
    sameRecordings(songs).forEach((copies, n) => {
      const [keep] = copies.toSorted((a, b) => keepOrder(cutoffs)(a.file, b.file));
      if (keep === undefined) return;
      const to = n === 0 ? name : freeName(name, n + 1, taken);
      if (keep.file.path === to) inPlace.push(to);
      else moves.push({ from: keep.file.path, to });
      kept.push(keep.file.path);
      newPath.set(keep, to);
      const key = `${keep.track.artistKey}${pathKey(keep.track.title)}`;
      bySong.set(key, [...(bySong.get(key) ?? []), keep]);
      if (copies.length > 1) {
        const deleted = copies.filter((copy) => copy !== keep).map((copy) => copy.file.path);
        duplicates.push({ kept: keep.file.path, keptAs: to, deleted });
      }
    });
    if (kept.length > 1) collisions.push({ name, paths: kept });
  }
  const lookAlikes = [...bySong.values()]
    .flatMap(sameRecordings)
    .filter((copies) => copies.length > 1)
    .map((copies) => copies.map((copy) => newPath.get(copy) ?? copy.file.path));
  return { moves, duplicates, collisions, inPlace, lookAlikes };
};

interface Song {
  readonly file: FolderFile;
  readonly track: LibraryTrack;
}

/** How far apart two copies of one recording may run. */
const SAME_LENGTH_MS = 3000;

/**
 * Copies on one name that are the same recording: the same artist credit (as
 * Wave identifies it) and the same length. A file whose length is unknown
 * matches only a copy of the same size.
 */
const isSameRecording = (a: Song, b: Song): boolean =>
  a.track.artistKey === b.track.artistKey &&
  (a.file.durationMs !== null && b.file.durationMs !== null
    ? Math.abs(a.file.durationMs - b.file.durationMs) <= SAME_LENGTH_MS
    : a.file.sizeBytes === b.file.sizeBytes);

/** [songs] grouped into recordings, each compared with the recording's first copy. */
const sameRecordings = (songs: readonly Song[]): Song[][] => {
  const recordings: Song[][] = [];
  for (const song of songs) {
    const recording = recordings.find(
      ([first]) => first !== undefined && isSameRecording(first, song),
    );
    if (recording === undefined) recordings.push([song]);
    else recording.push(song);
  }
  return recordings;
};

/** [name] numbered the way the phone numbers a taken name ("Intro (2).mp3"), from [n] up until free. */
const freeName = (name: string, n: number, taken: Set<string>): string => {
  const dot = name.lastIndexOf(".");
  for (let i = n; ; i++) {
    const numbered = `${name.slice(0, dot)} (${i})${name.slice(dot)}`;
    if (!taken.has(pathKey(numbered))) {
      taken.add(pathKey(numbered));
      return numbered;
    }
  }
};

/**
 * [paths] with each folder spelled one way: folders that differ only in case
 * are one folder on Windows and on the phone, so all take the spelling most
 * files have (the first one seen on a tie).
 */
const oneSpellingPerFolder = (paths: readonly string[]): string[] => {
  const counts = new Map<string, Map<string, number>>();
  for (const path of paths) {
    const parts = path.split("/").slice(0, -1);
    parts.forEach((_, i) => {
      const folder = parts.slice(0, i + 1).join("/");
      const spellings = counts.get(pathKey(folder)) ?? new Map<string, number>();
      const last = parts[i] as string;
      spellings.set(last, (spellings.get(last) ?? 0) + 1);
      counts.set(pathKey(folder), spellings);
    });
  }
  const spellingOf = (folder: string): string => {
    let best = "";
    let most = 0;
    for (const [spelling, count] of counts.get(pathKey(folder)) ?? []) {
      if (count > most) [best, most] = [spelling, count];
    }
    return best;
  };
  return paths.map((path) => {
    const parts = path.split("/");
    return parts
      .map((part, i) =>
        i === parts.length - 1 ? part : spellingOf(parts.slice(0, i + 1).join("/")),
      )
      .join("/");
  });
};

/** What is deleted besides duplicates, once the songs have moved. */
export interface CleanupPlan {
  /** Files, and folders (ending in "/") deleted with everything in them or once empty. */
  readonly delete: readonly string[];
  /** The BlackPlayer folders: deleted only once the import is checked on the phone. */
  readonly blackPlayer: readonly string[];
  /** Other files that stay where they are, keeping their folder. */
  readonly left: readonly string[];
}

const isFolder = (entry: string): boolean => entry.endsWith("/");
const topName = (entry: string): string => entry.split("/")[0] ?? "";
const baseName = (entry: string): string => entry.replace(/\/$/, "").split("/").pop() ?? "";
const depth = (entry: string): number => entry.replace(/\/$/, "").split("/").length;

/** Folders deleted whole: Android's thumbnails and the leftovers of a removed Syncthing folder. */
const isJunkFolder = (name: string): boolean =>
  name === ".thumbnails" || name.startsWith(".stfolder.removed-");

const isBlackPlayer = (name: string): boolean => /^BlackPlayer( \(\d+\))?$/.test(name);

/** Stray files deleted wherever they are: phone screenshots. */
const isJunkFile = (name: string): boolean => name.startsWith("Screenshot_");

/** Top folders the cleanup handles whole (or keeps whole: `.stfolder`), never file by file. */
const isSpecial = (entry: string): boolean => {
  const top = topName(entry);
  return top === ".stfolder" || isBlackPlayer(top) || isJunkFolder(top);
};

/**
 * The cleanup after [plan]'s moves and deletions: the thumbnails, removed
 * Syncthing folders and screenshots go, and so does every folder left empty,
 * deepest first. `.stfolder`, Syncthing's marker, stays. [entries] lists the
 * music folder before the moves: files, and folders ending in "/".
 */
export const cleanupPlan = (entries: readonly string[], plan: MovePlan): CleanupPlan => {
  const moved = new Set([
    ...plan.moves.map((move) => move.from),
    ...plan.duplicates.flatMap((duplicate) => duplicate.deleted),
  ]);
  const whole: string[] = [];
  const blackPlayer: string[] = [];
  const files: string[] = [];
  const left: string[] = [];
  const staying = new Set<string>();
  const keep = (file: string): void => {
    const parts = file.split("/");
    for (let i = 1; i < parts.length; i++) staying.add(pathKey(`${parts.slice(0, i).join("/")}/`));
  };
  for (const move of plan.moves) keep(move.to);
  for (const entry of entries) {
    const top = topName(entry);
    if (isSpecial(entry)) {
      if (entry === `${top}/`) {
        if (isBlackPlayer(top)) blackPlayer.push(entry);
        if (isJunkFolder(top)) whole.push(entry);
      }
      continue;
    }
    if (isFolder(entry) || moved.has(entry)) continue;
    if (isJunkFile(baseName(entry))) {
      files.push(entry);
      continue;
    }
    if (!entry.toLowerCase().endsWith(".mp3")) left.push(entry);
    keep(entry);
  }
  const emptied = entries
    .filter((entry) => isFolder(entry) && !isSpecial(entry) && !staying.has(pathKey(entry)))
    .map((entry, order) => ({ entry, order }))
    .toSorted((a, b) => depth(b.entry) - depth(a.entry) || a.order - b.order)
    .map(({ entry }) => entry);
  return { delete: [...whole, ...files, ...emptied], blackPlayer, left };
};
