/**
 * A streamed YouTube Music song's menu on main's side, as the phone's (docs/spec.md, stories 46a
 * and 77): Core's `ytSongActions` and `ytDownloadActions`, starring it (a star means downloaded:
 * a pending favorite until the file comes, or the Library's song when the Library has it),
 * adding it to a playlist (the Library's song, else a YT Music entry) and downloading it.
 */
import type { LibraryDatabase } from "@wave/client/db/database";
import { selectNowPlayingSong } from "@wave/client/db/nowPlayingSong";
import { addPendingFavorites, removePendingFavorites } from "@wave/client/db/pendingFavorites";
import { setFavorites } from "@wave/client/db/playHistory";
import { addToPlaylist } from "@wave/client/db/playlists";
import { refuseCollaborative } from "../library/collaborativePlaylists.ts";
import {
  artistPhotoName,
  missingSongJobId,
  nowPlayingDownload,
  pendingFavorite,
  streamedArtistLink,
  ytDownloadActions,
  ytSongActions,
  ytTrackId,
  type PlaylistSong,
  type StreamedArtistTarget,
  type YtAlbumSong,
} from "@wave/core";
import { sql } from "drizzle-orm";
import type {
  StreamedArtist,
  StreamedEntry,
  StreamedRunAction,
  StreamedRunResult,
  StreamedSongMenu,
} from "../../shared/streamedSongs.ts";
import type { AskedBy, DownloadsShape } from "../downloads/downloads.ts";

export interface StreamedSongPorts {
  readonly db: LibraryDatabase;
  readonly ytMusic: () => boolean;
  readonly downloads: Pick<
    DownloadsShape,
    "yt" | "missing" | "cancel" | "retry" | "status" | "ytStatus" | "unstarred"
  >;
  readonly queue: (type: "playNext" | "addToQueue", videoId: string) => Promise<void>;
  /** The rows changed (a star, a playlist): the window reads them again and the account hears. */
  readonly changed: () => void;
}

/** The entries the desktop offers; Select and the playing card's are the phone's. */
const OFFERED: ReadonlySet<string> = new Set<StreamedEntry["action"]>([
  "playNext",
  "addToQueue",
  "magicQueue",
  "addToPlaylist",
  "favorite",
  "unfavorite",
  "goToAlbum",
  "goToArtist",
  "releaseDate",
  "share",
]);

/** The Library artist named [name], as artist photos compare names; null for none. */
const libraryArtist =
  (db: LibraryDatabase) =>
  (name: string): StreamedArtist | null => {
    const key = artistPhotoName(name);
    return (
      db
        .all<StreamedArtist>(
          sql`SELECT id, name FROM artists WHERE name = ${name} COLLATE NOCASE ORDER BY id`,
        )
        .find((artist) => artistPhotoName(artist.name) === key) ?? null
    );
  };

/** Where the artist [name] of a streamed song leads, by the rule Go to Artist follows. */
export const streamedArtistTarget = (
  db: LibraryDatabase,
  name: string,
): StreamedArtistTarget<StreamedArtist> => {
  const link = streamedArtistLink([name], {
    libraryArtist: libraryArtist(db),
    enabled: true,
    here: "/",
  });
  return link?.kind === "open" ? link.target : { kind: "yt", name };
};

/** Whether [song] is starred: a pending favorite, or the Library's song for it starred. */
export const streamedStarred = (db: LibraryDatabase, song: YtAlbumSong): boolean =>
  streamedLibraryFacts(db, song).starred;

export const streamedLibraryFacts = (db: LibraryDatabase, song: YtAlbumSong) => {
  const { track, favorite, pendingFavorite } = selectNowPlayingSong(db, {
    trackId: ytTrackId(song.videoId),
    song,
  });
  return { track, starred: favorite || pendingFavorite, hasFile: track?.path != null };
};

export const streamedPlaylistEntry = (db: LibraryDatabase, song: YtAlbumSong): PlaylistSong => {
  const { track } = streamedLibraryFacts(db, song);
  return track === null ? { source: "stream", song } : { source: "library", trackId: track.id };
};

