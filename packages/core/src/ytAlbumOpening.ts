import { ytArtistOpeningState } from "./ytArtistOpening.ts";
import {
  ytLibraryAlbumView,
  type LibraryAlbumTrack,
  type YtArtistSection,
  type YtLibraryAlbumContext,
} from "./ytArtist.ts";
import type { YtSong } from "./ytMusic.ts";

/** Optional album work belongs after its local query and transition, including retries. */
export const ytAlbumOpening = <S extends YtSong, L extends LibraryAlbumTrack>(
  state: YtArtistSection<S>,
  context: YtLibraryAlbumContext<S, L> & {
    readonly contentReady: boolean;
    readonly settled: boolean;
    readonly online: boolean;
    readonly retryArtist?: boolean;
  },
) => {
  const shownState: YtArtistSection<S> = ytArtistOpeningState(state, context.online);
  const view = ytLibraryAlbumView(shownState, context);
  const ready = context.contentReady && context.settled;
  const joined = view?.tracks;
  const own = new Set(context.tracks);
  const shown =
    view === null
      ? null
      : {
          ...view,
          tracks:
            !ready || joined == null
              ? null
              : [
                  ...context.tracks.map((track) => ({
                    source: "library" as const,
                    track,
                    number: track.trackNumber,
                  })),
                  ...joined.filter((entry) => entry.source !== "library" || !own.has(entry.track)),
                ],
        };
  return {
    view: shown,
    askArtist:
      ready &&
      context.online &&
      (view?.askArtist === true ||
        (context.retryArtist === true && view?.toggle === "online" && state.status === "ready")),
    readRelease: ready && context.online ? (view?.release?.browseId ?? null) : null,
    finder: ready && context.online && view?.songs != null,
  };
};
