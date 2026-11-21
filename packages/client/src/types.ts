import type { LibraryTrack, ExplicitFlag, TagGains, YtSong } from "@wave/core";
import type * as schema from "./db/schema.ts";
import type { PlaylistEntry } from "./db/playlists.ts";
import type { FavoriteRow } from "./db/playHistory.ts";
import type { GenreOpening } from "./db/genrePages.ts";
import type { SongOrder, SongSummary } from "./db/songOrder.ts";
/** An indexed file as a scan starts from it: what the native scan compares, and what tells a voice note. */
export interface IndexedKnownFile {
  readonly path: string;
  readonly sizeBytes: number;
  readonly modifiedAt: number;
  readonly durationMs: number;
  /** The artist credit; "Unknown Artist" without an artist tag. */
  readonly artist: string;
}

/** A track as the scanner reported it, after Core normalisation. */
export interface IndexedTrack extends LibraryTrack {
  readonly sizeBytes: number;
  readonly modifiedAt: number;
  readonly sampleRate: number | null;
  readonly bitrateKbps: number | null;
  readonly artworkHash: string | null;
  /** Lyrics in its tags or a sidecar `.lrc`. */
  readonly hasLyrics: boolean;
  /** What its advisory tag says (Core's `explicitFromAdvisory`). */
  readonly explicit: ExplicitFlag;
  /**
   * What its ReplayGain or R128 tags say, for Normalize Volume (Core's
   * `gainTags`); absent or null values: nothing.
   */
  readonly loudness?: TagGains;
  /**
   * Its ISRC tag (Core's `isrcFromTag`): DJ's moods look the song up by it. Absent or null:
   * none, and a save clears the one the Track had.
   */
  readonly isrc?: string | null;
  /**
   * The YouTube video id of a song just downloaded from YouTube Music. Saving
   * the file again without one (a rescan) keeps the one it has.
   */
  readonly videoId?: string | null;
  /**
   * The missing song a download of it was asked for (its Track id): the file
   * fills that Track in, keeping its recording key, whatever its tags say.
   */
  readonly fills?: number;
}

export interface IndexedArtwork {
  readonly hash: string;
  readonly path: string;
  readonly thumbPath: string;
  readonly palette: schema.ArtworkPalette;
}

export interface ScanRoot {
  readonly path: string;
  readonly isDefault: boolean;
  readonly lastScannedAt: number | null;
}

/** A scan root with the number of indexed tracks under it, for Music folders. */
export interface ScanRootSummary extends ScanRoot {
  readonly trackCount: number;
}

/** A song as Fix Songs on the whole Library sees it (Core's `songsToFix`). */
export interface LibraryLookupSong {
  readonly path: string;
  readonly title: string;
  readonly artist: string;
  readonly album: string;
  readonly durationMs: number;
  readonly genre: string | null;
  readonly hasLyrics: boolean;
  readonly trackNumber: number | null;
  readonly year: number | null;
  /** Unknown (never checked) counts as missing: Fix Song fills it in from Deezer. */
  readonly explicit: ExplicitFlag;
}

/** One row of the Songs list. */
export interface SongRow {
  readonly id: number;
  /**
   * The file; null for a missing song (a Track the Wave account has and this
   * phone has no file for), which lists show dimmed and nothing plays.
   */
  readonly path: string | null;
  readonly title: string;
  /** The credit as written ("Ariana Grande, Doja Cat"). */
  readonly artist: string;
  readonly album: string;
  readonly durationMs: number;
  readonly thumbPath: string | null;
  readonly artworkPath: string | null;
  /** Core sort key of the title (files the row on the A–Z spine). */
  readonly titleSort: string;
  /** Core sort keys of the artist and album, for sorting song lists. */
  readonly artistSort: string;
  readonly albumSort: string;
  /** When the file entered the library (epoch ms). */
  readonly addedAt: number;
  readonly albumId: number;
  /** The primary artist: the first one [artist] credits. */
  readonly artistId: number;
  /** Every artist [artist] credits, primary first: Go to Artist offers them. */
  readonly artistIds: readonly number[];
  /** Orders the album's tracks, and so sorts by artist and by album. */
  readonly discNumber: number | null;
  readonly trackNumber: number | null;
  /** Original-date tag, separate from the album Year fallback. */
  readonly releaseDate?: string | null | undefined;
  /** Fix Song fills it in when it's missing, as the track number, genre and lyrics. */
  readonly year: number | null;
  /** Null for a song without a genre tag. */
  readonly genre: string | null;
  /** Lyrics in the file's tags or in a sidecar `.lrc`. */
  readonly hasLyrics: boolean;
  /** Whether it's explicit, as its file's advisory tag says: rows show the E badge for it. */
  readonly explicit: ExplicitFlag;
}

/** A song that can play: one with a file (the queue's, Android Auto's). */
export type PlayableSongRow = SongRow & { readonly path: string };

/** Whether [song] has a file to play (it isn't a missing song). */
export const songHasFile = <S extends SongRow>(song: S): song is S & { readonly path: string } =>
  song.path !== null;

