import {
  autoAlbumItem,
  autoArtistItem,
  autoChildren,
  autoItem,
  autoPageItems,
  autoPlayList,
  autoPlaylistItem,
  autoQueueAdd,
  autoQueueStart,
  autoTrackItems,
  decodeAutoMediaId,
  nextRepeatMode,
  type AutoHomeList,
  type AutoItem,
  type AutoNode,
  type AutoSource,
  type AutoTrack,
  type AutoTrackList,
  type AutoTrackListKind,
} from "@wave/core";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { RowPage } from "@/library/db/database";
import type { HomeSections } from "@/library/db/playHistory";
import { LibraryStore, type LibraryStoreError, type SongRow } from "@/library/LibraryStore";
import type { AutoPlayback, AutoRequest } from "@/native/wavePlayer";
import type { PlayerError } from "@/playback/Player";
import { Queue, queueState, toQueueTrack, type QueueTrack } from "@/playback/Queue";

/** Why Wave can't answer an Auto request; `message` is what Auto shows. */
export class AutoError extends Data.TaggedError("AutoError")<{ readonly message: string }> {}

type Failure = AutoError | LibraryStoreError | PlayerError;

/**
 * Answers Android Auto: the browse tree's structure comes from Core's Auto
 * browse model, its rows from the library store, and playback goes through
 * the queue engine, so the phone shows the same queue.
 */
export class Auto extends Context.Service<
  Auto,
  {
    /** The answer to [request] (see `AutoRequest` for its shape per type). */
    readonly answer: (request: AutoRequest) => Effect.Effect<unknown, Failure>;
  }
>()("@wave/mobile/auto/Auto") {}

const NOT_FOUND = "This is no longer in your library.";

const notFound = Effect.fail(new AutoError({ message: NOT_FOUND }));

const decode = (mediaId: string): Effect.Effect<AutoNode, AutoError> => {
  const node = decodeAutoMediaId(mediaId);
  return node === null ? notFound : Effect.succeed(node);
};

/** A library song as Core's track lists need it. */
const toAutoTrack = (song: SongRow): AutoTrack => ({
  id: String(song.id),
  title: song.title,
  artist: song.artist,
  artworkPath: song.artworkPath,
});

const pageOf = <A>(rows: readonly A[], page: RowPage): readonly A[] =>
  rows.slice(page.offset, page.offset + page.limit);

/** The songs of each of Home's song sections, as the app's Home tab lists them. */
const HOME_SONGS: Record<AutoHomeList, (home: HomeSections) => readonly SongRow[]> = {
  "most-played": (home) => home.mostPlayed,
  favorites: (home) => home.favorites,
};

const isHomeList = (id: string): id is AutoHomeList => Object.hasOwn(HOME_SONGS, id);

