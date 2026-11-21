/**
 * A song's menu and the selection bar, on main's side: which songs a target names, which
 * entries Core offers for them, and the entries main runs. Opening a page, a submenu or
 * selection stays in the window.
 */
import type { LibraryDatabase } from "@wave/client/db/database";
import { chunks } from "@wave/client/db/chunks";
import { setFavorites } from "@wave/client/db/playHistory";
import { addToPlaylist } from "@wave/client/db/playlists";
import { isCollaborative, refuseCollaborative } from "./collaborativePlaylists.ts";
import {
  canFixSong,
  desktopSongActions,
  ytTrackId,
  type ActionItem,
  type ActionSurface,
  type ExplicitFlag,
  type PlaylistSong,
  type YtAlbumSong,
} from "@wave/core";
import { sql } from "drizzle-orm";
import type { BrowseScope } from "../../shared/browse.ts";
import type {
  FixSongsResult,
  SongMenu,
  SongRunAction,
  SongRunResult,
  SongTarget,
} from "../../shared/songActions.ts";
import { browseTrackIds, playlistSongs, type PlaylistSong as ListedSong } from "./browse.ts";
import { lookupsEnabled } from "../lookupSettings.ts";
import { streamedLibraryFacts, streamedPlaylistEntry } from "../yt/streamedSong.ts";

/** What main needs to run the entries. */
export interface SongActionPorts {
  readonly download: (trackIds: readonly number[]) => Promise<void>;
  readonly db: LibraryDatabase;
  /** Queues songs, as the Queue's Play Next and Add to Queue do. */
  readonly queue: (
    type: "playNext" | "addToQueue",
    trackIds: readonly string[],
    songs: readonly YtAlbumSong[],
  ) => Promise<void>;
  readonly runStreamed: (
    song: YtAlbumSong,
    action: "favorite" | "unfavorite" | "download",
  ) => Promise<unknown>;
  /** Takes songs out of the Library, keeping their files out of later scans. */
  readonly removeSongs: (trackIds: readonly number[]) => Promise<void>;
  /** Tells the window its rows changed (a star). */
  readonly changed: () => void;
  /** Fix Songs on the songs, one after another (`fixSongs`). */
  readonly fixSongs: (trackIds: readonly number[]) => Promise<FixSongsResult>;
  /** Takes songs out of a playlist, as its Graveyard keeps them; how many came out. */
  readonly removeFromPlaylist: (playlistId: number, trackIds: readonly number[]) => number;
}

const rowKey = (song: ListedSong) => ("trackId" in song ? song.trackId : -song.itemId);

/** The target's entries in list order, including stored streamed songs on a playlist page. */
export const targetEntries = (db: LibraryDatabase, target: SongTarget): ListedSong[] => {
  const { scope } = target;
  const mixed =
    scope.kind === "playlist" && scope.id !== undefined
      ? playlistSongs(db, scope.id, scope.find)
      : undefined;
  const named = new Set("all" in target ? target.except : target.ids);
  const seen = new Set<number>();
  return (mixed ?? browseTrackIds(db, scope).map((id) => ({ trackId: Number(id) }))).filter(
    (song) => {
      const key = rowKey(song);
      if (seen.has(key) || named.has(key) === "all" in target) return false;
      seen.add(key);
      return true;
    },
  );
};

/** [target]'s Library song ids, once each, in its list's order. */
export const targetSongs = (db: LibraryDatabase, target: SongTarget): number[] =>
  targetEntries(db, target).flatMap((song) => ("trackId" in song ? [song.trackId] : []));

const playlistEntry = (db: LibraryDatabase, entry: ListedSong): PlaylistSong =>
  "trackId" in entry
    ? { source: "library", trackId: entry.trackId }
    : streamedPlaylistEntry(db, entry.song);

export const targetPlaylistEntries = (db: LibraryDatabase, target: SongTarget): PlaylistSong[] =>
  targetEntries(db, target).map((entry) => playlistEntry(db, entry));

interface SongFacts extends ActionItem {
  readonly id: number;
  readonly title: string;
}

export const songFacts = (db: LibraryDatabase, ids: readonly number[]): SongFacts[] => {
  const found = new Map<number, SongFacts>();
  for (const part of chunks(ids)) {
    const list = sql.join(
      part.map((id) => sql`${id}`),
      sql`, `,
    );
    const credits = new Map<number, number[]>();
    for (const credit of db.all<{ trackId: number; artistId: number }>(
      sql`SELECT track_id AS trackId, artist_id AS artistId FROM track_artists
        WHERE track_id IN (${list}) ORDER BY track_id, position`,
    ))
      credits.set(credit.trackId, [...(credits.get(credit.trackId) ?? []), credit.artistId]);
    for (const song of db.all<{
      id: number;
      title: string;
      albumId: number;
      path: string | null;
      favorite: number;
      hasLyrics: number;
      genre: string | null;
      trackNumber: number | null;
      year: number | null;
      explicit: ExplicitFlag;
    }>(
      sql`SELECT t.id, t.title, t.album_id AS albumId, t.path,
        EXISTS(SELECT 1 FROM favorites f WHERE f.track_id=t.id AND f.deleted=0) AS favorite,
        t.has_lyrics AS hasLyrics, g.name AS genre, t.track_number AS trackNumber, t.year,
        t.explicit
        FROM tracks t LEFT JOIN genres g ON g.id = t.genre_id WHERE t.id IN (${list})`,
    ))
      found.set(song.id, {
        id: song.id,
        title: song.title,
        albumId: song.albumId,
        artistIds: credits.get(song.id) ?? [],
        favorite: song.favorite === 1,
        missing: song.path === null,
        fixable: canFixSong({ ...song, hasLyrics: song.hasLyrics === 1 }),
      });
  }
  return ids.flatMap((id) => found.get(id) ?? []);
};

