/**
 * What a playlist holds (docs/spec.md, "Playlists"): Library songs and YT
 * Music songs the Library doesn't have, side by side in the order they were
 * added. A YT Music entry keeps enough of its song to show it without asking
 * YouTube, and becomes the Library's song in its place once the Library has
 * the same recording.
 */

import { pagePlayback, type PagePlayback } from "./pagePlayback.ts";
import { planPlaylistAdd, type PlaylistAdd } from "./playlists.ts";
import type { MixedSong, YtAlbumSong } from "./ytDiscover.ts";
import { libraryFinder, ytTrackId, type LibrarySongKey, type YtSong } from "./ytMusic.ts";

/** A song a playlist holds, or is given: a Library track, or a YT Music song streamed. */
export type PlaylistSong<S extends YtSong = YtSong> =
  | { readonly source: "library"; readonly trackId: number }
  | { readonly source: "stream"; readonly song: S };

/**
 * What tells a playlist's songs apart: the id the song goes by in the queue
 * (a Library id, or `yt:` and its video id), so the two kinds never meet.
 */
export const playlistSongKey = (song: PlaylistSong): string =>
  song.source === "library" ? String(song.trackId) : ytTrackId(song.song.videoId);

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

/**
 * What a playlist holding [entries] plays, from the entry at [startIndex] when
 * one was tapped. With YT Music on, a playlist with YT Music entries is an
 * integrated view: the whole list, the Library's files and the rest streamed
 * (Core's `pagePlayback`). With it off, the YT Music entries show but don't
 * play: Play plays the Library's songs, a tapped Library song plays them from
 * itself, and a tapped YT Music entry plays nothing (null), as does a
 * playlist with no Library songs.
 */
export const playlistPlayback = <S extends YtSong, L>(
  entries: readonly MixedSong<S, L>[],
  { ytMusic, startIndex }: { readonly ytMusic: boolean; readonly startIndex?: number | undefined },
): PlaylistPlay<S, L> | null => {
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

/** A playlist's YT Music entry: its place, and the song it streams. */
export interface StreamedPlaylistEntry {
  readonly itemId: number;
  readonly song: YtSong;
}

/** A YT Music entry that becomes Library track [trackId] in its place. */
export interface PlaylistEntryLink {
  readonly itemId: number;
  readonly trackId: number;
}

/**
 * The YT Music [entries] (of any playlists) that the Library songs in
 * [library] (just downloaded or scanned) positively are, as Search and
 * Discover decide (Core's `libraryFinder`): each becomes that Library song in
 * its place. Entries without a match stay streamed.
 */
export const playlistEntryLinks = (
  entries: readonly StreamedPlaylistEntry[],
  library: readonly (LibrarySongKey & { readonly id: number })[],
): PlaylistEntryLink[] => {
  if (entries.length === 0 || library.length === 0) return [];
  const find = libraryFinder(library);
  return entries.flatMap(({ itemId, song }) => {
    const track = find(song);
    return track === null ? [] : [{ itemId, trackId: track.id }];
  });
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
