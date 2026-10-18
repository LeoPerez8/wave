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
