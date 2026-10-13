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

export type YtSection =
  | { readonly status: "hidden" }
  /** [songs] are the last results, kept up until the new ones arrive. */
  | { readonly status: "loading"; readonly query: string; readonly songs: readonly YtSong[] }
  | { readonly status: "results"; readonly query: string; readonly songs: readonly YtSong[] }
  | { readonly status: "quiet"; readonly query: string; readonly reason: YtQuietReason };

export type YtSectionEvent =
  /** What's in the search field now, and whether YT Music is on in Settings. */
  | { readonly type: "typed"; readonly query: string; readonly enabled: boolean }
  | { readonly type: "found"; readonly query: string; readonly songs: readonly YtSong[] }
  | { readonly type: "failed"; readonly query: string; readonly reason: YtQuietReason };

export const YT_SECTION_HIDDEN: YtSection = { status: "hidden" };

/** How long typing has to pause before YT Music is asked. */
export const YT_SEARCH_DEBOUNCE_MS = 300;

/** The fewest characters worth asking YT Music about. */
const MIN_QUERY_LENGTH = 2;

/** The query to send for what's typed, or null when there's too little to search for. */
export const ytSearchQuery = (text: string): string | null => {
  const query = text.replace(/\s+/g, " ").trim();
  return query.length < MIN_QUERY_LENGTH ? null : query;
};

const shownSongs = (state: YtSection): readonly YtSong[] =>
  state.status === "loading" || state.status === "results" ? state.songs : [];

export const stepYtSection = (state: YtSection, event: YtSectionEvent): YtSection => {
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
