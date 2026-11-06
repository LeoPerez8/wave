/**
 * Now Playing's Related view: what YouTube Music's watch-next Related tab
 * gives for the playing song, read once per song per session, and the
 * search that finds a Library song without a video id first.
 */
import {
  sameSongAnyVersion,
  songSearchMatch,
  songSearchQuery,
  type LibrarySongKey,
  type SongSearchKey,
  type YtSong,
} from "./ytMusic.ts";

/** What Related shows for a song: loading, its answer, or "Couldn't load the related songs". */
export type RelatedSongsShown<A> =
  | { readonly status: "loading" }
  | { readonly status: "loaded"; readonly answer: A }
  | { readonly status: "failed" };

/** The session's related songs, by the video id of the song they're related to. */
export interface RelatedSongsSession<A> {
  /**
   * What Related shows for the song [videoId]: a song with none (a Library
   * song never matched on YouTube Music, null) shows the error, and one
   * whose id isn't known yet (undefined: an unsearched entry being searched)
   * shows loading, as does a song not read yet. The same object until it
   * changes, so a store can hand it out as its snapshot.
   */
  readonly shown: (videoId: string | null | undefined) => RelatedSongsShown<A>;
  /**
   * Reads the related songs of [videoId], unless the session holds them or
   * a read is on its way: Related opening on a song, and Try Again after a
   * failure (a failure isn't kept, so it reads again).
   */
  readonly read: (videoId: string) => void;
  /** Calls [listener] whenever what a song shows changes; returns the unsubscribe. */
  readonly subscribe: (listener: () => void) => () => void;
}

const LOADING = { status: "loading" } as const;
const FAILED = { status: "failed" } as const;

/** A session's related songs, each read by [read] (which rejects offline or on a failure). */
export const createRelatedSongsSession = <A>(
  read: (videoId: string) => Promise<A>,
): RelatedSongsSession<A> => {
  const songs = new Map<string, RelatedSongsShown<A>>();
  const listeners = new Set<() => void>();
  const set = (videoId: string, shown: RelatedSongsShown<A>): void => {
    songs.set(videoId, shown);
    for (const listener of listeners) listener();
  };
  return {
    shown: (videoId) => {
      if (videoId === null) return FAILED;
      if (videoId === undefined) return LOADING;
      return songs.get(videoId) ?? LOADING;
    },
    read: (videoId) => {
      const held = songs.get(videoId);
      if (held !== undefined && held.status !== "failed") return;
      set(videoId, LOADING);
      read(videoId).then(
        (answer) => set(videoId, { status: "loaded", answer }),
        () => set(videoId, FAILED),
      );
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

/**
 * The related [songs] without the song [playing] (its title and artist
 * credit; null with nothing playing) in any version: another album's, a live
 * or remastered one (`sameSongAnyVersion`).
 */
export const relatedWithoutPlaying = <S extends Pick<YtSong, "title" | "artists">>(
  playing: Pick<LibrarySongKey, "title" | "artist"> | null,
  songs: readonly S[],
): readonly S[] =>
  playing === null ? songs : songs.filter((song) => !sameSongAnyVersion(playing, song));

/** A Library song Related looks for on YouTube Music: it has no video id of its own. */
export interface RelatedSearchSong extends SongSearchKey {
  /** Its Library id. */
  readonly id: number;
}

/** The session's searches for Library songs without a video id, by Library id. */
export interface RelatedSearches {
  /**
   * The video id the search found for the Library song [id]: undefined
   * while it searches (or before it does), null when nothing matched or the
   * search failed. The same answer until it changes.
   */
  readonly videoId: (id: number) => string | null | undefined;
  /**
   * Searches for [song] unless the session holds what an earlier search
   * found (a match, or no match), or a search is on its way. A failure
   * isn't kept, so coming back to the song searches again.
   */
  readonly find: (song: RelatedSearchSong) => void;
  /** Try Again: searches for [song] again after no match or a failure. */
  readonly findAgain: (song: RelatedSearchSong) => void;
  /** Calls [listener] whenever a song's answer changes; returns the unsubscribe. */
  readonly subscribe: (listener: () => void) => () => void;
}

type Found =
  | { readonly status: "searching" }
  | { readonly status: "found"; readonly videoId: string | null }
  | { readonly status: "failed" };

/**
 * A session's searches for Library songs without a video id, as Magic Queue
 * searches a seed: one YouTube Music Songs search of the title and artists
 * ([search], which rejects offline or on a failure), taking the first result
 * that is the same recording (`songSearchQuery`, `songSearchMatch`). What it
 * finds is kept for the session, so the song isn't searched again.
 */
export const createRelatedSearches = (
  search: (
    query: string,
  ) => Promise<readonly Pick<YtSong, "videoId" | "title" | "artists" | "durationMs">[]>,
): RelatedSearches => {
  const songs = new Map<number, Found>();
  const listeners = new Set<() => void>();
  const set = (id: number, found: Found): void => {
    songs.set(id, found);
    for (const listener of listeners) listener();
  };
  const start = (song: RelatedSearchSong): void => {
    set(song.id, { status: "searching" });
    search(songSearchQuery(song)).then(
      (results) => set(song.id, { status: "found", videoId: songSearchMatch(song, results) }),
      () => set(song.id, { status: "failed" }),
    );
  };
  return {
    videoId: (id) => {
      const found = songs.get(id);
      if (found === undefined || found.status === "searching") return undefined;
      return found.status === "found" ? found.videoId : null;
    },
    find: (song) => {
      const held = songs.get(song.id);
      if (held === undefined || held.status === "failed") start(song);
    },
    findAgain: (song) => {
      const held = songs.get(song.id);
      if (held?.status !== "searching" && !(held?.status === "found" && held.videoId !== null))
        start(song);
    },
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
};

/**
 * What the Library gave Related for the playing Library song: the video id
 * it was downloaded from, the song to search for without one, or nothing
 * (the read failed, or the Library no longer has the song).
 */
export type RelatedLibraryRead =
  | { readonly status: "videoId"; readonly videoId: string }
  | { readonly status: "search"; readonly song: RelatedSearchSong }
  | { readonly status: "unread" };

/**
 * What Try Again does for a Library song with no video id to read: search
 * for it again, or read the Library again. Null when it has nothing to
 * find (a song with a video id reads its related songs again itself).
 */
export type RelatedTryAgain = "search" | "readLibrary" | null;

/**
 * The video id Related reads for a playing Library song, from what the
 * Library gave ([read]; undefined while it's read) and, for a song without
 * one, what the search found ([found], `RelatedSearches.videoId`): undefined
 * while either is on its way, null for the error. With it, what its Try
 * Again does: a song the Library couldn't give reads it again.
 */
export const relatedLibraryVideoId = (
  read: RelatedLibraryRead | undefined,
  found: string | null | undefined,
): { readonly videoId: string | null | undefined; readonly tryAgain: RelatedTryAgain } => {
  if (read === undefined) return { videoId: undefined, tryAgain: null };
  if (read.status === "videoId") return { videoId: read.videoId, tryAgain: null };
  if (read.status === "search") return { videoId: found, tryAgain: "search" };
  return { videoId: null, tryAgain: "readLibrary" };
};
