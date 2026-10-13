/**
 * The YT Music section of Search: below the Library's results, songs found on
 * YouTube Music for what's typed. It loads in the background, keeps the last
 * results up while the next query loads, drops answers to queries that are no
 * longer typed, and turns a failure into a quiet line. Off in Settings, it
 * stays hidden and nothing is requested.
 */

import type { YtSong } from "./ytMusic.ts";

/** Why the section shows a quiet line instead of songs. */
export type YtQuietReason = "offline" | "failed";

/** The section's state; [S] is the song as the caller has it (the native result, say). */
export type YtSection<S extends YtSong = YtSong> =
  | { readonly status: "hidden" }
  /** [songs] are the last results, kept up until the new ones arrive. */
  | { readonly status: "loading"; readonly query: string; readonly songs: readonly S[] }
  | { readonly status: "results"; readonly query: string; readonly songs: readonly S[] }
  | { readonly status: "quiet"; readonly query: string; readonly reason: YtQuietReason };

export type YtSectionEvent<S extends YtSong = YtSong> =
  /** What's in the search field now, and whether YT Music is on in Settings. */
  | { readonly type: "typed"; readonly query: string; readonly enabled: boolean }
  | { readonly type: "found"; readonly query: string; readonly songs: readonly S[] }
  | { readonly type: "failed"; readonly query: string; readonly reason: YtQuietReason };

export const YT_SECTION_HIDDEN: { readonly status: "hidden" } = { status: "hidden" };

/** How long typing has to pause before YT Music is asked. */
export const YT_SEARCH_DEBOUNCE_MS = 300;

/** The fewest characters worth asking YT Music about. */
const MIN_QUERY_LENGTH = 2;

/** The query to send for what's typed, or null when there's too little to search for. */
export const ytSearchQuery = (text: string): string | null => {
  const query = text.replace(/\s+/g, " ").trim();
  return query.length < MIN_QUERY_LENGTH ? null : query;
};

/** A line the section shows instead of (or until) songs. */
export type YtSectionNote = "searching" | "noMatches" | "allInLibrary" | YtQuietReason;

export interface YtSectionView<S extends YtSong> {
  /** The songs to list: YT Music's, in its order, minus those already in the Library. */
  readonly songs: readonly S[];
  readonly note: YtSectionNote | null;
}

/** What the section shows, or null when it's hidden. */
export const ytSectionView = <S extends YtSong>(
  section: YtSection<S>,
  inLibrary: (song: S) => boolean,
): YtSectionView<S> | null => {
  switch (section.status) {
    case "hidden":
      return null;
    case "quiet":
      return { songs: [], note: section.reason };
    case "loading":
    case "results": {
      const songs = section.songs.filter((song) => !inLibrary(song));
      if (songs.length > 0) return { songs, note: null };
      if (section.status === "loading") return { songs, note: "searching" };
      return { songs, note: section.songs.length === 0 ? "noMatches" : "allInLibrary" };
    }
  }
};

const shownSongs = <S extends YtSong>(state: YtSection<S>): readonly S[] =>
  state.status === "loading" || state.status === "results" ? state.songs : [];

export const stepYtSection = <S extends YtSong>(
  state: YtSection<S>,
  event: YtSectionEvent<S>,
): YtSection<S> => {
  switch (event.type) {
    case "typed": {
      const query = event.enabled ? ytSearchQuery(event.query) : null;
      if (query === null) return YT_SECTION_HIDDEN;
      if (state.status !== "hidden" && state.query === query) return state;
      return { status: "loading", query, songs: shownSongs(state) };
    }
    case "found":
      if (state.status !== "loading" || state.query !== event.query) return state;
      return { status: "results", query: event.query, songs: event.songs };
    case "failed":
      if (state.status !== "loading" || state.query !== event.query) return state;
      return { status: "quiet", query: event.query, reason: event.reason };
  }
};
