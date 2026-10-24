import type { ArtistLink, ItemActionEntry, LibraryArtistRef, StreamedArtistLink } from "@wave/core";

/** What Go to Artist's entry runs with, as `itemActionPress` wires it. */
export interface GoToArtistWiring<A extends LibraryArtistRef> {
  /** Starts the tap's timing: `beginTiming("goToArtist", "Artist")`. */
  readonly begin: () => void;
  /** Wraps an action so the menu closes, or the selection ends, before it runs. */
  readonly run: (action: () => void) => () => void;
  readonly follow: (artists: ArtistLink) => void;
  /** Several credited artists: a card to pick one from (`ArtistChoice`). */
  readonly followStreamed: (artists: StreamedArtistLink<A>) => void;
}

/**
 * What pressing Go to Artist does. Its timing starts on the press, not when
 * the entry is built: menus and the selection bar build entries nobody may
 * press, and a timing nothing ends keeps the screen from settling, so pages
 * that wait for it (an integrated artist page's online songs) hide their
 * online part as if loading (#663).
 */
export const goToArtistPress = <A extends LibraryArtistRef>(
  entry: Extract<ItemActionEntry<A>, { readonly action: "goToArtist" }>,
  { begin, run, follow, followStreamed }: GoToArtistWiring<A>,
): (() => void) => {
  const go = run(
    "streamedArtists" in entry
      ? () => followStreamed(entry.streamedArtists)
      : () => follow(entry.artists),
  );
  return () => {
    begin();
    go();
  };
};
