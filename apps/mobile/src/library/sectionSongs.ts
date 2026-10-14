import { sectionSongs, type LibrarySectionSlug, type SectionCollection } from "@wave/core";
import * as Effect from "effect/Effect";

import {
  LibraryStore,
  type LibraryStoreError,
  type PlaylistEntryRow,
  type SongRow,
} from "./LibraryStore";
import { appRuntime } from "./runtime";
import { sortedForKind } from "./songSort";

type Store = LibraryStore["Service"];
type Query<A> = (store: Store) => Effect.Effect<A, LibraryStoreError>;

const run = <A>(query: Query<A>): Promise<A> => appRuntime.runPromise(LibraryStore.use(query));

/** The Library songs among a playlist's entries, in playlist order. */
const playlistLibrarySongs = (entries: readonly PlaylistEntryRow[]): SongRow[] =>
  entries.flatMap((entry) => (entry.source === "library" ? [entry.track] : []));

/**
 * A playlist's entries in playlist order: its Library songs and its YT Music
 * songs, streamed (none once it's gone).
 */
export const playlistEntries = (id: number): Promise<readonly PlaylistEntryRow[]> =>
  run((store) => store.getPlaylist(id)).then((detail) => detail?.items ?? []);

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
 * The sections made of items (albums, artists…), each item's songs as its screen
 * lists them: artists' and genres' in the sort chosen for their kind.
 */
const collections = {
  albums: collection(
    (store) => store.listAlbums,
    (store, id) => store.getAlbum(id),
    (album) => album.tracks,
  ),
  artists: collection(
    (store) => store.listArtists,
    (store, id) => store.getArtist(id),
    (artist) => sortedForKind("artist", artist.songs),
  ),
  genres: collection(
    (store) => store.listGenres,
    (store, id) => store.getGenre(id),
    (genre) => sortedForKind("genre", genre.songs),
  ),
  playlists: collection(
    (store) => store.listPlaylists,
    (store, id) => store.getPlaylist(id),
    // Its Library songs; a playlist's own menu also takes its YT Music entries (`playlistEntries`).
    (playlist) => playlistLibrarySongs(playlist.items),
  ),
};

/** One album's, artist's, genre's or playlist's songs, as its own screen lists them. */
export const itemSongs = (
  section: keyof typeof collections,
  id: number,
): Promise<readonly SongRow[]> => collections[section].songs(id);

/**
 * Every song a Library entry holds, in the order its section lists them: what
 * its long-press menu queues or adds to a playlist.
 */
export const librarySectionSongs = (section: LibrarySectionSlug): Promise<readonly SongRow[]> =>
  sectionSongs(section, {
    // As Library › Songs shows them, in the sort chosen there.
    songs: () => run((store) => store.listSongs).then((songs) => sortedForKind("songs", songs)),
    favorites: () =>
      run((store) => store.listFavorites).then((songs) => sortedForKind("favorites", songs)),
    ...collections,
  });
