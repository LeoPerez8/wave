import {
  sectionSongs,
  sortSongs,
  type LibrarySectionSlug,
  type SectionCollection,
} from "@wave/core";
import * as Effect from "effect/Effect";

import { LibraryStore, type LibraryStoreError, type SongRow } from "./LibraryStore";
import { appRuntime } from "./runtime";
import { currentSongSort } from "./songSort";

type Store = LibraryStore["Service"];
type Query<A> = (store: Store) => Effect.Effect<A, LibraryStoreError>;

const run = <A>(query: Query<A>): Promise<A> => appRuntime.runPromise(LibraryStore.use(query));

/** A section's items in its order, each with its songs as its own screen lists them. */
const collection = <D>(
  list: Query<readonly { readonly id: number }[]>,
  detail: (store: Store, id: number) => Effect.Effect<D | null, LibraryStoreError>,
  songsOf: (detail: D) => readonly SongRow[],
): SectionCollection<SongRow> => ({
  ids: () => run(list).then((items) => items.map((item) => item.id)),
  songs: (id) =>
    run((store) =>
      detail(store, id).pipe(Effect.map((found) => (found === null ? [] : songsOf(found)))),
    ),
});

/**
 * Every song a Library entry holds, in the order its section lists them: what
 * its long-press menu queues or adds to a playlist.
 */
export const librarySectionSongs = (section: LibrarySectionSlug): Promise<readonly SongRow[]> =>
  sectionSongs(section, {
    // As Library › Songs shows them, in the sort chosen there.
    songs: () =>
      run((store) => store.listSongs).then((songs) => sortSongs(songs, currentSongSort("songs"))),
    favorites: () => run((store) => store.listFavorites),
    albums: collection(
      (store) => store.listAlbums,
      (store, id) => store.getAlbum(id),
      (album) => album.tracks,
    ),
    artists: collection(
      (store) => store.listArtists,
      (store, id) => store.getArtist(id),
      (artist) => artist.songs,
    ),
    genres: collection(
      (store) => store.listGenres,
      (store, id) => store.getGenre(id),
      (genre) => genre.songs,
    ),
    folders: collection(
      (store) => store.listFolders,
      (store, id) => store.getFolder(id),
      (folder) => folder.songs,
    ),
    playlists: collection(
      (store) => store.listPlaylists,
      (store, id) => store.getPlaylist(id),
      (playlist) => playlist.items,
    ),
  });
