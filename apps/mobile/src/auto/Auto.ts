import {
  AUTO_ROOT,
  autoAlbumItem,
  autoArtistItem,
  autoChildren,
  autoItem,
  autoPageItems,
  autoPlayList,
  autoPlaylistItem,
  autoQueueStart,
  autoTrackItems,
  decodeAutoMediaId,
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

import { LibraryStore, type LibraryStoreError, type SongRow } from "@/library/LibraryStore";
import type { AutoPlayback, AutoRequest } from "@/native/wavePlayer";
import type { PlayerError } from "@/playback/Player";
import { Queue, toQueueTrack } from "@/playback/Queue";

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
const toAutoTrack = (song: SongRow & Partial<Pick<AutoTrack, "discNumber" | "trackNumber">>) => ({
  id: String(song.id),
  title: song.title,
  artist: song.artist,
  discNumber: song.discNumber ?? null,
  trackNumber: song.trackNumber ?? null,
  titleSort: song.titleSort,
  path: song.path,
});

export const layer = Layer.effect(
  Auto,
  Effect.gen(function* () {
    const store = yield* LibraryStore;
    const queue = yield* Queue;

    /** Every song of a track list (any order; Core orders them), or null once it's gone. */
    const listSongs: Record<
      AutoTrackListKind,
      (id: string) => Effect.Effect<readonly SongRow[] | null, LibraryStoreError>
    > = {
      album: (id) =>
        store.getAlbum(Number(id)).pipe(Effect.map((detail) => detail?.tracks ?? null)),
      // In playlist order, which Core keeps.
      playlist: (id) =>
        store.getPlaylist(Number(id)).pipe(Effect.map((detail) => detail?.items ?? null)),
      artistSongs: (id) =>
        store.getArtist(Number(id)).pipe(Effect.map((detail) => detail?.songs ?? null)),
    };

    const songsOf = (list: AutoTrackList) =>
      listSongs[list.kind](list.id).pipe(
        Effect.flatMap((songs) => (songs === null ? notFound : Effect.succeed(songs))),
      );

    /** The rows of [source] one page lists, as items. */
    const fetch = (
      source: AutoSource,
      offset: number,
      limit: number,
    ): Effect.Effect<readonly AutoItem[], Failure> => {
      switch (source.type) {
        case "albums":
          return store
            .listAlbumsPage(offset, limit)
            .pipe(Effect.map((albums) => albums.map(autoAlbumItem)));
        // A handful of rows: page the Library's own list.
        case "playlists":
          return store.listPlaylists.pipe(
            Effect.map((playlists) =>
              playlists.slice(offset, offset + limit).map(autoPlaylistItem),
            ),
          );
        case "artists":
          return store
            .listArtistsPage(offset, limit)
            .pipe(Effect.map((artists) => artists.map(autoArtistItem)));
        case "artistAlbums":
          return store
            .getArtist(Number(source.id))
            .pipe(
              Effect.flatMap((detail) =>
                detail === null
                  ? notFound
                  : Effect.succeed(
                      [...detail.albums, ...detail.appearsOn]
                        .slice(offset, offset + limit)
                        .map(autoAlbumItem),
                    ),
              ),
            );
        case "tracks":
          return songsOf(source.list).pipe(
            Effect.map((songs) =>
              autoTrackItems(source.list, songs.map(toAutoTrack), offset, limit),
            ),
          );
      }
    };

    const children = (parentId: string, page: number, pageSize: number) =>
      Effect.gen(function* () {
        const node = yield* decode(parentId);
        const result = autoChildren(node, page, pageSize);
        if (result === null) return [];
        const rows =
          result.fetch === null
            ? []
            : yield* fetch(result.fetch.source, result.fetch.offset, result.fetch.limit);
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
          return detail === null ? yield* notFound : autoArtistItem(detail.artist);
        }
        if (node.type === "track") {
          const songs = yield* songsOf(node.list);
          const tracks = songs.map(toAutoTrack);
          const index = autoQueueStart(node, tracks)?.startIndex;
          const found =
            index === undefined ? undefined : autoTrackItems(node.list, tracks, index, 1)[0];
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

    const answer = (request: AutoRequest): Effect.Effect<unknown, Failure> => {
      switch (request.type) {
        case "root":
          return Effect.succeed(AUTO_ROOT);
        case "children":
          return children(request.parentId, request.page, request.pageSize);
        case "item":
          return item(request.mediaId);
        case "play":
          return play(request.mediaId);
      }
    };

    return Auto.of({ answer });
  }),
);
