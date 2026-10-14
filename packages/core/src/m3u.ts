/**
 * M3U import: reading a `.m3u` / `.m3u8` playlist file and matching its
 * entries to Library tracks by path.
 */

import type { AlertSpec } from "./alert.ts";
import { foldAccentsAndCase } from "./library.ts";
import { counted } from "./listening.ts";
import { PLAYLIST_NAME_MAX } from "./playlists.ts";

/** One entry of an M3U file. */
export interface M3uEntry {
  /** As written: a path (absolute, or relative to the playlist file) or a URL. */
  readonly location: string;
  /** The `#EXTINF` title before it ("Artist - Title"), when there is one. */
  readonly title: string | null;
}

/** The entries of an M3U (or M3U8) file's text, in file order. */
export const parseM3u = (text: string): M3uEntry[] => {
  const entries: M3uEntry[] = [];
  let title: string | null = null;
  for (const raw of text.split(/\r\n|\n|\r/)) {
    // Trimming also drops a byte-order mark (U+FEFF) before the first line.
    const line = raw.trim();
    if (line === "") continue;
    if (line.startsWith("#")) {
      // `#EXTM3U`, other directives and comments carry nothing Wave uses.
      if (line.toUpperCase().startsWith("#EXTINF:")) title = extinfTitle(line);
      continue;
    }
    entries.push({ location: line, title });
    title = null;
  }
  return entries;
};

const URL_SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const FILE_URL = /^file:(\/\/)?(?=\/)/i;
const WINDOWS_DRIVE = /^[a-z]:\//i;

/**
 * The absolute path an entry's location points to, or null when it isn't a
 * file on this phone (a web address, a Windows drive) or is relative to a
 * playlist file whose folder isn't known. [playlistPath] is the playlist
 * file's own absolute path, when known.
 */
export const resolveM3uPath = (location: string, playlistPath: string | null): string | null => {
  let path = location;
  if (FILE_URL.test(path)) {
    path = path.replace(FILE_URL, "");
    try {
      path = decodeURIComponent(path);
    } catch {
      // A stray "%" that isn't an escape: keep it as written.
    }
  } else if (URL_SCHEME.test(path)) {
    return null;
  }
  path = path.replaceAll("\\", "/");
  if (WINDOWS_DRIVE.test(path)) return null;
  if (!path.startsWith("/")) {
    if (playlistPath === null) return null;
    path = `${playlistPath.slice(0, playlistPath.lastIndexOf("/"))}/${path}`;
  }
  return normalizePath(path);
};

/** An absolute path with `.`, `..` and repeated slashes worked out. */
const normalizePath = (path: string): string => {
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return `/${parts.join("/")}`;
};

/** Finds Library tracks by their file's path. */
export interface LibraryPathIndex<Id> {
  readonly find: (path: string) => Id | undefined;
}

/** Android's shared storage ignores case, so a path may be written in any. */
export const pathKey = (path: string): string => path.normalize("NFC").toLowerCase();

/** An index of the Library's tracks by path, built once for any number of imports. */
export const libraryPathIndex = <Id>(
  tracks: readonly { readonly id: Id; readonly path: string }[],
): LibraryPathIndex<Id> => {
  const exact = new Map<string, Id>();
  const loose = new Map<string, Id>();
  for (const { id, path } of tracks) {
    exact.set(path, id);
    const key = pathKey(path);
    if (!loose.has(key)) loose.set(key, id);
  }
  return { find: (path) => exact.get(path) ?? loose.get(pathKey(path)) };
};

/** A playlist file as picked: its file name, its absolute path when known, and its text. */
export interface M3uFile {
  readonly name: string;
  readonly path: string | null;
  readonly text: string;
}

/** What importing one M3U file makes. */
export interface M3uImport<Id> {
  /** The playlist's name, from the file's. */
  readonly name: string;
  /** Its songs in file order, each once. */
  readonly trackIds: readonly Id[];
  /** The entries not in the Library, in file order: by `#EXTINF` title, else file name. */
  readonly missing: readonly string[];
}

/** Matches an M3U file's entries to Library tracks by path. */
export const planM3uImport = <Id>(file: M3uFile, library: LibraryPathIndex<Id>): M3uImport<Id> => {
  const trackIds: Id[] = [];
  const seen = new Set<Id>();
  const missing: string[] = [];
  for (const entry of parseM3u(file.text)) {
    const path = resolveM3uPath(entry.location, file.path);
    const id = path === null ? undefined : library.find(path);
    if (id === undefined) missing.push(entry.title ?? lastSegment(entry.location));
    else if (!seen.has(id)) {
      seen.add(id);
      trackIds.push(id);
    }
  }
  return { name: playlistNameOf(file.name), trackIds, missing };
};

