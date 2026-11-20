import type { LibraryDatabase } from "@wave/client/db/database";
import { addToPlaylist, selectPlaylistEntries } from "@wave/client/db/playlists";
import {
  isCollectionKind,
  itemActions,
  menuLayout,
  playlistPlayback,
  queueSongTrackId,
  settleUnsearched,
  toPlaylistSongs,
  unsearchedSearchQuery,
  type QueueSong,
  type YtAlbumSong,
  type YtDownloadStatus,
} from "@wave/core";
import type {
  CollectionActionOptions,
  CollectionMenu,
  CollectionRunAction,
  CollectionRunResult,
  CollectionTarget,
} from "../../shared/collectionActions.ts";
import type { DesktopDownloadsShape } from "../downloads/downloadsLayer.ts";
import { lookupsEnabled } from "../lookupSettings.ts";
import type { PlaybackShape } from "../playback/playback.ts";
import type { YtMusicShape } from "../yt/ytMusic.ts";
import { albumArtists } from "./artistPage.ts";
import { browseRows, browseSongs, browseTrackIds } from "./browse.ts";
import { songFacts } from "./songActions.ts";

const lists = { album: "albums", artist: "artists", genre: "genres", playlist: "playlists" } as const;

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
export const collectionSongs = (db: LibraryDatabase, target: CollectionTarget): CollectionSong[] => {
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
  const songs = onlineLookups || target.kind === "album"
    ? songFacts(db, browseTrackIds(db, target).map(Number))
    : [];
  const artists = target.kind === "album" ? albumArtists(db, target.id) : [];
  const entries = itemActions({
    kind: target.kind,
    items: [{
      artistIds: artists.map((artist) => artist.id),
      hasImage: row.imageKey != null,
      songs,
      missingSongs: target.kind === "album"
        ? songs.filter((song) => song.missing).map((song) => status(song.id))
        : undefined,
    }],
    here,
    selectable,
    surface,
    onlineLookups,
    ytMusic,
  });
  const { cards, list } = menuLayout(target.kind, entries);
  return {
    entries,
    play: surface === "menu" ? [...cards, ...list.flatMap(({ action }) => action === "shuffle" ? [action] : [])] : [],
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
  { db, playback, downloads, yt, unavailable }: CollectionActionPorts,
  target: CollectionTarget,
  action: CollectionRunAction,
  destination?: number,
): Promise<CollectionRunResult> => {
  const songs = collectionSongs(db, target);
  switch (action) {
    case "playNext":
    case "addToQueue": {
      const play = playlistPlayback(songs.filter((entry) =>
        entry.source !== "library" || (entry.track.path !== null && !unavailable(entry.track.path)),
      ), { ytMusic: yt.enabled() });
      if (play === null) return { kind: "queued", count: 0 };
      const listed: readonly CollectionSong[] = play.playback.kind === "mixed"
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
        await yt.withSongs(streams, () => playback.command({ type: action, trackIds }));
      return { kind: "queued", count: trackIds.length };
    }
    case "addToPlaylist": {
      if (destination === undefined) throw new Error("No playlist to add to");
      const { name, added, alreadyIn } = addToPlaylist(db, destination, toPlaylistSongs(songs), Date.now());
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
