import {
  ytArtistQuery,
  ytArtistSavedStands,
  ytArtistSectionAsks,
  ytArtistToggle,
  type YtArtistSection,
  type YtArtistSectionAsksContext,
} from "./ytArtist.ts";

/** Optional artist work never delays the local rows, including integrated openings. */
export const ytArtistOpening = (
  state: YtArtistSection,
  context: YtArtistSectionAsksContext & {
    readonly settled: boolean;
    readonly contentReady: boolean;
    /** Another Online press after the section failed. */
    readonly retry?: boolean;
  },
): { readonly ask: boolean; readonly finder: boolean } => {
  if (!context.contentReady || !context.settled) return { ask: false, finder: false };
  return {
    ask:
      ytArtistSectionAsks(state, context) ||
      (context.retry === true &&
        context.enabled &&
        ytArtistQuery(context.name) !== null &&
        state.status === "ready" &&
        ytArtistToggle(state, context) === "online"),
    finder:
      context.enabled &&
      ytArtistQuery(context.name) !== null &&
      state.status === "ready" &&
      state.saved?.outcome === "found" &&
      ytArtistSavedStands(state.saved, context.now) &&
      ytArtistToggle(state, context) === "online",
  };
};

/** Connectivity is known independently of restoring the saved answer or building a finder. */
export const ytArtistOpeningState = <S extends import("./ytMusic.ts").YtSong>(
  state: YtArtistSection<S>,
  online: boolean,
): YtArtistSection<S> => (online ? state : { status: "ready", saved: null, failure: "offline" });
