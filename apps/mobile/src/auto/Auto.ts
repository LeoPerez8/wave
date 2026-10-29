import { currentLocalisation } from "@/localisation/localisation";
import {
  artistRanking,
  autoAlbumItem,
  autoArtistItem,
  autoChildren,
  autoItem,
  autoListPlay,
  autoPageItems,
  autoPlayList,
  autoPlaylistItem,
  autoQueueStart,
  autoTrackItems,
  currentEntry,
  decodeAutoMediaId,
  joinArtists,
  libraryTrackIds,
  nextRepeatMode,
  statsWindow,
  unsearchedTrackId,
  ytSongArtist,
  ytTrackId,
  type AutoHomeList,
  type AutoItem,
  type AutoNode,
  type AutoSource,
  type AutoTrack,
  type AutoTrackList,
  type AutoTrackListKind,
  type QueueSong,
  type YtSong,
} from "@wave/core";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import type { RowPage } from "@/library/db/database";
import type { HomeSections } from "@/library/db/playHistory";
import {
  LibraryStore,
  type AlbumRow,
  type LibraryStoreError,
  type PlaylistEntryRow,
  songHasFile,
  type PlayableSongRow,
  type SongRow,
} from "@/library/LibraryStore";
import { sortedPlaylists } from "@/library/playlistOrder";
import type { AutoPlayback, AutoRequest } from "@/native/wavePlayer";
import type { PlayerError } from "@/playback/Player";
import { Queue, queueState, toQueueTrack, type QueueTrack } from "@/playback/Queue";
import { toUnsearchedQueueTrack, toYtQueueTrack } from "@/playback/queueTracks";
import { ytMusicEnabled } from "@/settings/ytMusic";

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

const notFound = Effect.suspend(() =>
  Effect.fail(new AutoError({ message: currentLocalisation().strings.auto.notFound })),
);

const decode = (mediaId: string): Effect.Effect<AutoNode, AutoError> => {
  const node = decodeAutoMediaId(mediaId);
  return node === null ? notFound : Effect.succeed(node);
};

/**
 * A song of a track list: a Library song with a file, a playlist's YT Music
 * entry, streamed as a streamed song is anywhere else, or its unsearched
 * entry, searched as it's about to play, as on the phone. Auto leaves
 * missing songs out: the store reads Auto's lists with files only (`TrackScope`).
 */
type AutoSong = QueueSong<YtSong, PlayableSongRow>;

const fromLibrary = (songs: readonly SongRow[]): readonly AutoSong[] =>
  songs.filter(songHasFile).map((track) => ({ source: "library", track }));

/** A playlist's entries as a track list's songs; an unavailable entry plays nowhere, so isn't one. */
const playlistSongs = (entries: readonly PlaylistEntryRow[]): readonly AutoSong[] =>
  entries.flatMap((entry): AutoSong[] =>
    entry.source === "stream" || entry.source === "unsearched"
      ? [entry]
      : entry.source === "library" && songHasFile(entry.track)
        ? [{ source: "library", track: entry.track }]
        : [],
  );

/** A song as Core's track lists need it. A YT Music or unsearched entry has no cached cover to show. */
const toAutoTrack = (song: AutoSong): AutoTrack => {
  switch (song.source) {
    case "library":
      return {
        id: String(song.track.id),
        title: song.track.title,
        artist: song.track.artist,
        artworkPath: song.track.artworkPath,
      };
    case "stream":
      return {
        id: ytTrackId(song.song.videoId),
        title: song.song.title,
        artist: ytSongArtist(song.song),
        artworkPath: null,
      };
    case "unsearched":
      return {
        id: unsearchedTrackId(song.song),
        title: song.song.title,
        artist: joinArtists(song.song.artists),
        artworkPath: null,
      };
  }
};

/** A song as the queue needs it; a YT Music entry goes with YouTube's cover address. */
const toAutoQueueTrack = (song: AutoSong): QueueTrack =>
  song.source === "library"
    ? toQueueTrack(song.track)
    : song.source === "stream"
      ? toYtQueueTrack(song.song, null)
      : toUnsearchedQueueTrack(song.song);

const ytMusicOff = Effect.suspend(() =>
  Effect.fail(new AutoError({ message: currentLocalisation().strings.auto.ytMusicOff })),
);

const pageOf = <A>(rows: readonly A[], page: RowPage): readonly A[] =>
  rows.slice(page.offset, page.offset + page.limit);

