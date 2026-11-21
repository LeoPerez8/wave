/**
 * The cover of the YouTube Music artist being opened, as the tapped tile or
 * row drew it, so the artist page's first frame shows it before their page
 * is read (docs/spec.md › Fluidity, online screens). Only the last opening
 * is kept.
 */
let opening: { readonly browseId: string; readonly cover: string | null } | undefined;

/** Remembers that [browseId]'s page is opening with [cover] drawn on the tap. */
export const openingArtist = (browseId: string, cover: string | null | undefined): void => {
  opening = { browseId, cover: cover ?? null };
};

/** The cover the opener drew for [browseId], or null when it drew none or opened another. */
export const openedArtistCover = (browseId: string): string | null =>
  opening?.browseId === browseId ? opening.cover : null;
