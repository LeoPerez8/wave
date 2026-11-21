import type { LibraryDatabase } from "@wave/client/db/database";
import { addToPlaylist, selectPlaylistEntries } from "@wave/client/db/playlists";
import {
  desktopSelectionActions,
  groupSongs,
  isCollectionKind,
  itemActions,
  menuLayout,
  playlistPlayback,
  queueSongTrackId,
  settleUnsearched,
  toPlaylistSongs,
  unsearchedSearchQuery,
  type ActionItem,
  type CollectionKind,
  type DesktopSelectionItem,
  type QueueSong,
  type UpNextPlace,
  type YtAlbumSong,
  type YtDownloadStatus,
} from "@wave/core";
import type {
  CollectionActionOptions,
  CollectionMenu,
  CollectionRunAction,
  CollectionRunResult,
  CollectionPick,
  CollectionTarget,
  SelectionMenu,
  SelectionRunAction,
  SelectionRunResult,
  SelectionTarget,
} from "../../shared/collectionActions.ts";
import { SELECTION_RUN_ACTIONS } from "../../shared/collectionActions.ts";
import { MAX_TARGET_IDS, type SongTarget } from "../../shared/songActions.ts";
import type { DesktopDownloadsShape } from "../downloads/downloadsLayer.ts";
import { lookupsEnabled } from "../lookupSettings.ts";
import type { PlaybackShape } from "../playback/playback.ts";
import type { YtMusicShape } from "../yt/ytMusic.ts";
import { albumArtists } from "./artistPage.ts";
import { streamedLibraryFacts } from "../yt/streamedSong.ts";
import { browseRowIds, browseRows, browseSongs, browseTrackIds } from "./browse.ts";
import { refuseCollaborative } from "./collaborativePlaylists.ts";
import { songFacts, targetEntries } from "./songActions.ts";

const lists = {
  album: "albums",
  artist: "artists",
  genre: "genres",
  playlist: "playlists",
} as const;

export const validCollectionTarget = (value: unknown): value is CollectionTarget => {
  if (typeof value !== "object" || value === null || "scope" in value) return false;
  const { kind, id } = value as CollectionTarget;
  return isCollectionKind(kind) && Number.isSafeInteger(id) && id > 0;
};

type CollectionTrack = { readonly id: number; readonly path: string | null };
type CollectionSong = QueueSong<YtAlbumSong, CollectionTrack>;

const header = (db: LibraryDatabase, target: CollectionTarget) =>
  browseRows(db, lists[target.kind], [target.id])[0];

/** The listed songs in their collection's order, with a playlist's stored entries in place. */
export const collectionSongs = (
  db: LibraryDatabase,
  target: CollectionTarget,
): CollectionSong[] => {
  if (header(db, target) === undefined) throw new Error("Collection no longer exists");
  return target.kind === "playlist"
    ? selectPlaylistEntries(db, target.id).flatMap((entry) =>
        entry.source === "unavailable" ? [] : [entry],
      )
    : browseSongs(db, browseTrackIds(db, target).map(Number)).map((track) => ({
        source: "library",
        track,
      }));
};

const libraryIds = (songs: readonly CollectionSong[]): number[] =>
  songs.flatMap((entry) => (entry.source === "library" ? [entry.track.id] : []));

export const collectionMenu = (
  db: LibraryDatabase,
  target: CollectionTarget,
  { here = "", selectable = false, surface = "menu" }: CollectionActionOptions,
  ytMusic: boolean,
  status: (trackId: number) => YtDownloadStatus | null,
): CollectionMenu => {
  const row = header(db, target);
  if (row === undefined) return { entries: [], play: [], artists: [] };
  const onlineLookups = lookupsEnabled(db);
  const songs =
    onlineLookups || target.kind === "album"
      ? songFacts(db, browseTrackIds(db, target).map(Number))
      : [];
  const artists = target.kind === "album" ? albumArtists(db, target.id) : [];
  const entries = itemActions({
    kind: target.kind,
    items: [
      {
        artistIds: artists.map((artist) => artist.id),
        hasImage: row.imageKey != null,
        songs,
        missingSongs:
          target.kind === "album"
            ? songs.filter((song) => song.missing).map((song) => status(song.id))
            : undefined,
      },
    ],
    here,
    selectable,
    surface,
    onlineLookups,
    ytMusic,
  });
  const { cards, list } = menuLayout(target.kind, entries);
  return {
    entries,
    play:
      surface === "menu"
        ? [...cards, ...list.flatMap(({ action }) => (action === "shuffle" ? [action] : []))]
        : [],
    artists,
  };
};