export const layer = Layer.effect(
  Auto,
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const queue = yield* Queue;

    /** Every song of a track list, in the order the app lists them, or null once it's gone. */
    const listSongs: Record<
      AutoTrackListKind,
      (id: string) => Effect.Effect<readonly SongRow[] | null, LibraryStoreError>
    > = {
      album: (id) =>
        store.getAlbum(Number(id)).pipe(Effect.map((detail) => detail?.tracks ?? null)),
      playlist: (id) =>
        store.getPlaylist(Number(id)).pipe(Effect.map((detail) => detail?.items ?? null)),
      // The app's Home tab lists.
      home: (id) =>
        store.home.pipe(Effect.map((home) => (isHomeList(id) ? HOME_SONGS[id](home) : null))),
      artistSongs: (id) =>
        store.getArtist(Number(id)).pipe(Effect.map((detail) => detail?.songs ?? null)),
    };

    const songsOf = (list: AutoTrackList) =>
      listSongs[list.kind](list.id).pipe(
        Effect.flatMap((songs) => (songs === null ? notFound : Effect.succeed(songs))),
      );

    /**
     * [page] of a track list's songs, in the same order. Long lists page in
     * the store; an album or a Home section is a handful of songs.
     */
    const pageSongs: Record<
      AutoTrackListKind,
      (id: string, page: RowPage) => Effect.Effect<readonly SongRow[], Failure>
    > = {
      album: (id, page) =>
        songsOf({ kind: "album", id }).pipe(Effect.map((songs) => pageOf(songs, page))),
      playlist: (id, page) => store.listPlaylistSongsPage(Number(id), page),
      home: (id, page) =>
        songsOf({ kind: "home", id }).pipe(Effect.map((songs) => pageOf(songs, page))),
      artistSongs: (id, page) => store.listArtistSongsPage(Number(id), page),
    };

    /** [artists] with a cover of theirs, where they have one. */
    const withCovers = <A extends { readonly id: number }>(artists: readonly A[]) =>
      store
        .artistCovers(artists.map((artist) => artist.id))
        .pipe(
          Effect.map((covers) =>
            artists.map((artist) => ({ ...artist, artworkPath: covers.get(artist.id) ?? null })),
          ),
        );

    /** The rows of [source] one page lists, as items. */
    const fetch = (
      source: AutoSource,
      page: RowPage,
    ): Effect.Effect<readonly AutoItem[], Failure> => {
      switch (source.type) {
        case "albums":
          return store.listAlbumsPage(page).pipe(Effect.map((albums) => albums.map(autoAlbumItem)));
        // A handful of rows: page the Library's own list.
        case "playlists":
          return store.listPlaylists.pipe(
            Effect.map((playlists) => pageOf(playlists, page).map(autoPlaylistItem)),
          );
        // The app's Home shelf: a handful of albums.
        case "recentlyPlayed":
          return store.home.pipe(
            Effect.map((home) => pageOf(home.recentlyPlayed, page).map(autoAlbumItem)),
          );
        case "artists":
          return store.listArtistsPage(page).pipe(
            Effect.flatMap(withCovers),
            Effect.map((artists) => artists.map(autoArtistItem)),
          );
        case "artistAlbums":
          return store
            .getArtist(Number(source.id))
            .pipe(
              Effect.flatMap((detail) =>
                detail === null
                  ? notFound
                  : Effect.succeed(
                      pageOf([...detail.albums, ...detail.appearsOn], page).map(autoAlbumItem),
                    ),
              ),
            );
        case "tracks":
          return pageSongs[source.list.kind](source.list.id, page).pipe(
            Effect.map((songs) => autoTrackItems(source.list, songs.map(toAutoTrack), page.offset)),
          );
      }
    };

    const children = (parentId: string, page: number, pageSize: number) =>
      Effect.gen(function* () {
        const node = yield* decode(parentId);
        const result = autoChildren(node, page, pageSize);
        if (result === null) return [];
        const rows = result.fetch === null ? [] : yield* fetch(result.fetch.source, result.fetch);
        return autoPageItems(node, page, [...result.items, ...rows]);
      });

    /** A node's item; the ones built from a library row load it. */
    const item = (mediaId: string) =>
      Effect.gen(function* () {
        const node = yield* decode(mediaId);
        const known = autoItem(node);
        if (known !== null) return known;
        if (node.type === "list") {
          switch (node.list.kind) {
            case "album": {
              const detail = yield* store.getAlbum(Number(node.list.id));
              return detail === null ? yield* notFound : autoAlbumItem(detail.album);
            }
            case "playlist": {
              const detail = yield* store.getPlaylist(Number(node.list.id));
              return detail === null ? yield* notFound : autoPlaylistItem(detail.playlist);
            }
          }
        }
        if (node.type === "artist") {
          const detail = yield* store.getArtist(Number(node.id));
          if (detail === null) return yield* notFound;
          const [artist] = yield* withCovers([detail.artist]);
          return autoArtistItem(artist ?? detail.artist);
        }
        if (node.type === "track") {
          const songs = yield* songsOf(node.list);
          const tracks = songs.map(toAutoTrack);
          const index = autoQueueStart(node, tracks)?.startIndex;
          const found =
            index === undefined
              ? undefined
              : autoTrackItems(node.list, tracks.slice(index, index + 1), index)[0];
          return found ?? (yield* notFound);
        }
        return yield* notFound;
      });

    const play = (mediaId: string) =>
      Effect.gen(function* () {
        const node = yield* decode(mediaId);
        const list = autoPlayList(node);
        if (list === null) return yield* notFound;
        const songs = yield* songsOf(list);
        const start = autoQueueStart(node, songs.map(toAutoTrack));
        if (start === null) return yield* notFound;
        const playback: AutoPlayback = yield* queue.handOver(
          {
            type: "play",
            trackIds: start.trackIds,
            startIndex: start.startIndex,
            context: start.context,
            shuffle: start.shuffle,
          },
          songs.map(toQueueTrack),
        );
        return playback;
      });

    /** Adds the tracks of [mediaIds] (each a track or a Shuffle) to the end of the queue. */
    const add = (mediaIds: readonly string[]) =>
      Effect.gen(function* () {
        const trackIds: string[] = [];
        const tracks: QueueTrack[] = [];
        for (const mediaId of mediaIds) {
          const node = yield* decode(mediaId);
          const list = autoPlayList(node);
          if (list === null) return yield* notFound;
          const songs = yield* songsOf(list);
          const added = autoQueueAdd(node, songs.map(toAutoTrack));
          if (added === null) return yield* notFound;
          trackIds.push(...added);
          tracks.push(...songs.map(toQueueTrack));
        }
        if (trackIds.length > 0) yield* queue.dispatch({ type: "addToQueue", trackIds }, tracks);
        return null;
      });

    /**
     * Auto's shuffle and repeat buttons, through the queue engine like the
     * app's: shuffle keeps the current track, repeat goes off → all → one.
     */
    const command = (name: Extract<AutoRequest, { type: "command" }>["command"]) =>
      Effect.gen(function* () {
        const { shuffle, repeat } = queueState.get();
        yield* queue.dispatch(
          name === "toggleShuffle"
            ? { type: "setShuffle", on: !shuffle }
            : { type: "setRepeat", mode: nextRepeatMode(repeat) },
        );
        return null;
      });

    const answer = (request: AutoRequest): Effect.Effect<unknown, Failure> => {
      switch (request.type) {
        case "children":
          return children(request.parentId, request.page, request.pageSize);
        case "item":
          return item(request.mediaId);
        case "play":
          return play(request.mediaId);
        case "add":
          return add(request.mediaIds);
        case "command":
          return command(request.command);
      }
    };

    return Auto.of({ answer });
  }),
);
