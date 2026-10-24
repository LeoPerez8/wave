import {
  ytArtistPageOpening,
  type YtArtistPageView,
  type YtArtistPageViewContext,
  type YtArtistSection,
  type YtSong,
} from "@wave/core";
import { useMemo } from "react";

/** Page data depends on the artist and its read state, never the rows' selection marks. */
export const useArtistPageOpening = <S extends YtSong, L, A>(
  state: YtArtistSection<S>,
  {
    enabled,
    now,
    settled,
    online,
    retry,
    librarySong,
    libraryAlbum,
  }: YtArtistPageViewContext<S, L, A> & {
    readonly settled: boolean;
    readonly online: boolean;
    readonly retry?: boolean;
  },
) =>
  useMemo(() => {
    const work = ytArtistPageOpening(state, {
      enabled,
      now,
      settled,
      online,
      retry,
      librarySong,
      libraryAlbum,
    });
    return { ...work, view: artistPageOpening({ online, enabled }).view ?? work.view };
  }, [state, enabled, now, settled, online, retry, librarySong, libraryAlbum]);

/** Offline is already drawable; neither saved data nor Library identity gates that message. */
export const artistPageOpening = (options: {
  readonly online: boolean;
  readonly enabled: boolean;
}): {
  readonly request: boolean;
  readonly view: YtArtistPageView<never, never, never> | null;
} => ({
  request: options.online && options.enabled,
  view:
    options.online && options.enabled
      ? null
      : {
          name: null,
          artworkUrl: null,
          songs: [],
          shelves: [],
          note: options.enabled ? "offline" : "off",
          retry: options.enabled,
        },
});