interface CollectionActionPorts {
  readonly db: LibraryDatabase;
  readonly playback: Pick<PlaybackShape, "command" | "refresh">;
  readonly downloads: Pick<DesktopDownloadsShape, "fixSongs">;
  readonly yt: Pick<YtMusicShape, "enabled" | "search" | "withSongs">;
  readonly unavailable: (path: string) => boolean;
}

export const runCollectionAction = async (
  ports: CollectionActionPorts,
  target: CollectionTarget,
  action: CollectionRunAction,
  destination?: number,
): Promise<CollectionRunResult> =>
  runOnSongs(ports, collectionSongs(ports.db, target), action, destination);

const runOnSongs = async (
  { db, playback, downloads, yt, unavailable }: CollectionActionPorts,
  songs: readonly CollectionSong[],
  action: CollectionRunAction,
  destination?: number,
  /** Add to Queue dropped in Up Next, between those neighbours. */
  at?: UpNextPlace,
): Promise<CollectionRunResult> => {
  switch (action) {
    case "playNext":
    case "addToQueue": {
      const play = playlistPlayback(
        songs.filter(
          (entry) =>
            entry.source !== "library" ||
            (entry.track.path !== null && !unavailable(entry.track.path)),
        ),
        { ytMusic: yt.enabled() },
      );
      if (play === null) return { kind: "queued", count: 0 };
      const listed: readonly CollectionSong[] =
        play.playback.kind === "mixed"
          ? play.playback.songs
          : play.playback.tracks.map((track) => ({ source: "library", track }));
      const queued: CollectionSong[] = [];
      for (const entry of listed) {
        if (entry.source !== "unsearched") {
          queued.push(entry);
          continue;
        }
        const search = await yt.search(unsearchedSearchQuery(entry.song));
        if (search.status !== "ok") continue;
        const match = settleUnsearched(entry.song, { ok: true, songs: search.songs });
        if (match.kind === "found") queued.push(match.becomes);
      }
      const streams = queued.flatMap((entry) => (entry.source === "stream" ? [entry.song] : []));
      const trackIds = queued.map(queueSongTrackId);
      if (trackIds.length > 0)
        await yt.withSongs(streams, () =>
          playback.command(
            action === "addToQueue" && at !== undefined
              ? { type: action, trackIds, at }
              : { type: action, trackIds },
          ),
        );
      return { kind: "queued", count: trackIds.length };
    }
    case "addToPlaylist": {
      if (destination === undefined) throw new Error("No playlist to add to");
      refuseCollaborative(db, destination);
      const { name, added, alreadyIn } = addToPlaylist(
        db,
        destination,
        toPlaylistSongs(songs),
        Date.now(),
      );
      playback.refresh();
      return { kind: "playlist", name, added, alreadyIn };
    }
    case "fixSongs": {
      const result = await downloads.fixSongs(libraryIds(songs));
      playback.refresh();
      return { kind: "fixed", ...result };
    }
  }
};

const positiveIds = (value: unknown): value is readonly number[] =>
  Array.isArray(value) &&
  value.length <= MAX_TARGET_IDS &&
  value.every((id) => Number.isSafeInteger(id) && id > 0);

const validPick = (value: unknown): value is CollectionPick => {
  if (typeof value !== "object" || value === null) return false;
  const { kind, ids, all, except, find } = value as { [key: string]: unknown };
  if (typeof kind !== "string" || !isCollectionKind(kind as CollectionKind)) return false;
  return all === true
    ? ids === undefined &&
        positiveIds(except) &&
        (find === undefined || (typeof find === "string" && find.length <= 500))
    : all === undefined &&
        except === undefined &&
        find === undefined &&
        positiveIds(ids) &&
        ids.length > 0;
};

/** A selection that holds a collection; songs alone go through the song actions. */
export const validSelectionTarget = (
  value: unknown,
  validSongs: (songs: unknown) => songs is SongTarget,
): value is SelectionTarget => {
  if (typeof value !== "object" || value === null) return false;
  const { songs, collections } = value as { [key: string]: unknown };
  return (
    (songs === undefined || validSongs(songs)) &&
    Array.isArray(collections) &&
    collections.length > 0 &&
    collections.length <= 8 &&
    collections.every(validPick)
  );
};

