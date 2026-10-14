/**
 * What Search has asked YouTube Music: songs it found for what's typed, which
 * join the Library's results (the integrated view). Typing alone asks only
 * when the Library has nothing for the query; otherwise Search offers Search
 * YouTube Music, and once the user taps it the view follows the query until
 * the field is cleared. It loads in the background, keeps the last results up
 * while the next query loads, drops answers to queries that are no longer
 * typed, and turns a failure into a quiet line. Off in Settings, it stays
 * hidden and nothing is requested.
 */

import type { YtSong } from "./ytMusic.ts";

/** Why the section shows a quiet line instead of songs. */
export type YtQuietReason = "offline" | "failed";

/**
 * Who asked YT Music: the user, with Search YouTube Music, or Search on its
 * own because the Library has nothing for the query.
 */
export type YtAskedBy = "user" | "auto";

/** The section's state; [S] is the song as the caller has it (the native result, say). */
export type YtSection<S extends YtSong = YtSong> =
  | { readonly status: "hidden" }
  /** The Library has results for [query]: nothing is asked, Search offers to ask. */
  | { readonly status: "offered"; readonly query: string }
  /**
   * [songs] are the last results, kept up until the new ones arrive. YT Music
   * is asked [delayMs] from now: at once when tapped, once typing pauses.
   */
  | {
      readonly status: "loading";
      readonly query: string;
      readonly songs: readonly S[];
      readonly by: YtAskedBy;
      readonly delayMs: number;
    }
  | {
      readonly status: "results";
      readonly query: string;
      readonly songs: readonly S[];
      readonly by: YtAskedBy;
    }
  | {
      readonly status: "quiet";
      readonly query: string;
      readonly reason: YtQuietReason;
      readonly by: YtAskedBy;
    };

export type YtSectionEvent<S extends YtSong = YtSong> =
  /**
   * What's in the search field now, whether YT Music is on in Settings and
   * whether the Library has results for it.
   */
  | {
      readonly type: "typed";
      readonly query: string;
      readonly enabled: boolean;
      readonly libraryHasResults: boolean;
    }
  /** Search YouTube Music was tapped. */
  | { readonly type: "asked" }
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
  /** Search YouTube Music is offered: nothing is asked yet for the query. */
  readonly offer: boolean;
}

/** What the section shows, or null when it's hidden. */
export const ytSectionView = <S extends YtSong>(
  section: YtSection<S>,
  inLibrary: (song: S) => boolean,
): YtSectionView<S> | null => {
  switch (section.status) {
    case "hidden":
      return null;
    case "offered":
      return { songs: [], note: null, offer: true };
    case "quiet":
      return { songs: [], note: section.reason, offer: false };
    case "loading":
    case "results": {
      const songs = section.songs.filter((song) => !inLibrary(song));
      if (songs.length > 0) return { songs, note: null, offer: false };
      if (section.status === "loading") return { songs, note: "searching", offer: false };
      const note = section.songs.length === 0 ? "noMatches" : "allInLibrary";
      return { songs, note, offer: false };
    }
  }
};

const shownSongs = <S extends YtSong>(state: YtSection<S>): readonly S[] =>
  state.status === "loading" || state.status === "results" ? state.songs : [];

/** Who asked YT Music, or null when it isn't asked (hidden, or only offered). */
const askedBy = <S extends YtSong>(state: YtSection<S>): YtAskedBy | null =>
  state.status === "hidden" || state.status === "offered" ? null : state.by;

export const stepYtSection = <S extends YtSong>(
  state: YtSection<S>,
  event: YtSectionEvent<S>,
): YtSection<S> => {
  switch (event.type) {
    case "typed": {
      const query = event.enabled ? ytSearchQuery(event.query) : null;
      if (query === null) return YT_SECTION_HIDDEN;
      const was = askedBy(state);
      // Asked by the user, it follows the query; on its own, only while the Library has nothing.
      const by = was === "user" ? "user" : event.libraryHasResults ? null : "auto";
      if (by === null)
        return state.status === "offered" && state.query === query
          ? state
          : { status: "offered", query };
      if (was === by && state.status !== "hidden" && state.query === query) return state;
      return {
        status: "loading",
        query,
        songs: shownSongs(state),
        by,
        delayMs: YT_SEARCH_DEBOUNCE_MS,
      };
    }
    case "asked":
      if (state.status !== "offered") return state;
      return { status: "loading", query: state.query, songs: [], by: "user", delayMs: 0 };
    case "found":
      if (state.status !== "loading" || state.query !== event.query) return state;
      return { status: "results", query: event.query, songs: event.songs, by: state.by };
    case "failed":
      if (state.status !== "loading" || state.query !== event.query) return state;
      return { status: "quiet", query: event.query, reason: event.reason, by: state.by };
  }
};
