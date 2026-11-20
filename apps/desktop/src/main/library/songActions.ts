/**
 * A song's menu and the selection bar, on main's side: which songs a target names, which
 * entries Core offers for them, and the entries main runs. Opening a page, a submenu or
 * selection stays in the window.
 */
import type { LibraryDatabase } from "@wave/client/db/database";
import { chunks } from "@wave/client/db/chunks";
import { setFavorites } from "@wave/client/db/playHistory";
import { addToPlaylist } from "@wave/client/db/playlists";
import {
  canFixSong,
  desktopSongActions,
  type ActionItem,
  type ActionSurface,
  type ExplicitFlag,
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
import { browseTrackIds } from "./browse.ts";
import { lookupsEnabled } from "../lookupSettings.ts";

/** What main needs to run the entries. */
export interface SongActionPorts {
  readonly download: (trackIds: readonly number[]) => Promise<void>;
  readonly db: LibraryDatabase;
  /** Queues songs, as the Queue's Play Next and Add to Queue do. */
  readonly queue: (type: "playNext" | "addToQueue", trackIds: readonly string[]) => Promise<void>;
  /** Takes songs out of the Library, keeping their files out of later scans. */
  readonly removeSongs: (trackIds: readonly number[]) => Promise<void>;
  /** Tells the window its rows changed (a star). */
  readonly changed: () => void;
  /** Fix Songs on the songs, one after another (`fixSongs`). */
  readonly fixSongs: (trackIds: readonly number[]) => Promise<FixSongsResult>;
  /** Takes songs out of a playlist, as its Graveyard keeps them; how many came out. */
  readonly removeFromPlaylist: (playlistId: number, trackIds: readonly number[]) => number;
}

/** [target]'s song ids, once each, in its list's order. */
export const targetSongs = (db: LibraryDatabase, target: SongTarget): number[] => {
  const listed = [...new Set(browseTrackIds(db, target.scope).map(Number))];
  if ("all" in target) {
    const except = new Set(target.except);
    return listed.filter((id) => !except.has(id));
  }
  const named = new Set(target.ids);
  return listed.filter((id) => named.has(id));
};

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
  // A playlist's page offers Remove from Playlist.
  const inPlaylist = target.scope.kind === "playlist";
  const items = songFacts(db, targetSongs(db, target)).map((song) => ({ ...song, inPlaylist }));
  const entries = desktopSongActions({
    items,
    surface,
    selectable: true,
    page: pageOf(target.scope),
    onlineLookups: lookupsEnabled(db),
    ytMusic,
    copyLink: ytMusic,
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
  const ids = targetSongs(db, target);
  switch (action) {
    case "download": {
      const missing = songFacts(db, ids)
        .filter((song) => song.missing === true)
        .map((song) => song.id);
      await ports.download(missing);
      return { kind: "downloaded", count: missing.length };
    }
    case "playNext":
    case "addToQueue": {
      // A missing song has no file to play, as the phone's menu says by leaving these out.
      const playable = songFacts(db, ids).filter((song) => song.missing !== true);
      await ports.queue(
        action,
        playable.map((song) => String(song.id)),
      );
      return { kind: "queued", count: playable.length };
    }
    case "favorite":
    case "unfavorite": {
      const on = action === "favorite";
      setFavorites(db, ids, on, Date.now());
      ports.changed();
      return { kind: "favorite", on, count: ids.length };
    }
    case "addToPlaylist": {
      if (playlistId === undefined) throw new Error("No playlist to add to");
      const result = addToPlaylist(
        db,
        playlistId,
        ids.map((id) => ({ source: "library", trackId: id })),
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
      return { kind: "playlistRemoved", count: ports.removeFromPlaylist(scope.id, ids) };
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