/** What the Library holds of [song]: its song (with a file or missing) and its star. */
const libraryFacts = (ports: StreamedSongPorts, song: YtAlbumSong) => {
  const { track, starred, hasFile } = streamedLibraryFacts(ports.db, song);
  // A missing song downloads into its Library entry; anything else as a new song.
  const jobId = track !== null && !hasFile ? missingSongJobId(track.id) : (song.videoId as string);
  const status =
    track !== null && !hasFile
      ? ports.downloads.status(track.id)
      : ports.downloads.ytStatus(song.videoId);
  return { track, starred, hasFile, jobId, status };
};

export const streamedSongMenu = (
  ports: StreamedSongPorts,
  song: YtAlbumSong,
  playing: boolean,
): StreamedSongMenu => {
  const { starred, hasFile, status } = libraryFacts(ports, song);
  const ytMusic = ports.ytMusic();
  const artists = streamedArtistLink(song.artists, {
    libraryArtist: libraryArtist(ports.db),
    enabled: ytMusic,
    here: "/",
  });
  const entries: StreamedEntry[] = [
    ...ytSongActions(artists, { favorite: starred, album: song.albumId, ytMusic, playing })
      .filter((entry) => OFFERED.has(entry.action))
      .map((entry): StreamedEntry => {
        if (entry.action === "goToAlbum") return { action: "goToAlbum", album: entry.album };
        if (entry.action !== "goToArtist")
          return {
            action: entry.action as StreamedRunAction | "magicQueue" | "releaseDate" | "share",
          };
        return { action: "goToArtist", artists: entry.artists };
      }),
    ...(hasFile ? [] : ytDownloadActions(status, { inLibrary: false })).map((action) => ({
      action,
    })),
  ];
  return {
    title: song.title,
    entries,
    favorite: starred,
    download: nowPlayingDownload(status, { hasFile }),
  };
};

export const runStreamedAction = async (
  ports: StreamedSongPorts,
  song: YtAlbumSong,
  action: StreamedRunAction,
  playlistId?: number,
): Promise<StreamedRunResult> => {
  const { db, downloads } = ports;
  const { track, hasFile, jobId, status } = libraryFacts(ports, song);
  /**
   * Asks for the song; [by] a star, taking the star back takes the download back too, or Add to
   * Playlist, whose toast is the only word of it.
   */
  const download = (by?: AskedBy) =>
    track !== null && !hasFile
      ? downloads.missing([track.id], by)
      : downloads.yt([song.videoId], by);
  switch (action) {
    case "playNext":
    case "addToQueue":
      await ports.queue(action, song.videoId);
      return { kind: "queued", count: 1 };
    case "favorite":
    case "unfavorite": {
      const on = action === "favorite";
      const now = Date.now();
      if (track !== null) setFavorites(db, [track.id], on, now);
      // Kept before its download is asked, so the file's landing finds it and stars the song.
      if (on && track === null) addPendingFavorites(db, [pendingFavorite(song)], now);
      if (!on) removePendingFavorites(db, [song.videoId]);
      ports.changed();
      if (on && !hasFile && status === null) await download("star");
      if (!on) await downloads.unstarred([jobId]);
      return { kind: "favorite", on, count: 1 };
    }
    case "addToPlaylist": {
      if (playlistId === undefined) throw new Error("No playlist to add to");
      refuseCollaborative(db, playlistId);
      const entry: PlaylistSong =
        track === null ? { source: "stream", song } : { source: "library", trackId: track.id };
      const result = addToPlaylist(db, playlistId, [entry], Date.now());
      ports.changed();
      // The desktop's playlists list the Library's songs: the song comes into the Library.
      if (!hasFile && status === null) await download("playlist");
      return {
        kind: "playlist",
        name: result.name,
        added: result.added,
        alreadyIn: result.alreadyIn,
      };
    }
    case "download":
      await download();
      return { kind: "downloaded", count: 1 };
    case "retryDownload":
      await downloads.retry([jobId]);
      return { kind: "downloaded", count: 1 };
    case "cancelDownload":
      await downloads.cancel([jobId]);
      return { kind: "downloaded", count: 0 };
  }
};
