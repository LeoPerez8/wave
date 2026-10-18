/**
 * The Library | Online toggle at the top of an album page, an artist page
 * (in the Play and Shuffle row) and Search (at the end of the search field's
 * row). Online merges in what YouTube Music has; Library goes back to the
 * Library's own content, hiding it with no new request. What each place does
 * with a pick is its own (`stepYtSection`, `ytArtistSectionView`,
 * `ytLibraryAlbumView`); this holds what they share.
 */

/** A segment of the toggle: the Library's own content, or YouTube Music's merged in. */
export type YtPick = "library" | "online";

/**
 * Search online, the one preference behind every Library | Online toggle,
 * chosen by a long press on any of them and listed in Settings: Always
 * opens album and artist pages with Online selected, asking YouTube Music as
 * they open, and has Search ask as you type; Only on demand (the default)
 * asks nothing until Online is tapped, except in integrated views.
 */
export type SearchOnline = "always" | "onDemand";

/** The saved preference (what `writeSearchOnline` keeps); Only on demand unless Always was chosen. */
export const readSearchOnline = (stored: string | null): SearchOnline =>
  stored === "always" ? "always" : "onDemand";

/** What keeps [value] on the phone; null for the default, which keeps nothing. */
export const writeSearchOnline = (value: SearchOnline): string | null =>
  value === "always" ? "always" : null;