const pageOf = (scope: BrowseScope) =>
  (scope.kind === "album" || scope.kind === "artist") && scope.id !== undefined
    ? { kind: scope.kind, id: scope.id }
    : undefined;

/** The entries to show for [target] on [surface]; with [ytMusic] on, one song starts a Magic Queue. */
export const songMenu = (
  db: LibraryDatabase,
  target: SongTarget,
  surface: ActionSurface,
  ytMusic = false,
): SongMenu => {
  // A playlist's page offers Remove from Playlist, unless the playlist is collaborative.
  const { scope } = target;
  const inPlaylist =
    scope.kind === "playlist" && !(scope.id !== undefined && isCollaborative(db, scope.id));
  const listed = targetEntries(db, target);
  const local = new Map(
    songFacts(
      db,
      listed.flatMap((song) => ("trackId" in song ? [song.trackId] : [])),
    ).map((song) => [song.id, song]),
  );
  const items = listed.flatMap((entry): (ActionItem & { title: string })[] => {
    if ("trackId" in entry) {
      const song = local.get(entry.trackId);
      return song ? [{ ...song, inPlaylist }] : [];
    }
    const facts = streamedLibraryFacts(db, entry.song);
    return [
      {
        title: entry.song.title,
        streamed: true,
        downloaded: facts.hasFile,
        favorite: facts.starred,
        inPlaylist,
      },
    ];
  });
  const entries = desktopSongActions({
    items,
    surface,
    selectable: true,
    page: pageOf(target.scope),
    onlineLookups: lookupsEnabled(db),
    ytMusic,
    share: !items.some((item) => item.streamed),
  });
  const artistIds = entries.flatMap((entry) =>
    entry.action !== "goToArtist" || !("artists" in entry)
      ? []
      : entry.artists.kind === "open"
        ? [entry.artists.artistId]
        : entry.artists.artistIds,
  );
  const names = new Map(
    artistIds.length === 0
      ? []
      : db
          .all<{ id: number; name: string }>(
            sql`SELECT id, name FROM artists WHERE id IN (${sql.join(
              artistIds.map((id) => sql`${id}`),
              sql`, `,
            )})`,
          )
          .map((artist) => [artist.id, artist.name]),
  );
  return {
    entries,
    count: items.length,
    title: items[0]?.title ?? null,
    artists: artistIds.flatMap((id) => {
      const name = names.get(id);
      return name === undefined ? [] : [{ id, name }];
    }),
  };
};

/** Runs [action] on [target]'s songs. */
export const runSongAction = async (
  ports: SongActionPorts,
  target: SongTarget,
  action: SongRunAction,
  playlistId?: number,
): Promise<SongRunResult> => {
  const { db } = ports;
  const entries = targetEntries(db, target);
  const ids = entries.flatMap((song) => ("trackId" in song ? [song.trackId] : []));
  const streams = entries.flatMap((entry) => ("song" in entry ? [entry.song] : []));
  switch (action) {
    case "download": {
      const missing = songFacts(db, ids)
        .filter((song) => song.missing === true)
        .map((song) => song.id);
      await ports.download(missing);
      const online = streams.filter((song) => !streamedLibraryFacts(db, song).hasFile);
      for (const song of online) await ports.runStreamed(song, action);
      return { kind: "downloaded", count: missing.length + online.length };
    }
    case "playNext":
    case "addToQueue": {
      // A missing song has no file to play, as the phone's menu says by leaving these out.
      const playable = new Set(
        songFacts(db, ids)
          .filter((song) => !song.missing)
          .map((song) => song.id),
      );
      const trackIds = entries.flatMap((entry) =>
        "song" in entry
          ? [ytTrackId(entry.song.videoId)]
          : playable.has(entry.trackId)
            ? [String(entry.trackId)]
            : [],
      );
      await ports.queue(action, trackIds, streams);
      return { kind: "queued", count: trackIds.length };
    }
    case "favorite":
    case "unfavorite": {
      const on = action === "favorite";
      setFavorites(db, ids, on, Date.now());
      for (const song of streams) await ports.runStreamed(song, action);
      ports.changed();
      return { kind: "favorite", on, count: entries.length };
    }
    case "addToPlaylist": {
      if (playlistId === undefined) throw new Error("No playlist to add to");
      refuseCollaborative(db, playlistId);
      const result = addToPlaylist(
        db,
        playlistId,
        entries.map((entry) => playlistEntry(db, entry)),
        Date.now(),
      );
      ports.changed();
      return {
        kind: "playlist",
        name: result.name,
        added: result.added,
        alreadyIn: result.alreadyIn,
      };
    }
    case "removeFromPlaylist": {
      const { scope } = target;
      if (scope.kind !== "playlist" || scope.id === undefined)
        throw new Error("The songs aren't a playlist's");
      refuseCollaborative(db, scope.id);
      return {
        kind: "playlistRemoved",
        count: ports.removeFromPlaylist(scope.id, entries.map(rowKey)),
      };
    }
    case "removeFromLibrary":
      await ports.removeSongs(ids);
      ports.changed();
      return { kind: "removed", count: ids.length };
    case "fixSong":
    case "fixSongs": {
      const result = await ports.fixSongs(ids);
      ports.changed();
      return { kind: "fixed", ...result };
    }
  }
};