/** The songs of each of Home's song sections, as the app's Home tab lists them. */
const HOME_SONGS: Record<AutoHomeList, (home: HomeSections) => readonly SongRow[]> = {
  // Read in the "files" scope: only Library songs with a file, never a streamed song.
  "most-played": (home) =>
    home.mostPlayed.flatMap((row) => (row.source === "library" ? [row.track] : [])),
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
      (id: string) => Effect.Effect<readonly AutoSong[] | null, LibraryStoreError>
    > = {
      album: (id) =>
        store
          .getAlbum(Number(id), "files")
          .pipe(Effect.map((detail) => (detail === null ? null : fromLibrary(detail.tracks)))),
      // Its YT Music entries too, in their places.
      playlist: (id) =>
        store
          .getPlaylist(Number(id), "files")
          .pipe(Effect.map((detail) => (detail === null ? null : playlistSongs(detail.items)))),
      // The app's Home tab lists.
      home: (id) =>
        store
          .home("files")
          .pipe(Effect.map((home) => (isHomeList(id) ? fromLibrary(HOME_SONGS[id](home)) : null))),
      artistSongs: (id) =>
        store
          .getArtist(Number(id), "files")
          .pipe(Effect.map((detail) => (detail === null ? null : fromLibrary(detail.songs)))),
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
      (id: string, page: RowPage) => Effect.Effect<readonly AutoSong[], Failure>
    > = {
      album: (id, page) =>
        songsOf({ kind: "album", id }).pipe(Effect.map((songs) => pageOf(songs, page))),
      playlist: (id, page) =>
        store.listPlaylistEntriesPage(Number(id), page).pipe(Effect.map(playlistSongs)),
      home: (id, page) =>
        songsOf({ kind: "home", id }).pipe(Effect.map((songs) => pageOf(songs, page))),
      artistSongs: (id, page) =>
        store.listArtistSongsPage(Number(id), page).pipe(Effect.map(fromLibrary)),
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
        // A handful of rows: page the Library's own list, in the order the phone shows it.
        case "playlists":
          return sortedPlaylists(store).pipe(
            Effect.map((playlists) =>
              pageOf(playlists, page).map((row) =>
                autoPlaylistItem(row, currentLocalisation().strings),
              ),
            ),
          );
        // The app's Home shelf: a handful of albums.
        case "recentlyPlayed":
          return store.home("files").pipe(
            Effect.map((home) =>
              pageOf(
                home.recentlyPlayed.filter(
                  (album): album is AlbumRow => typeof album.id === "number",
                ),
                page,
              ).map(autoAlbumItem),
            ),
          );
        case "artists":
          return store.listArtistsPage(page).pipe(
            Effect.flatMap(withCovers),
            Effect.map((artists) => artists.map(autoArtistItem)),
          );
        case "artistAlbums":
          return store
            .getArtist(Number(source.id), "files")
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
        const result = autoChildren(node, page, pageSize, currentLocalisation().strings);
        if (result === null) return [];
        const rows = result.fetch === null ? [] : yield* fetch(result.fetch.source, result.fetch);
        return autoPageItems(node, page, [...result.items, ...rows], currentLocalisation().strings);
      });

    /** A node's item; the ones built from a library row load it. */
    const item = (mediaId: string) =>
      Effect.gen(function* () {
        const node = yield* decode(mediaId);
        const known = autoItem(node, currentLocalisation().strings);
        if (known !== null) return known;
        if (node.type === "list") {
          switch (node.list.kind) {
            case "album": {
              const detail = yield* store.getAlbum(Number(node.list.id), "files");
              return detail === null ? yield* notFound : autoAlbumItem(detail.album);
            }
            case "playlist": {
              const detail = yield* store.getPlaylist(Number(node.list.id), "files");
              return detail === null
                ? yield* notFound
                : autoPlaylistItem(detail.playlist, currentLocalisation().strings);
            }
          }
        }
        if (node.type === "artist") {
          const detail = yield* store.getArtist(Number(node.id), "files");
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

    /**
     * What playing or adding [node] does, by Core's `autoListPlay` (the
     * phone's `playlistPlayback`: with YT Music off a playlist's YT Music
     * entries show but don't play).
     */
    const playOf = (node: AutoNode) =>
      Effect.gen(function* () {
        const list = autoPlayList(node);
        if (list === null) return yield* notFound;
        const play = autoListPlay(node, yield* songsOf(list), ytMusicEnabled());
        if (play.kind === "notFound") return yield* notFound;
        if (play.kind === "ytMusicOff") return yield* ytMusicOff;
        return play;
      });

    const play = (mediaId: string) =>
      Effect.gen(function* () {
        const { start, songs } = yield* playOf(yield* decode(mediaId));
        const playback: AutoPlayback = yield* queue.handOver(
          {
            type: "play",
            trackIds: start.trackIds,
            startIndex: start.startIndex,
            context: start.context,
            shuffle: start.shuffle,
          },
          songs.map(toAutoQueueTrack),
        );
        return playback;
      });

    /** Adds the tracks of [mediaIds] (each a track or a Shuffle) to the end of the queue. */
    const add = (mediaIds: readonly string[]) =>
      Effect.gen(function* () {
        const trackIds: string[] = [];
        const tracks: QueueTrack[] = [];
        for (const mediaId of mediaIds) {
          const { added, songs } = yield* playOf(yield* decode(mediaId));
          trackIds.push(...added);
          tracks.push(...songs.map(toAutoQueueTrack));
        }
        if (trackIds.length > 0) yield* queue.dispatch({ type: "addToQueue", trackIds }, tracks);
        return null;
      });

    /**
     * More from this artist: the current track's artist's songs, ranked by
     * Core (`artistRanking`), go to the queue engine, which adds the next
     * three that aren't queued. Nothing playing or a song gone: nothing to add.
     */
    const moreFromArtist = Effect.gen(function* () {
      const current = currentEntry(queueState.get());
      // A YT Music song playing has no Library artist to take songs from.
      const libraryIds = current === null ? [] : libraryTrackIds([current.trackId]);
      if (libraryIds.length === 0) return null;
      const [song] = yield* store.songsByIds(libraryIds);
      if (song === undefined) return null;
      const detail = yield* store.getArtist(song.artistId, "files");
      if (detail === null) return null;
      const playable = detail.songs.filter(songHasFile);
      const plays = yield* store.trackPlayTotals(statsWindow("all", Date.now()));
      const ranking = artistRanking({
        albumIds: [...detail.albums, ...detail.appearsOn].map((album) => album.id),
        songs: playable,
        plays,
      });
      yield* queue.dispatch({ type: "moreFromArtist", ranking }, playable.map(toQueueTrack));
      return null;
    });

    /**
     * Auto's shuffle and repeat buttons, through the queue engine like the
     * app's: shuffle keeps the current track, repeat goes off → all → one.
     */
    const command = (name: Extract<AutoRequest, { type: "command" }>["command"]) =>
      Effect.gen(function* () {
        if (name === "moreFromArtist") return yield* moreFromArtist;
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
