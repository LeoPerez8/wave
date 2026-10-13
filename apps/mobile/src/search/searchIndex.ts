import { createSearchIndex, type SearchIndex, type YtSong } from "@wave/core";
import * as Effect from "effect/Effect";
import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

import { libraryVersion } from "@/library/LibraryScan";
import {
  LibraryStore,
  type AlbumRow,
  type ArtistRow,
  type GenreRow,
  type PlaylistRow,
  type SongRow,
} from "@/library/LibraryStore";
import { usePlaylistsVersion } from "@/library/playlists";
import { appRuntime } from "@/library/runtime";
import { useLoadedLibraryFinder } from "@/ytmusic/libraryFinder";

/** Something search found, with the row the screens need to show and open it. */
export type SearchHit =
  | { readonly kind: "artist"; readonly name: string; readonly artist: ArtistRow }
  | {
      readonly kind: "album";
      readonly name: string;
      readonly also: readonly string[];
      readonly album: AlbumRow;
    }
  | {
      readonly kind: "song";
      readonly name: string;
      readonly also: readonly string[];
      readonly song: SongRow;
    }
  | { readonly kind: "playlist"; readonly name: string; readonly playlist: PlaylistRow }
  | { readonly kind: "genre"; readonly name: string; readonly genre: GenreRow };

interface Sources {
  readonly songs: readonly SongRow[];
  readonly albums: readonly AlbumRow[];
  readonly artists: readonly ArtistRow[];
  readonly genres: readonly GenreRow[];
  readonly playlists: readonly PlaylistRow[];
}

const loadSources: Effect.Effect<Sources, unknown, LibraryStore> = Effect.gen(function* () {
  const store = yield* LibraryStore;
  const [songs, albums, artists, genres, playlists] = yield* Effect.all([
    store.listSongs,
    store.listAlbums,
    store.listArtists,
    store.listGenres,
    store.listPlaylists,
  ]);
  return { songs, albums, artists, genres, playlists };
});

const toEntries = (sources: Sources): SearchHit[] => {
  const entries: SearchHit[] = [];
  for (const artist of sources.artists) entries.push({ kind: "artist", name: artist.name, artist });
  for (const album of sources.albums)
    entries.push({ kind: "album", name: album.title, also: [album.albumArtist], album });
  for (const song of sources.songs)
    entries.push({ kind: "song", name: song.title, also: [song.artist, song.album], song });
  for (const playlist of sources.playlists)
    entries.push({ kind: "playlist", name: playlist.name, playlist });
  for (const genre of sources.genres) entries.push({ kind: "genre", name: genre.name, genre });
  return entries;
};

/** During a scan the library changes every batch; the index catches up at most this often. */
const REFRESH_MS = 3000;

/** What Search looks things up in: the library's index, and whether a YT Music song is in the library. */
export interface LibrarySearch {
  readonly index: SearchIndex<SearchHit>;
  readonly inLibrary: (song: YtSong) => boolean;
}

/**
 * The search index over the whole library, or null until it's first built.
 * It loads and builds only while `active` (the Search screen is in focus),
 * and rebuilds after the library changes, so typing only ever runs the
 * (prepared, narrowing) search itself.
 */
export const useSearchIndex = (active: boolean): LibrarySearch | null => {
  // Both only ever go up, so their sum changes whenever either does.
  const version =
    useSyncExternalStore(libraryVersion.subscribe, libraryVersion.get) + usePlaylistsVersion();
  const [built, setBuilt] = useState<{
    readonly version: number;
    readonly index: SearchIndex<SearchHit>;
  } | null>(null);
  // Whether a YT Music song is in the Library: the finder Discover shares.
  const find = useLoadedLibraryFinder(active);
  const inLibrary = useMemo(
    () => (find === null ? null : (song: YtSong) => find(song) !== null),
    [find],
  );
  const loading = useRef(false);
  const lastBuild = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  useEffect(() => {
    if (!active || loading.current || built?.version === version) return undefined;
    const wait = built === null ? 0 : Math.max(0, lastBuild.current + REFRESH_MS - Date.now());
    const timer = setTimeout(() => {
      loading.current = true;
      appRuntime
        .runPromise(loadSources)
        .then((sources) => {
          lastBuild.current = Date.now();
          const index = createSearchIndex(toEntries(sources));
          if (mounted.current) setBuilt({ version, index });
        })
        .catch(() => {
          // Keep the last index; store errors surface elsewhere (scan banner).
        })
        .finally(() => {
          loading.current = false;
        });
    }, wait);
    return () => clearTimeout(timer);
  }, [active, built, version]);

  const index = built?.index ?? null;
  return useMemo(
    () => (index === null || inLibrary === null ? null : { index, inLibrary }),
    [index, inLibrary],
  );
};
