/**
 * What a playlist holds (docs/spec.md, "Playlists"): Library songs and YT
 * Music songs the Library doesn't have, side by side in the order they were
 * added. A YT Music entry keeps enough of its song to show it without asking
 * YouTube, and becomes the Library's song in its place once the Library has
 * the same recording.
 */

import { splitCredit } from "./credits.ts";
import { counted } from "./listening.ts";
import { pagePlayback, skipMissingSongs, type PagePlayback } from "./pagePlayback.ts";
import { planPlaylistAdd, type PlaylistAdd } from "./playlists.ts";
import type { MixedSong, YtAlbumSong } from "./ytDiscover.ts";
import { libraryFinder, ytTrackId, type LibrarySongKey, type YtSong } from "./ytMusic.ts";

/**
 * Why an imported song is unavailable: no match on YouTube Music or in the
 * Library, or a Spotify local file without an artist, never searched.
 */
export type UnavailableReason = "notFound" | "localFile";

/**
 * A song an import couldn't find, as its source listed it: it keeps its place
 * in the playlist, but doesn't play.
 */
export interface UnavailableSong {
  readonly title: string;
  readonly artists: readonly string[];
  readonly album: string | null;
  readonly durationMs: number | null;
  /** The source's cover (Spotify's album cover), when it gave one. */
  readonly artworkUrl: string | null;
  readonly reason: UnavailableReason;
}

/** A playlist's unavailable entry: a song an import couldn't find, kept in its place. */
export interface UnavailableEntry {
  readonly source: "unavailable";
  readonly song: UnavailableSong;
}

/**
 * A song a playlist holds, or is given: a Library track, a YT Music song
 * streamed, or a song an import couldn't find (unavailable).
 */
export type PlaylistSong<S extends YtSong = YtSong> =
  | { readonly source: "library"; readonly trackId: number }
  | { readonly source: "stream"; readonly song: S }
  | UnavailableEntry;

/** A playlist's entry as its page lists it: a Library track, a YT Music song, or an unavailable song. */
export type PlaylistItem<S extends YtSong = YtSong, L = unknown> =
  MixedSong<S, L> | UnavailableEntry;

/**
 * What tells a playlist's songs apart: the id the song goes by in the queue
 * (a Library id, or `yt:` and its video id), so the two kinds never meet. An
 * unavailable song, which has no id, goes by what its source listed.
 */
export const playlistSongKey = (song: PlaylistSong): string => {
  switch (song.source) {
    case "library":
      return String(song.trackId);
    case "stream":
      return ytTrackId(song.song.videoId);
    case "unavailable": {
      const { title, artists, album, durationMs } = song.song;
      return `unavailable:${JSON.stringify([title, artists, album, durationMs])}`;
    }
  }
};

/**
 * What adding [incoming] to a playlist holding [existing] does: they go at the
 * end, in the order given, except those already in it (a YT Music song by its
 * video id) or given twice, which are skipped rather than doubled.
 */
export const planPlaylistSongs = <S extends YtSong>(
  existing: readonly PlaylistSong[],
  incoming: readonly PlaylistSong<S>[],
): PlaylistAdd<PlaylistSong<S>> => {
  const byKey = new Map<string, PlaylistSong<S>>();
  for (const song of incoming) {
    const key = playlistSongKey(song);
    if (!byKey.has(key)) byKey.set(key, song);
  }
  const plan = planPlaylistAdd(existing.map(playlistSongKey), incoming.map(playlistSongKey));
  return {
    add: plan.add.flatMap((key) => {
      const song = byKey.get(key);
      return song === undefined ? [] : [song];
    }),
    alreadyIn: plan.alreadyIn,
  };
};

/** What a playlist's Play, Shuffle or a tap plays, and where it starts (undefined: the top, or shuffled). */
export interface PlaylistPlay<S extends YtSong, L> {
  readonly playback: PagePlayback<S, L>;
  readonly startIndex: number | undefined;
}

/** Whether [entry] can play: anything but an unavailable song. */
const playable = <S extends YtSong, L>(entry: PlaylistItem<S, L>): entry is MixedSong<S, L> =>
  entry.source !== "unavailable";

/**
 * What a playlist holding [entries] plays, from the entry at [startIndex] when
 * one was tapped. Unavailable entries never play: Play, Shuffle and a tap
 * skip them, and a tapped one plays nothing (null). With YT Music on, a
 * playlist with YT Music entries is an integrated view: the whole list, the
 * Library's files and the rest streamed (Core's `pagePlayback`). With it off,
 * the YT Music entries show but don't play: Play plays the Library's songs, a
 * tapped Library song plays them from itself, and a tapped YT Music entry
 * plays nothing (null), as does a playlist with no Library songs.
 */
