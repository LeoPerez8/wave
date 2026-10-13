/**
 * Downloading a YT Music song into the Library (docs/spec.md, "YT Music"):
 * where the file goes, the tags it gets and the queue of downloads. The
 * native Soulseek client acquires verified MP3 320, and the existing writer
 * and scanner publish it. Optional catalog metadata never establishes quality.
 */

import { songLookup, type FoundTags, type SongLookup } from "./lyricsAndGenre.ts";
import { normalizeSearchText } from "./search.ts";
import { joinArtists, type YtSong } from "./ytMusic.ts";
import { isWithin } from "./scanRoots.ts";

/** A song on a YT Music album page. */
export interface YtAlbumTrack {
  readonly videoId: string;
  readonly title: string;
  /** Its number on the album, when the page says. */
  readonly trackNumber: number | null;
  readonly discNumber?: number | null;
}

/** A YT Music album page: what a download's tags need from it. */
export interface YtAlbum {
  readonly title: string;
  /** Who the album is credited to, in order; may be empty. */
  readonly artists: readonly string[];
  readonly year: number | null;
  readonly artworkUrl: string | null;
  readonly tracks: readonly YtAlbumTrack[];
}

/** The tags a downloaded song's file gets, and the cover to embed. */
export interface YtDownloadTags {
  readonly title: string;
  readonly artist: string;
  readonly album: string | null;
  readonly albumArtist: string;
  readonly year: number | null;
  readonly trackNumber: number | null;
  readonly discNumber: number | null;
  readonly genre: string | null;
  /** LRC for synced lyrics, plain text otherwise. */
  readonly lyrics: string | null;
  readonly artworkUrl: string | null;
}

/** The side of the cover a download embeds, in pixels. */
const COVER_SIZE = 1200;

/**
 * [url] asking YouTube Music's image server for a [COVER_SIZE] square: its
 * covers carry their size (`=w120-h120-l90-rj`). Other images stay as they are.
 */
const largeCover = (url: string): string =>
  url.replace(/=w\d+-h\d+(?=[-?]|$)/, `=w${COVER_SIZE}-h${COVER_SIZE}`);

/** [song] on its album page: the same video, else the same title (the page may list another video of it). */
const albumTrack = (song: YtSong, album: YtAlbum): YtAlbumTrack | undefined => {
  const byVideo = album.tracks.find((track) => track.videoId === song.videoId);
  if (byVideo !== undefined) return byVideo;
  const title = normalizeSearchText(song.title);
  return album.tracks.find((track) => normalizeSearchText(track.title) === title);
};

/** YouTube Music's lyrics as a file keeps them: Unix line ends, no blank edges; null when empty. */
const tidyLyrics = (text: string | null): string | null => {
  const tidy = text?.replace(/\r\n?/g, "\n").trim() ?? "";
  return tidy === "" ? null : tidy;
};

/**
 * The tags for a downloaded [song]: its title and artists, its [album]
 * page's title, artists, year and the song's number there (the song's own
 * album and artists without the page), and the genre and lyrics [found] the
 * way Find Lyrics and Genre finds them. YouTube Music's own lyrics
 * ([ytLyrics], plain text) are the fallback.
 */
export const ytDownloadTags = (
  song: YtSong,
  album: YtAlbum | null,
  found: FoundTags | null,
  ytLyrics: string | null,
): YtDownloadTags => {
  const artist = joinArtists(song.artists);
  const cover = album?.artworkUrl ?? song.artworkUrl;
  return {
    title: song.title,
    artist,
    album: album?.title ?? song.album,
    albumArtist: album !== null && album.artists.length > 0 ? joinArtists(album.artists) : artist,
    year: album?.year ?? null,
    trackNumber: (album === null ? undefined : albumTrack(song, album))?.trackNumber ?? null,
    discNumber: (album === null ? undefined : albumTrack(song, album))?.discNumber ?? null,
    genre: found?.genre ?? null,
    lyrics: found?.lyrics?.text ?? tidyLyrics(ytLyrics),
    artworkUrl: cover === null ? null : largeCover(cover),
  };
};

/**
 * What Find Lyrics and Genre's lookup sends for a download: its title, its
 * first artist (the services credit features in the title), its album and
 * length. Null for a song that is never looked up (see `songLookup`).
 */
export const ytDownloadLookup = (song: YtSong, album: YtAlbum | null): SongLookup | null =>
  songLookup({
    title: song.title,
    artist: song.artists[0] ?? "",
    album: album?.title ?? song.album ?? "",
    durationMs: song.durationMs ?? 0,
  });

