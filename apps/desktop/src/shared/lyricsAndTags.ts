/** Settings › Lyrics and tags on the desktop (docs/spec.md, Settings): what the window shows. */

/** The page's two switches, both synced with the account. */
export interface LyricsAndTagsSettings {
  /** Fix songs online: Fix Song's lookups, lyrics online and missing songs' covers. */
  readonly fixSongsOnline: boolean;
  readonly downloadArtistPhotos: boolean;
}

/** How far Fix songs in the whole Library is; total is 0 until its songs are known. */
export interface LibraryFixProgress {
  readonly done: number;
  readonly total: number;
}

export interface LyricsAndTagsView extends LyricsAndTagsSettings {
  /** The whole-Library run, while one goes on. */
  readonly fixRun: LibraryFixProgress | null;
  /** How many artist photos Wave downloaded and keeps. */
  readonly artistPhotos: number;
}

/** Whether [value] is a change the window may ask for. */
export const validLyricsAndTagsChange = (value: unknown): value is Partial<LyricsAndTagsSettings> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const entries = Object.entries(value);
  return (
    entries.length > 0 &&
    entries.every(
      ([key, on]) =>
        (key === "fixSongsOnline" || key === "downloadArtistPhotos") && typeof on === "boolean",
    )
  );
};