export const playlistPlayback = <S extends YtSong, L>(
  listed: readonly PlaylistItem<S, L>[],
  {
    ytMusic,
    startIndex: listedStart,
  }: { readonly ytMusic: boolean; readonly startIndex?: number | undefined },
): PlaylistPlay<S, L> | null => {
  const available = skipMissingSongs(listed, listedStart, playable);
  if (available === null) return null;
  const { songs: entries, startIndex } = available;
  if (ytMusic) return { playback: pagePlayback(entries), startIndex };
  const tapped = startIndex === undefined ? undefined : entries[startIndex];
  if (tapped !== undefined && tapped.source !== "library") return null;
  const tracks = entries.flatMap((entry) => (entry.source === "library" ? [entry.track] : []));
  if (tracks.length === 0) return null;
  return {
    playback: { kind: "library", tracks },
    startIndex:
      startIndex === undefined
        ? undefined
        : entries.slice(0, startIndex).filter((entry) => entry.source === "library").length,
  };
};

/**
 * A playlist's entry that isn't a Library track yet: its place, its
 * playlist, and its song (a YT Music song it streams, or an unavailable one).
 */
export interface StreamedPlaylistEntry {
  readonly itemId: number;
  readonly playlistId: number;
  readonly song: Pick<YtSong, "title" | "artists" | "durationMs">;
}

/** A Library track a playlist holds. */
export interface HeldPlaylistTrack {
  readonly playlistId: number;
  readonly trackId: number;
}

/** A YT Music entry that becomes Library track [trackId] in its place. */
export interface PlaylistEntryLink {
  readonly itemId: number;
  readonly trackId: number;
}

/** What linking a playlist's YT Music entries does: entries that become Library songs, and entries removed. */
export interface PlaylistEntryLinks {
  readonly links: readonly PlaylistEntryLink[];
  /** Entries whose Library song their playlist holds already: removed rather than doubled. */
  readonly drops: readonly number[];
}

/**
 * The YT Music and unavailable [entries] (of any playlists, each in playlist order) that the
 * Library songs in [library] (just downloaded or scanned) positively are, as
 * Search and Discover decide (Core's `libraryFinder`): each becomes that
 * Library song in its place. A playlist never holds a song twice
 * (`planPlaylistSongs`), so an entry whose song its playlist already holds
 * ([held], or an earlier entry just linked) is dropped instead. Entries
 * without a match stay as they are.
 */
export const playlistEntryLinks = (
  entries: readonly StreamedPlaylistEntry[],
  library: readonly (LibrarySongKey & { readonly id: number })[],
  held: readonly HeldPlaylistTrack[],
): PlaylistEntryLinks => {
  if (entries.length === 0 || library.length === 0) return { links: [], drops: [] };
  const find = libraryFinder(library);
  const key = (playlistId: number, trackId: number) => `${playlistId}:${trackId}`;
  const holds = new Set(held.map(({ playlistId, trackId }) => key(playlistId, trackId)));
  const links: PlaylistEntryLink[] = [];
  const drops: number[] = [];
  for (const { itemId, playlistId, song } of entries) {
    const track = find(song);
    if (track === null) continue;
    const holding = key(playlistId, track.id);
    if (holds.has(holding)) {
      drops.push(itemId);
      continue;
    }
    holds.add(holding);
    links.push({ itemId, trackId: track.id });
  }
  return { links, drops };
};

/**
 * A YT Music entry's song as the playlist stores it: its id, title, artists,
 * album (and the album's page, for a download's tags), length, cover and
 * explicit mark, nothing else.
 */
export const writePlaylistYtSong = (song: YtSong & { readonly albumId?: string | null }): string =>
  JSON.stringify({
    videoId: song.videoId,
    title: song.title,
    artists: song.artists,
    album: song.album,
    albumId: song.albumId ?? null,
    durationMs: song.durationMs,
    artworkUrl: song.artworkUrl,
    explicit: song.explicit,
  } satisfies YtAlbumSong);

const stringOrNull = (value: unknown): value is string | null =>
  value === null || typeof value === "string";

/** The song stored as [stored] (`writePlaylistYtSong`), or null when nothing readable is. */
export const readPlaylistYtSong = (stored: string): YtAlbumSong | null => {
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { videoId, title, artists, album, albumId, durationMs, artworkUrl, explicit } =
    value as Record<string, unknown>;
  if (typeof videoId !== "string" || videoId === "" || typeof title !== "string") return null;
  if (!Array.isArray(artists) || !artists.every((artist) => typeof artist === "string"))
    return null;
  if (!stringOrNull(album) || !stringOrNull(artworkUrl)) return null;
  if (durationMs !== null && typeof durationMs !== "number") return null;
  return {
    videoId,
    title,
    artists: artists as string[],
    album,
    albumId: typeof albumId === "string" ? albumId : null,
    durationMs,
    artworkUrl,
    explicit: explicit === true,
  };
};

