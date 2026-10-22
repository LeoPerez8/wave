import { ytArtistOpeningState } from "./ytArtistOpening.ts";
import {
  ytArtistPageAsks,
  ytArtistPageView,
  ytArtistSavedStands,
  type YtArtistPageViewContext,
  type YtArtistSection,
} from "./ytArtist.ts";
import type { YtSong } from "./ytMusic.ts";

/** Remote-only pages can show an offline result without acquiring the Library finder. */
export const ytArtistPageOpening = <S extends YtSong, L, A>(
  state: YtArtistSection<S>,
  context: YtArtistPageViewContext<S, L, A> & {
    readonly online: boolean;
    readonly settled: boolean;
    readonly retry?: boolean;
  },
) => {
  const shown: YtArtistSection<S> = ytArtistOpeningState(state, context.online);
  const view = ytArtistPageView(shown, context);
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
        ? { ...view, songs: [], shelves: [], note: "loading" as const }
        : view,
    ask:
      context.online &&
      context.settled &&
      context.enabled &&
      (ytArtistPageAsks(state, context) || (context.retry === true && state.status === "ready")),
    finder,
  };
};