/** The checked collections, each kind's in its list's order when all of them are. */
const pickedCollections = (db: LibraryDatabase, pick: CollectionPick): CollectionTarget[] => {
  if (!("all" in pick)) return [...new Set(pick.ids)].map((id) => ({ kind: pick.kind, id }));
  const except = new Set(pick.except);
  const list = { kind: lists[pick.kind], ...(pick.find === undefined ? {} : { find: pick.find }) };
  return browseRowIds(db, list, 0, 2 ** 31 - 1)
    .items.filter((id) => !except.has(id))
    .map((id) => ({ kind: pick.kind, id }));
};

/** The checked items in order: the songs, then each collection with the songs it holds. */
const selectionItems = (db: LibraryDatabase, target: SelectionTarget) => {
  const listed = target.songs === undefined ? [] : targetEntries(db, target.songs);
  const tracks = new Map(
    browseSongs(
      db,
      listed.flatMap((entry) => ("trackId" in entry ? [entry.trackId] : [])),
    ).map((track) => [track.id, track]),
  );
  const songs = listed.flatMap((entry): CollectionSong[] => {
    if ("song" in entry) return [{ source: "stream", song: entry.song }];
    const track = tracks.get(entry.trackId);
    return track === undefined ? [] : [{ source: "library", track }];
  });
  const collections = target.collections
    .flatMap((pick) => pickedCollections(db, pick))
    .map((collection) => ({ kind: collection.kind, songs: collectionSongs(db, collection) }));
  return { songs, collections };
};

const runnable: ReadonlySet<string> = new Set(SELECTION_RUN_ACTIONS);

/** The entries the bar offers for songs and collections checked together. */
export const selectionMenu = (
  db: LibraryDatabase,
  target: SelectionTarget,
  ytMusic: boolean,
): SelectionMenu => {
  const { songs, collections } = selectionItems(db, target);
  const facts = new Map(
    songFacts(db, libraryIds([...songs, ...collections.flatMap((item) => item.songs)])).map(
      (song) => [song.id, song],
    ),
  );
  const factsOf = (entry: CollectionSong): ActionItem[] => {
    if (entry.source === "library") return [facts.get(entry.track.id) ?? {}];
    if (entry.source !== "stream") return [];
    return [{ streamed: true, downloaded: streamedLibraryFacts(db, entry.song).hasFile }];
  };
  const items: DesktopSelectionItem[] = [
    ...songs.flatMap(factsOf).map((song) => ({ ...song, kind: "track" as const })),
    ...collections.map(({ kind, songs }) => ({ kind, songs: songs.flatMap(factsOf) })),
  ];
  return {
    entries: desktopSelectionActions({ items, onlineLookups: lookupsEnabled(db), ytMusic }).filter(
      (entry) => runnable.has(entry.action),
    ),
    count: items.length,
  };
};

interface SelectionActionPorts extends CollectionActionPorts {
  /** Downloads missing songs into their Library entries. */
  readonly download: (trackIds: readonly number[]) => Promise<void>;
  /** Downloads a streamed song, as its menu's Download does. */
  readonly downloadStreamed: (song: YtAlbumSong) => Promise<unknown>;
}

/** Runs [action] on every song the checked items hold, a song two of them hold once. */
export const runSelectionAction = async (
  ports: SelectionActionPorts,
  target: SelectionTarget,
  action: SelectionRunAction,
  destination?: number,
  at?: UpNextPlace,
): Promise<SelectionRunResult> => {
  const { db } = ports;
  const { songs, collections } = selectionItems(db, target);
  const held = groupSongs([songs, ...collections.map((item) => item.songs)], queueSongTrackId);
  if (action !== "download") return runOnSongs(ports, held, action, destination, at);
  const missing = libraryIds(
    held.filter((entry) => entry.source === "library" && entry.track.path === null),
  );
  const streams = held.flatMap((entry) =>
    entry.source === "stream" && !streamedLibraryFacts(db, entry.song).hasFile ? [entry.song] : [],
  );
  if (missing.length > 0) await ports.download(missing);
  for (const song of streams) await ports.downloadStreamed(song);
  return { kind: "downloaded", count: missing.length + streams.length };
};
