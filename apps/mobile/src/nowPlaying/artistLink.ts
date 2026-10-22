import { artistLink, type ArtistLink } from "@wave/core";

/** Local metadata can arrive after the sheet; the track id already makes its line live. */
export const nowPlayingLibraryArtistLink = (options: {
  readonly trackId: number;
  readonly details: { readonly artistIds: readonly number[] } | null;
  readonly here: string;
  readonly read: (id: number) => Promise<{ readonly artistIds: readonly number[] } | null>;
  readonly follow: (link: ArtistLink) => void;
  readonly reveal: () => void;
  readonly unavailable: (error?: unknown) => void;
}): { readonly revealsCurrentScreen: boolean; readonly open: () => Promise<void> } => ({
  revealsCurrentScreen:
    options.details !== null &&
    options.details.artistIds.length > 0 &&
    artistLink(options.details.artistIds, options.here) === undefined,
  open: async () => {
    try {
      const details = options.details ?? (await options.read(options.trackId));
      if (details === null || details.artistIds.length === 0) {
        options.unavailable();
        return;
      }
      const link = artistLink(details.artistIds, options.here);
      if (link === undefined) options.reveal();
      else options.follow(link);
    } catch (error) {
      options.unavailable(error);
    }
  },
});
