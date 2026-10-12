/**
 * The songs a Library entry (Playlists, Artists, Albums…) holds, for its
 * long-press menu: Play Next, Add to Queue and Add to Playlist act on every
 * one of them, in the order the section lists its items.
 */

/** The Library tab's entries. */
export type LibrarySectionSlug =
  | "playlists"
  | "artists"
  | "albums"
  | "songs"
  | "genres"
  | "folders"
  | "favorites";

/** Items of a section (albums, artists…): their ids in the section's order, and each one's songs. */
export interface SectionCollection<Song> {
  readonly ids: () => Promise<readonly number[]>;
  /** An item's songs, in the order its own screen lists them. */
  readonly songs: (id: number) => Promise<readonly Song[]>;
}

/** Where the library's sections come from. */
export interface LibrarySectionSource<Song> {
  /** Every song, as Library › Songs lists them (in the sort chosen there). */
  readonly songs: () => Promise<readonly Song[]>;
  /** Favorites, most recently starred first. */
  readonly favorites: () => Promise<readonly Song[]>;
  readonly albums: SectionCollection<Song>;
  readonly artists: SectionCollection<Song>;
  readonly genres: SectionCollection<Song>;
  readonly folders: SectionCollection<Song>;
  readonly playlists: SectionCollection<Song>;
}

const itemByItem = async <Song>(collection: SectionCollection<Song>): Promise<Song[]> => {
  const songs: Song[] = [];
  for (const id of await collection.ids()) songs.push(...(await collection.songs(id)));
  return songs;
};

/** Every song `section` holds, in its order. */
export const sectionSongs = async <Song extends { readonly id: number }>(
  section: LibrarySectionSlug,
  source: LibrarySectionSource<Song>,
): Promise<readonly Song[]> => {
  switch (section) {
    case "songs":
      return source.songs();
    case "favorites":
      return source.favorites();
    case "artists": {
      // A song credited to its track artist and its album's artist plays once,
      // under the first. (A playlist holding a song twice keeps both.)
      const seen = new Set<number>();
      return (await itemByItem(source.artists)).filter(
        (song) => !seen.has(song.id) && Boolean(seen.add(song.id)),
      );
    }
    default:
      return itemByItem(source[section]);
  }
};
