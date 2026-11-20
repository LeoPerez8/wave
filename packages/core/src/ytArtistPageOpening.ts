import { ytArtistOpeningState } from "./ytArtistOpening.ts";
import {
  ytArtistPageAsks,
  ytArtistPageView,
  ytArtistSavedStands,
  type YtArtistPageViewContext,
  type YtArtistSection,
} from "./ytArtist.ts";
import type { YtSong } from "./ytMusic.ts";

/**
 * Remote-only pages can show an offline result without acquiring the Library
 * finder. Offline, a page seen before keeps its similar artists (Fans might
 * also like) under the offline line, however old it is.
 */
export const ytArtistPageOpening = <S extends YtSong, L, A>(
  state: YtArtistSection<S>,
  context: YtArtistPageViewContext<S, L, A> & {
    readonly online: boolean;
    readonly settled: boolean;
    readonly retry?: boolean;
  },
) => {
  const shown: YtArtistSection<S> = ytArtistOpeningState(state, context.online);
  const seen = state.status !== "reading" && state.saved?.outcome === "found" ? state.saved : null;
  const read = ytArtistPageView(shown, context);
  const view =
    !context.online && context.enabled && seen !== null
      ? { ...read, similar: seen.page.similar ?? [] }
      : read;
  const finder =
    context.online &&
    context.settled &&
    context.enabled &&
    state.status === "ready" &&
    state.saved?.outcome === "found" &&
    ytArtistSavedStands(state.saved, context.now);
  return {
    view:
      !finder && view.note === null
        ? { ...view, songs: [], shelves: [], similar: [], note: "loading" as const }
        : view,
    ask:
      context.online &&
      context.settled &&
      context.enabled &&
      (ytArtistPageAsks(state, context) || (context.retry === true && state.status === "ready")),
    finder,
  };
};
