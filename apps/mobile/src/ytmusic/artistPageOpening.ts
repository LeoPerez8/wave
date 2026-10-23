import type { YtArtistPageView } from "@wave/core";

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