const lastSegment = (location: string): string => {
  const trimmed = location.replace(/[\\/]+$/, "");
  return trimmed.slice(Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\")) + 1);
};

const PLAYLIST_EXTENSION = /\.m3u8?$/i;

/** Whether a file is an M3U playlist, by its name. */
export const isM3uFileName = (fileName: string): boolean => PLAYLIST_EXTENSION.test(fileName);

const UNNAMED = "Imported Playlist";

/** A name `checkPlaylistName` accepts (unless another playlist has it), from the file's. */
const playlistNameOf = (fileName: string): string => {
  const name = fileName.replace(PLAYLIST_EXTENSION, "").trim().replace(/\s+/g, " ");
  return [...name].slice(0, PLAYLIST_NAME_MAX).join("").trim() || UNNAMED;
};

/** The playlist that already has [name] (as `checkPlaylistName` compares names), if any. */
export const importNameClash = <P extends { readonly name: string }>(
  name: string,
  playlists: readonly P[],
): P | undefined => {
  const folded = foldAccentsAndCase(name);
  return playlists.find((playlist) => foldAccentsAndCase(playlist.name) === folded);
};

/** Keep Both's name for an imported playlist: [name] with the first number no playlist has. */
export const keepBothName = (name: string, names: readonly string[]): string => {
  const taken = new Set(names.map(foldAccentsAndCase));
  for (let n = 2; ; n++) {
    const suffix = ` ${n}`;
    const base = [...name]
      .slice(0, PLAYLIST_NAME_MAX - suffix.length)
      .join("")
      .trimEnd();
    const candidate = `${base}${suffix}`;
    if (!taken.has(foldAccentsAndCase(candidate))) return candidate;
  }
};

/** Asks what to do when an imported playlist's name is taken: Replace, or Keep Both (also Back). */
export const confirmImportReplace = (
  name: string,
): AlertSpec & { readonly action: NonNullable<AlertSpec["action"]> } => ({
  title: `Replace ${name}?`,
  message: `You already have a playlist called ${name}. Replace its songs with the imported ones, or keep both playlists.`,
  action: { label: "Replace", destructive: true },
  dismissLabel: "Keep Both",
});

/** What became of one picked file. */
export type M3uImportOutcome =
  | {
      readonly kind: "imported";
      readonly name: string;
      readonly songs: number;
      readonly missing: readonly string[];
      /** It replaced the songs of a playlist that had its name. */
      readonly replaced: boolean;
    }
  /** None of its entries are in the Library, so no playlist was made. */
  | { readonly kind: "nothingFound"; readonly file: string; readonly missing: readonly string[] }
  | { readonly kind: "notPlaylist"; readonly file: string }
  | { readonly kind: "unreadable"; readonly file: string };

/** The summary shown once an import is done: a title, then one section per file. */
export interface M3uImportSummary {
  readonly title: string;
  readonly sections: readonly {
    readonly heading: string;
    readonly detail: string;
    /** The entries left out, to list under it. */
    readonly missing: readonly string[];
  }[];
}

const notInLibrary = (missing: readonly string[]): string[] =>
  missing.length === 0 ? [] : [`${missing.length.toLocaleString("en")} not in your library`];

const sectionOf = (outcome: M3uImportOutcome): M3uImportSummary["sections"][number] => {
  switch (outcome.kind) {
    case "imported":
      return {
        heading: outcome.name,
        detail: [
          ...(outcome.replaced ? ["Replaced"] : []),
          counted(outcome.songs, "song"),
          ...notInLibrary(outcome.missing),
        ].join(" · "),
        missing: outcome.missing,
      };
    case "nothingFound":
      return {
        heading: outcome.file,
        detail:
          outcome.missing.length === 0
            ? "It lists no songs"
            : `None of its ${counted(outcome.missing.length, "song")} ${outcome.missing.length === 1 ? "is" : "are"} in your library`,
        missing: outcome.missing,
      };
    case "notPlaylist":
      return { heading: outcome.file, detail: "Not an M3U playlist", missing: [] };
    case "unreadable":
      return { heading: outcome.file, detail: "Couldn't be read", missing: [] };
  }
};

export const summarizeM3uImport = (outcomes: readonly M3uImportOutcome[]): M3uImportSummary => {
  const imported = outcomes.flatMap((outcome) => (outcome.kind === "imported" ? [outcome] : []));
  const only = imported.length === 1 ? imported[0] : undefined;
  return {
    title:
      only !== undefined
        ? `Imported ${only.name}`
        : imported.length === 0
          ? "Nothing imported"
          : `Imported ${counted(imported.length, "playlist")}`,
    sections: outcomes.map(sectionOf),
  };
};

/** The title of `#EXTINF:<seconds> <attributes>,<title>`: after the first comma outside quotes. */
const extinfTitle = (line: string): string | null => {
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') quoted = !quoted;
    else if (char === "," && !quoted) return line.slice(i + 1).trim() || null;
  }
  return null;
};
