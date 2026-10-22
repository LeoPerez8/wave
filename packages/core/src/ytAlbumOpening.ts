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
  const view = ytLibraryAlbumView(state, context);
  const ready = context.contentReady && context.settled;
  return {
    view,
    askArtist: ready && context.online && (view?.askArtist === true ||
      (context.retryArtist === true && view?.toggle === "online" && state.status === "ready")),
    readRelease: ready && context.online ? (view?.release?.browseId ?? null) : null,
    finder: ready && context.online && view?.tracks != null,
  };
};