/** A track on an album screen, with what orders it there. */
export type AlbumTrackRow = SongRow;

export type { FavoriteRow, GenreOpening, SongOrder, SongSummary };

/** One album of the Albums grid (and of an artist's albums). */
export interface AlbumRow {
  readonly id: number;
  readonly title: string;
  readonly titleSort: string;
  /** The album artist credit as written; [albumArtistId] is the artist it is filed under. */
  readonly albumArtist: string;
  readonly albumArtistId: number;
  /** Every artist [albumArtist] credits, primary first: Go to Artist offers them. */
  readonly albumArtistIds: readonly number[];
  readonly year: number | null;
  readonly compilation: boolean;
  readonly trackCount: number;
  readonly durationMs: number;
  readonly thumbPath: string | null;
  readonly artworkPath: string | null;
}

/** One row of the Artists list: an individual artist, credited on songs or albums. */
export interface ArtistRow {
  readonly id: number;
  readonly name: string;
  readonly sort: string;
  /** Albums filed under the artist. */
  readonly albumCount: number;
  /** Songs credited to the artist, or on albums credited to them. */
  readonly trackCount: number;
  /**
   * The artist's image (an album cover, Core's `artistArtwork`): thumbnail for
   * rows, full size for the artist page; null for the initial placeholder.
   */
  readonly thumbPath: string | null;
  readonly artworkPath: string | null;
}

export interface GenreRow {
  readonly id: number;
  readonly name: string;
  readonly sort: string;
  readonly trackCount: number;
}

export interface AlbumDetail {
  readonly album: AlbumRow;
  /** The genre most of the album's tracks carry. */
  readonly genre: string | null;
  /** By disc, then track number (Core's `compareAlbumTracks`). */
  readonly tracks: readonly AlbumTrackRow[];
}

export interface ArtistDetail {
  readonly artist: ArtistRow;
  /** Filed under the artist, newest first. */
  readonly albums: readonly AlbumRow[];
  /** Other albums with songs by the artist (compilations…), newest first. */
  readonly appearsOn: readonly AlbumRow[];
  /** By title. */
  readonly songs: readonly SongRow[];
}

export interface GenreDetail {
  readonly genre: GenreRow;
  /** By title. */
  readonly songs: readonly SongRow[];
}

/** An indexed file found under a new path (see Core's `reconcileScan`). */
export interface PathMove {
  readonly from: string;
  readonly to: string;
}

/** What Now Playing shows about a track beyond the player's item. */
export interface TrackDetails {
  readonly id: number;
  readonly artistId: number;
  /** Every artist the credit names, primary first: the artist line offers them. */
  readonly artistIds: readonly number[];
  readonly artist: string;
  readonly albumId: number;
  readonly album: string;
  readonly palette: schema.ArtworkPalette | null;
  /** The audio file, for reading its lyrics. */
  readonly path: string;
}

/** One playlist of Library › Playlists. */
export interface PlaylistRow {
  readonly syncId?: string;
  readonly id: number;
  readonly name: string;
  /** Core sort key of the name. */
  readonly sort: string;
  /** When it was made, in ms since the epoch (Recently Added). */
  readonly createdAt: number;
  /** Newest readable live entry's added date, or null when empty (Add to Playlist). */
  readonly lastEntryAddedAt: number | null;
  readonly trackCount: number;
  readonly durationMs: number;
  /** Its unavailable entries (songs an import couldn't find), counted in [trackCount] too. */
  readonly unavailableCount: number;
  /**
   * Thumbnails of its artwork (Core's `playlistArtwork`): its own image alone,
   * else its mosaic (none, one or four covers). Every place that shows a
   * playlist's artwork reads these.
   */
  readonly thumbPaths: readonly string[];
  /** Full-size versions of the same, for the playlist screen's header. */
  readonly artworkPaths: readonly string[];
  /** Whether the owner gave it its own image (its menu then offers Remove Image). */
  readonly hasImage: boolean;
}

/**
 * One entry of a playlist, in its place (`itemId`; the same song may be in it
 * more than once): a Library song, or a YT Music song the Library doesn't
 * have, streamed (Core's `MixedSong`).
 */
export type PlaylistEntryRow = PlaylistEntry<SongRow>;

export interface PlaylistDetail {
  readonly playlist: PlaylistRow;
  /** In playlist order. */
  readonly items: readonly PlaylistEntryRow[];
}

/** What adding songs to a playlist did. */
export interface PlaylistAddResult {
  readonly playlistId: number;
  readonly name: string;
  readonly added: number;
  readonly alreadyIn: number;
}

/** The song captured by a render/gesture, even if playback moves on while it resolves. */
export interface PlayingSongTarget {
  readonly trackId: string;
  readonly song: YtSong | null;
}
export interface PlayingSongAnswer {
  readonly track: SongRow | null;
  readonly favorite: boolean;
  readonly pendingFavorite: boolean;
}