const UNAVAILABLE_REASONS: readonly string[] = [
  "notFound",
  "localFile",
] satisfies UnavailableReason[];

/**
 * What a playlist stores of a song that isn't a Library track (`yt_song`):
 * a YT Music song (`writePlaylistYtSong`), or an unavailable one, marked by
 * why, with what its source listed and no video id, so a version of Wave
 * that reads only YT Music entries reads it as nothing.
 */
export const writePlaylistEntrySong = (
  song: Exclude<PlaylistSong<YtSong & { readonly albumId?: string | null }>, { source: "library" }>,
): string => {
  if (song.source === "stream") return writePlaylistYtSong(song.song);
  const { title, artists, album, durationMs, artworkUrl, reason } = song.song;
  return JSON.stringify({ unavailable: reason, title, artists, album, durationMs, artworkUrl });
};

/** The song stored as [stored] (`writePlaylistEntrySong`), or null when nothing readable is. */
export const readPlaylistEntrySong = (
  stored: string,
): { readonly source: "stream"; readonly song: YtAlbumSong } | UnavailableEntry | null => {
  const song = readPlaylistYtSong(stored);
  if (song !== null) return { source: "stream", song };
  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const { unavailable, title, artists, album, durationMs, artworkUrl } = value as Record<
    string,
    unknown
  >;
  if (typeof unavailable !== "string" || !UNAVAILABLE_REASONS.includes(unavailable)) return null;
  if (typeof title !== "string") return null;
  if (!Array.isArray(artists) || !artists.every((artist) => typeof artist === "string"))
    return null;
  if (!stringOrNull(album) || !stringOrNull(artworkUrl)) return null;
  if (durationMs !== null && typeof durationMs !== "number") return null;
  return {
    source: "unavailable",
    song: {
      title,
      artists: artists as string[],
      album,
      durationMs,
      artworkUrl,
      reason: unavailable as UnavailableReason,
    },
  };
};

// ---------------------------------------------------------------------------
// How an unavailable entry shows

/** What an unavailable entry's row says under its title, and what a tap on it says. */
export interface UnavailableEntryView {
  readonly line: string;
  readonly notice: string;
}

const UNAVAILABLE_VIEWS: { readonly [R in UnavailableReason]: UnavailableEntryView } = {
  notFound: {
    line: "Not found on YouTube Music",
    notice: "Wave couldn't find this song on YouTube Music or in your Library.",
  },
  localFile: {
    line: "Local file on Spotify",
    notice: "This song is a local file on Spotify, so Wave couldn't look for it.",
  },
};

/** Why [song] is unavailable: its row's second line, and what tapping it says instead of playing. */
export const unavailableEntryView = (song: UnavailableSong): UnavailableEntryView =>
  UNAVAILABLE_VIEWS[song.reason];

/** What an unavailable entry's menu offers. */
export type UnavailableEntryAction = "removeFromPlaylist" | "search";

export const UNAVAILABLE_ENTRY_ACTION_LABELS: {
  readonly [A in UnavailableEntryAction]: string;
} = {
  removeFromPlaylist: "Remove from Playlist",
  search: "Search",
};

/**
 * An unavailable entry's menu: Remove from Playlist, and Search, which opens
 * Search with the song's title and main artist (`unavailableSearchQuery`),
 * while [search] (the Search tab is on the tab bar).
 */
export const unavailableEntryActions = ({
  search,
}: {
  readonly search: boolean;
}): UnavailableEntryAction[] => ["removeFromPlaylist", ...(search ? (["search"] as const) : [])];

/** What Search looks for from an unavailable entry: its title and main artist (the first its credits name). */
export const unavailableSearchQuery = (song: UnavailableSong): string => {
  const main = song.artists.flatMap((credit) => splitCredit(credit))[0];
  return main === undefined ? song.title : `${song.title} ${main}`;
};

/**
 * A playlist's count: every entry, and how many of them can't play
 * ("2,451 songs · 3 unavailable"); with none unavailable, the count alone.
 */
export const playlistSongsLine = (count: number, unavailable: number): string =>
  unavailable === 0
    ? counted(count, "song")
    : `${counted(count, "song")} · ${unavailable.toLocaleString("en")} unavailable`;