/** The folder of the default scan root that downloads go into. */
export const YT_MUSIC_FOLDER = "YT Music";

/**
 * The music folder downloads go into: the default scan root (`Music`) while
 * it's there, else the first folder the owner picked; null without any.
 */
export const ytDownloadRoot = (
  roots: readonly { readonly path: string; readonly isDefault: boolean }[],
): string | null => (roots.find((root) => root.isDefault) ?? roots[0])?.path ?? null;

/** The native Soulseek route preserves verified original MP3 320. */
const EXTENSION = "mp3";

/** What the file's place depends on. */
export interface YtDownloadPlace {
  readonly title: string;
  readonly artist: string;
  readonly album: string | null;
  readonly albumArtist: string | null;
  readonly trackNumber: number | null;
  readonly discNumber?: number | null;
}

/** Where a download is saved: the folder, the file's name and both together. */
export interface YtDownloadTarget {
  readonly folder: string;
  readonly fileName: string;
  readonly path: string;
}

/**
 * The longest name a folder or file gets, in UTF-8 bytes: storage allows 255
 * (ext4, f2fs, exFAT), less the room the native side needs for a temp name
 * while downloading or a " (2)" when the name is taken.
 */
const MAX_NAME_BYTES = 240;

/** Characters FAT/exFAT cards (and some of Android's own checks) refuse in names, and controls. */
// oxlint-disable-next-line no-control-regex -- control characters are exactly what's matched
const UNSAFE = /[/\\:*?"<>|\u0000-\u001f\u007f]/g;

const utf8Length = (codePoint: number): number =>
  codePoint < 0x80 ? 1 : codePoint < 0x800 ? 2 : codePoint < 0x10000 ? 3 : 4;

/** [text] cut to at most [maxBytes] of UTF-8, never inside a character. */
const fitBytes = (text: string, maxBytes: number): string => {
  let bytes = 0;
  let end = 0;
  for (const char of text) {
    bytes += utf8Length(char.codePointAt(0) ?? 0);
    if (bytes > maxBytes) break;
    end += char.length;
  }
  return text.slice(0, end);
};

/** No leading dot (a hidden name, which scans skip) and no trailing dot or space (Windows-style storage drops them). */
const tidyEnds = (name: string): string =>
  name
    .trim()
    .replace(/^\.+/, "")
    .replace(/[. ]+$/, "");

/**
 * [text] as a folder or file name: unsafe characters become "_", it isn't
 * hidden and fits in [maxBytes]; "Unknown" when nothing is left.
 */
const safeName = (text: string, maxBytes = MAX_NAME_BYTES): string => {
  const name = tidyEnds(fitBytes(tidyEnds(text.replace(UNSAFE, "_")), maxBytes));
  return name === "" ? "Unknown" : name;
};

const byteLength = (text: string): number => {
  let bytes = 0;
  for (const char of text) bytes += utf8Length(char.codePointAt(0) ?? 0);
  return bytes;
};

/**
 * Where a downloaded song goes: `<root>/YT Music/<album artist>/<album>/`,
 * named after its title, after its track number when known ("08 Title.mp3").
 * Names are made safe for the storage: see `safeName`.
 */
export const ytDownloadTarget = (root: string, song: YtDownloadPlace): YtDownloadTarget => {
  const folders = [YT_MUSIC_FOLDER, safeName(song.albumArtist ?? song.artist)];
  if (song.album !== null) folders.push(safeName(song.album));
  const folder = [root.replace(/\/+$/, ""), ...folders].join("/");
  const number = song.trackNumber === null ? "" : `${String(song.trackNumber).padStart(2, "0")} `;
  const suffix = `.${EXTENSION}`;
  const title = safeName(song.title, MAX_NAME_BYTES - byteLength(number) - byteLength(suffix));
  const fileName = `${number}${title}${suffix}`;
  return { folder, fileName, path: `${folder}/${fileName}` };
};

/** Prefer the default root, then owner roots, checking the actual destination against exclusions. */
export const ytDownloadDestination = (
  roots: readonly { readonly path: string; readonly isDefault: boolean }[],
  excluded: readonly string[],
  song: YtDownloadPlace,
): YtDownloadTarget | null => {
  const ordered = [
    ...roots.filter((root) => root.isDefault),
    ...roots.filter((root) => !root.isDefault),
  ];
  for (const root of ordered) {
    const target = ytDownloadTarget(root.path, song);
    if (!excluded.some((folder) => isWithin(target.path, folder))) return target;
  }
  return null;
};
