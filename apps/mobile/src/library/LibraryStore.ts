import type { YtSong } from "@wave/core";
import { backfillRecordingTitles, selectMatchingSong } from "./db/matchingSong";
import { tastePlaysPage, tasteFavoritesPage, tasteDownloadsPage } from "./db/tastePages";
import { artistGraphSourcesChanged } from "@/home/graphSources";
import {
  mixCreditPage,
  mixPlaylistedPage,
  mixStreamedPage,
  mixSongsPage,
  mixArtistsPage,
  mixHistoryPage,
} from "./db/mixInputs";
import {
  mixCatalogPage,
  graphRadioPage,
  graphCatalogPage,
  graphSimilarPage,
  graphPlayPage,
  type GraphPage,
  type GraphPlayCursor,
} from "./db/artistGraph";
import type { ArtistGraphPlay } from "@wave/core";
import {
  acceptPlaylistRecommendation,
  dismissPlaylistRecommendation,
  selectPlaylistRecommendationInput,
  type PlaylistRecommendationInput,
} from "./db/playlistRecommendations";
import {
  filesLeavingWithRoot,
  rememberSearch,
  type ArtistFirstPlay,
  type BlackPlayerPlay,
  type BlackPlayerTrack,
  type ImportedPlays,
  type TasteHistory,
  type IndexedFile,
  type LibrarySongSort,
  type PlaylistSong,
  type LibraryTrack,
  type MissingTrack,
  type PendingFavorite,
  type CountedListening,
  type RecapSongGenre,
  type CreditedPlayTotals,
  type PlayEvent,
  type PlayTotals,
  type ListeningSums,
  type StatsWindow,
  type TryAgainAnswered,
  type UnsearchedSong,
  type YtAlbumSong,
  type YtArtistSaved,
  type ExplicitFlag,
  type SavedLyrics,
  type NoBetterCopy,
  type QualityDirection,
  type QualityFile,
  type ReplacedTrack,
  type MixPlaylistEntry,
  type StreamedSong,
  type DuplicateCheckFile,
  type CatalogPage,
  type CatalogSong,
  type PlaylistFindText,
  type PlaylistRecommendationSlot,
} from "@wave/core";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import { drizzle, type ExpoSQLiteDatabase } from "drizzle-orm/expo-sqlite";
import { migrate } from "drizzle-orm/expo-sqlite/migrator";
import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import { openDatabaseSync } from "expo-sqlite";

import { timeLibraryRead } from "@/log/slowLibraryReads";
import type { NativeYtSong } from "@/native/waveYtMusic";
import { syncCycle, type SyncCycleInput, type SyncCycleResult } from "@/sync/syncCycle";

import { selectAlbumDetail, selectAlbums } from "./db/albums";
import { importedPlays, saveImportedPlays, selectImportTracks } from "./db/blackPlayer";
import {
  selectArtistCovers,
  selectArtistDetail,
  selectArtistSongs,
  selectArtists,
  selectArtistNamesForLink,
} from "./db/artists";
import {
  clearArtistPhotos,
  recordArtistPhoto,
  selectArtistPhotoLookups,
  selectArtistPhotos,
  type ArtistPhotoLookup,
  type ArtistPhotoRecord,
  type ArtistPhotoRow,
} from "./db/artistPhotos";
import {
  libraryCounts,
  libraryScale,
  sectionSongCounts,
  type LibraryCounts,
  type LibraryScale,
} from "./db/counts";
import { creditSplits, relinkCreditsIfUnlinked, type CreditSplits } from "./db/credits";
import { selectGenreSongs } from "./db/genres";
import type { RowPage } from "./db/database";
import migrations from "./db/migrations";
import { selectLinkRows, type LinkIds, type LinkRows } from "./db/links";
import {
  homeAdded,
  homeFavorites,
  homePlays,
  homeSections,
  latestPlay,
  listFavorites,
  playedRecordingKeys,
  recordPlay,
  selectFavoriteTrackIds,
  setFavorites,
  updatePlay,
  endPlay,
  type FavoriteRow,
  type HomePlays,
  type HomeSections,
  type RecordedPlay,
} from "./db/playHistory";
import { listeningSums } from "./db/playTotals";
import { tasteHistory } from "./db/taste";
import {
  removePlaylistImage,
  selectPlaylistImageOriginal,
  setPlaylistImage,
  takeDeletedPlaylistImages,
  type PlaylistImageFiles,
  type PlaylistImageOriginal,
} from "./db/playlistImages";
import {
  addToPlaylist,
  createPlaylist,
  deletePlaylist,
  linkPlaylistEntries,
  movePlaylistItem,
  removePlaylistItems,
  restorePlaylistItems,
  type PlaylistRemoval,
  renamePlaylist,
  replacePlaylistSongs,
  selectPlaylist,
  selectPlaylistEntries,
  selectPlaylistEntriesRevision,
  selectPlaylists,
  selectPlaylistsLastPlayed,
  selectTrackPaths,
  selectUnsearchedEntries,
  settleTryAgain,
  settleUnsearchedEntries,
  type PlaylistEntry,
  type PlaylistUnsearched,
  type UnsearchedEntriesSettled,
} from "./db/playlists";
import {
  addPendingFavorites,
  removePendingFavorites,
  selectPendingFavorites,
} from "./db/pendingFavorites";
import { forgetSavedLyrics, keepSavedLyrics, selectSavedLyrics } from "./db/savedLyrics";
import {
  rememberNoBetterCopies,
  replaceTrackFile,
  selectNoBetterCopies,
  selectQualityFiles,
  selectReplacedTrack,
  type ReplacedFile,
} from "./db/qualityReplacement";
import { forgetFileDeletions, pendingFileDeletions, recordFileDeletions } from "./db/fileDeletions";
import {
  fixReplacementDuplicate,
  selectDuplicateCheckFiles,
  type DuplicateFixToApply,
} from "./db/replacementDuplicates";
import { keepLyricsMiss, selectLyricsSearchTrack, type LyricsSearchTrack } from "./db/lyricsMisses";
import {
  noteStreamedSong,
  selectKnownVideos,
  selectPlaylistedSongs,
  selectStreamedSongs,
} from "./db/mixKnown";
import { addCandidates, selectCandidateCatalog } from "./db/candidateCatalog";
import { hasUnscannedRoot, pruneOrphans, saveBatch, type SavedBatch } from "./db/save";
import * as schema from "./db/schema";
import {
  BY_TITLE,
  filePath,
  hasFile,
  selectKnownFiles,
  selectLibraryLookupSongs,
  trackArtistIds,
  selectPlayableSongs,
  hasPlayableSongOutside,
  selectSongGenres,
  selectVideoIds,
  trackQuery,
  type SongGenres,
  type TrackScope,
  withFile,
} from "./db/tracks";
import {
  artistFirstPlays,
  artistPlays,
  countedListening,
  creditedPlayTotals,
  songGenres,
  trackPlayTotals,
  type ArtistPlays,
} from "./db/stats";
import { keyRecordings, stampPreference } from "./db/sync";
import {
  filesGone,
  leaveFiles,
  removeSongs,
  selectAlbumsMissingSongs,
  selectMissingSongs,
  signOut,
} from "./db/missingSongs";
import {
  saveYtArtist,
  selectYtArtist,
  selectYtArtistSimilar,
  type YtArtistSimilar,
} from "./db/ytArtists";
import {
  selectSongFindTexts,
  selectSongOrder,
  selectSongSummaries,
  selectSongsWithIds,
  type SongOrder,
  type SongSummary,
} from "./db/songOrder";
import type { KnownFile } from "./NativeScanner";

const DATABASE_NAME = "wave.db";

export class LibraryStoreError extends Data.TaggedError("LibraryStoreError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {
  override get message(): string {
    return `Library store failed to ${this.operation}: ${String(this.cause)}`;
  }
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

export type { FavoriteRow, SongOrder, SongSummary };

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

/** The queue and position saved for the next launch. */
export interface SavedPlayback {
  /** Core's `QueueState` as JSON. */
  readonly queue: string;
  readonly positionMs: number;
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
  readonly id: number;
  readonly name: string;
  /** Core sort key of the name. */
  readonly sort: string;
  /** When it was made, in ms since the epoch (Recently Added). */
  readonly createdAt: number;
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

export class LibraryStore extends Context.Service<
  LibraryStore,
  {
    /** Adds [path] as a scan root when there are no roots yet; returns the roots. */
    readonly ensureDefaultRoot: (
      path: string,
    ) => Effect.Effect<readonly ScanRoot[], LibraryStoreError>;
    /** Every scan root in the order it was added, with its track count. */
    readonly listRoots: Effect.Effect<readonly ScanRootSummary[], LibraryStoreError>;
    /**
     * Adds [path] as a root the owner picked and removes the roots in [drop]
     * (see Core's `planAddRoot`). No root is a default one afterwards.
     */
    readonly addRoot: (
      path: string,
      drop: readonly string[],
    ) => Effect.Effect<void, LibraryStoreError>;
    /**
     * Removes a root and the tracks no other root covers (signed in to a Wave
     * account, they stay as missing songs: `leaveFiles`), then the albums,
     * artists, genres and folders left without tracks. The last root can't be removed.
     */
    readonly removeRoot: (path: string) => Effect.Effect<void, LibraryStoreError>;
    readonly excludedFolders: Effect.Effect<readonly string[], LibraryStoreError>;
    /**
     * Upserts one scanner batch (and the artwork it references) in a single
     * transaction. [moves] first re-point indexed tracks to the paths they were
     * found under, so they keep their id (and with it history and favorites).
     * Playlists' YT Music entries the saved tracks are become them, unless
     * [linkEntries] is false (a scan's batches: `linkPlaylistEntries` once it ends).
     * The saved tracks that are pending favorites get their star
     * (`SavedBatch.starred`; `showSavedStars` shows them).
     */
    readonly saveBatch: (
      tracks: readonly IndexedTrack[],
      artwork: readonly IndexedArtwork[],
      moves?: readonly PathMove[],
      options?: { readonly linkEntries?: boolean },
    ) => Effect.Effect<SavedBatch, LibraryStoreError>;
    /**
     * Turns playlists' YT Music entries the Library now has into its songs, in
     * the same place, matched against the whole Library; a scan runs it once
     * when it ends. Returns how many entries it changed.
     */
    readonly linkPlaylistEntries: Effect.Effect<number, LibraryStoreError>;
    /** Rises whenever playlists' entries are written: whether a link has new entries to see. */
    readonly playlistEntriesRevision: Effect.Effect<number, LibraryStoreError>;
    /** Whether one of [roots] has never finished a scan (Core's `scanEnd` `firstScan`). */
    readonly hasUnscannedRoot: (
      roots: readonly string[],
    ) => Effect.Effect<boolean, LibraryStoreError>;
    readonly markScanned: (
      roots: readonly string[],
      at: number,
    ) => Effect.Effect<void, LibraryStoreError>;
    readonly countTracks: Effect.Effect<number, LibraryStoreError>;
    /** How many items each Library entry holds, for the Library tab. */
    readonly countLibrary: Effect.Effect<LibraryCounts, LibraryStoreError>;
    /** How many songs each Library entry's menu acts on, for its heading. */
    readonly countSectionSongs: Effect.Effect<LibraryCounts, LibraryStoreError>;
    /** How big the Library is, for a perf build's run metadata (docs/performance/README.md). */
    readonly measureScale: Effect.Effect<LibraryScale, LibraryStoreError>;
    /** Every track ordered by title, for Library › Songs. */
    readonly playlistRecommendationInput: (
      id: number,
    ) => Effect.Effect<PlaylistRecommendationInput, LibraryStoreError>;
    readonly dismissPlaylistRecommendation: (
      id: number,
      offer: PlaylistRecommendationSlot,
    ) => Effect.Effect<boolean, LibraryStoreError>;
    readonly acceptPlaylistRecommendation: (
      id: number,
      offer: PlaylistRecommendationSlot,
    ) => Effect.Effect<boolean, LibraryStoreError>;
    /** The streamed recording's Library row, including missing songs, without a Library read. */
    readonly matchingSong: (song: YtSong) => Effect.Effect<SongRow | null, LibraryStoreError>;
    readonly listSongs: Effect.Effect<readonly SongRow[], LibraryStoreError>;
    /**
     * Library › Songs in [sort] as Track ids, with its A–Z spine and its
     * missing songs, without the rows' details (`songSummaries` reads those
     * for the rows on screen).
     */
    readonly listSongOrder: (sort: LibrarySongSort) => Effect.Effect<SongOrder, LibraryStoreError>;
    /** What finds each Library song by id (its title, artist and album), for Find in Songs. */
    readonly songFindTexts: Effect.Effect<ReadonlyMap<number, PlaylistFindText>, LibraryStoreError>;
    /** What the Songs list's rows of [ids] show, in that order; ids gone are left out. */
    readonly songSummaries: (
      ids: readonly number[],
    ) => Effect.Effect<readonly SongSummary[], LibraryStoreError>;
    /**
     * The full song rows of [ids], missing songs included, in that order, for
     * what acts on them (a menu, a selection); ids gone are left out.
     */
    readonly songsWithIds: (
      ids: readonly number[],
    ) => Effect.Effect<readonly SongRow[], LibraryStoreError>;
    /**
     * Every song with what a lyrics and genre lookup sends, its genre and
     * whether it has lyrics, for the whole-Library run.
     */
    readonly listLibraryLookupSongs: Effect.Effect<readonly LibraryLookupSong[], LibraryStoreError>;
    /**
     * The songs whose genre tag has several values, with every value (the
     * Library files them under the first): what Genre mixes count.
     */
    readonly listSongGenres: Effect.Effect<readonly SongGenres[], LibraryStoreError>;
    /** Every album by title, then album artist, for Library › Albums. */
    readonly listAlbums: Effect.Effect<readonly AlbumRow[], LibraryStoreError>;
    /**
     * [page] of the albums with a file in the same order, for lists that page
     * (Auto, which leaves missing songs out).
     */
    readonly listAlbumsPage: (
      page: RowPage,
    ) => Effect.Effect<readonly AlbumRow[], LibraryStoreError>;
    /** Bounded name page, used only by an artist-link gesture. */
    readonly artistNamesForLink: (
      after: { readonly sort: string; readonly id: number } | null,
    ) => Effect.Effect<readonly { id: number; name: string; sort: string }[], LibraryStoreError>;
    /** Every artist with songs, by name, for Library › Artists. */
    readonly listArtists: Effect.Effect<readonly ArtistRow[], LibraryStoreError>;
    /** [page] of the artists with a file in the same order, for lists that page (Auto). */
    readonly listArtistsPage: (
      page: RowPage,
    ) => Effect.Effect<readonly ArtistRow[], LibraryStoreError>;
    /** [page] of an artist's songs with a file, in their screen's order (by title), for Auto. */
    readonly listArtistSongsPage: (
      id: number,
      page: RowPage,
    ) => Effect.Effect<readonly SongRow[], LibraryStoreError>;
    /**
     * [page] of a playlist's entries, in playlist order, for Auto: its YT
     * Music entries and its Library songs with a file.
     */
    readonly listPlaylistEntriesPage: (
      id: number,
      page: RowPage,
    ) => Effect.Effect<readonly PlaylistEntryRow[], LibraryStoreError>;
    /** A cover for each of [ids] that has one (an album or song of theirs), for Auto. */
    readonly artistCovers: (
      ids: readonly number[],
    ) => Effect.Effect<ReadonlyMap<number, string>, LibraryStoreError>;
    /** Every genre with songs, by name, for Library › Genres. */
    readonly listGenres: Effect.Effect<readonly GenreRow[], LibraryStoreError>;
    /**
     * An album and its tracks in [scope] (missing songs included unless
     * "files"), or null when it has none.
     */
    readonly getAlbum: (
      id: number,
      scope?: TrackScope,
    ) => Effect.Effect<AlbumDetail | null, LibraryStoreError>;
    /** An artist's page, of their songs in [scope]; null when they have none. */
    readonly getArtist: (
      id: number,
      scope?: TrackScope,
    ) => Effect.Effect<ArtistDetail | null, LibraryStoreError>;
    readonly getGenre: (id: number) => Effect.Effect<GenreDetail | null, LibraryStoreError>;

    /** The indexed files under [roots], for an incremental scan to skip the unchanged ones. */
    readonly knownFiles: (
      roots: readonly string[],
    ) => Effect.Effect<readonly KnownFile[], LibraryStoreError>;
    /** What identifies the indexed files at [paths] when they turn up elsewhere. */
    readonly indexedFiles: (
      paths: readonly string[],
    ) => Effect.Effect<readonly IndexedFile[], LibraryStoreError>;
    /**
     * The files at [paths] are gone (a scan no longer found them): signed in
     * to a Wave account their songs stay as missing songs, signed out they
     * leave the Library. Then the albums, artists, genres and folders left
     * without tracks go (also after tag changes, so call it once per scan).
     */
    readonly filesGone: (paths: readonly string[]) => Effect.Effect<void, LibraryStoreError>;
    /**
     * Takes these songs out of the Library and, signed in, out of the Wave
     * account (Remove from Library; Delete once their files are gone).
     */
    readonly removeSongs: (trackIds: readonly number[]) => Effect.Effect<void, LibraryStoreError>;
    /**
     * The missing songs as downloading them takes them, in title order; with
     * [trackIds], only those still missing of them.
     */
    readonly missingSongs: (
      trackIds?: readonly number[],
    ) => Effect.Effect<readonly MissingTrack[], LibraryStoreError>;
    /** Each album of [albumIds]'s missing songs, as Track ids in album order. */
    readonly albumsMissingSongs: (
      albumIds: readonly number[],
    ) => Effect.Effect<readonly (readonly number[])[], LibraryStoreError>;
    /** Excludes [path] and drops the exclusions in [drop] (see Core's `planExclusion`). */
    readonly addExcludedFolder: (
      path: string,
      drop: readonly string[],
    ) => Effect.Effect<void, LibraryStoreError>;
    readonly removeExcludedFolder: (path: string) => Effect.Effect<void, LibraryStoreError>;
    /**
     * The songs with these ids that can play, for the queue, in no particular
     * order; ids no longer indexed, and missing songs, are left out.
     */
    /** Whether a short Home row has another playable song to fill it (one id at most). */
    readonly hasPlayableSongOutside: (
      ids: readonly number[],
    ) => Effect.Effect<boolean, LibraryStoreError>;
    readonly songsByIds: (
      ids: readonly number[],
    ) => Effect.Effect<readonly PlayableSongRow[], LibraryStoreError>;
    /** The YouTube video id each of the songs [ids] was downloaded from, by song id (those with one). */
    readonly videoIds: (
      ids: readonly number[],
    ) => Effect.Effect<ReadonlyMap<number, string>, LibraryStoreError>;
    readonly loadPlayback: Effect.Effect<SavedPlayback | null, LibraryStoreError>;
    /** Saves the queue with where its current entry is. */
    readonly saveQueue: (
      queue: string,
      positionMs: number,
    ) => Effect.Effect<void, LibraryStoreError>;
    readonly savePosition: (positionMs: number) => Effect.Effect<void, LibraryStoreError>;
    /** The playing track's links and artwork palette, for Now Playing; null once it's gone. */
    readonly trackDetails: (id: number) => Effect.Effect<TrackDetails | null, LibraryStoreError>;
    /** The recent searches, newest first. */
    readonly listRecentSearches: Effect.Effect<readonly string[], LibraryStoreError>;
    /** Adds a search to the recent ones (see Core's `rememberSearch`); returns them, newest first. */
    readonly rememberSearch: (query: string) => Effect.Effect<readonly string[], LibraryStoreError>;
    readonly clearRecentSearches: Effect.Effect<void, LibraryStoreError>;
    /** Every playlist by name, with its mosaic. */
    readonly listPlaylists: Effect.Effect<readonly PlaylistRow[], LibraryStoreError>;
    /** When a song last played from each playlist, by playlist id (never played: absent). */
    readonly playlistsLastPlayed: Effect.Effect<ReadonlyMap<number, number>, LibraryStoreError>;
    /** Every playlist's unsearched songs, top to bottom, for the background fill. */
    readonly unsearchedEntries: Effect.Effect<readonly PlaylistUnsearched[], LibraryStoreError>;
    /** A playlist with its YT Music entries and its Library songs in [scope]. */
    readonly getPlaylist: (
      id: number,
      scope?: TrackScope,
    ) => Effect.Effect<PlaylistDetail | null, LibraryStoreError>;
    /**
     * Creates a playlist holding [songs], Library tracks and YT Music songs in
     * the order given (Core's `checkPlaylistName` must accept the name, or it
     * fails).
     */
    readonly createPlaylist: (
      name: string,
      songs: readonly PlaylistSong[],
    ) => Effect.Effect<PlaylistAddResult, LibraryStoreError>;
    readonly renamePlaylist: (id: number, name: string) => Effect.Effect<void, LibraryStoreError>;
    readonly deletePlaylist: (id: number) => Effect.Effect<void, LibraryStoreError>;
    /**
     * Gives a playlist its own image (it stays on this phone); returns the
     * files nothing shows or keeps any more: its old image's (but an original
     * [files] keeps), or [files] when it's gone.
     */
    readonly setPlaylistImage: (
      id: number,
      files: PlaylistImageFiles,
    ) => Effect.Effect<readonly string[], LibraryStoreError>;
    /** The original photo and last framing Adjust Image reframes; null without an image. */
    readonly playlistImageOriginal: (
      id: number,
    ) => Effect.Effect<PlaylistImageOriginal | null, LibraryStoreError>;
    /** Brings a playlist's mosaic back; returns its image's files (original too) to delete. */
    readonly removePlaylistImage: (
      id: number,
    ) => Effect.Effect<readonly string[], LibraryStoreError>;
    /** Deleted playlists' image files, returned once to delete. */
    readonly takeDeletedPlaylistImages: Effect.Effect<readonly string[], LibraryStoreError>;
    /** Appends the songs the playlist doesn't have yet (Core's `planPlaylistSongs`). */
    readonly addToPlaylist: (
      id: number,
      songs: readonly PlaylistSong[],
    ) => Effect.Effect<PlaylistAddResult, LibraryStoreError>;
    /** Moves an item to [toIndex] (0-based) in its playlist. */
    readonly movePlaylistItem: (
      playlistId: number,
      itemId: number,
      toIndex: number,
    ) => Effect.Effect<void, LibraryStoreError>;
    /** Removes these entries from the playlist (other copies of the same songs stay). */
    readonly removePlaylistItems: (
      playlistId: number,
      itemIds: readonly number[],
    ) => Effect.Effect<PlaylistRemoval, LibraryStoreError>;
    /** Undo a removal, keeping the original entries and their order. */
    readonly restorePlaylistItems: (
      removal: PlaylistRemoval,
    ) => Effect.Effect<void, LibraryStoreError>;
    /**
     * Settles what Try Again found of the playlist's unavailable entries: each
     * found becomes its YT Music song in its place (Core's `tryAgainSettles`).
     * Returns how many were found and how many searches failed.
     */
    readonly settleTryAgain: (
      playlistId: number,
      answered: readonly TryAgainAnswered<YtAlbumSong>[],
    ) => Effect.Effect<{ readonly found: number; readonly failed: number }, LibraryStoreError>;
    /**
     * Settles the unsearched song [song] as [becomes] (found, a YT Music
     * song; not found, unavailable) in every playlist holding it (Core's
     * `unsearchedSettles`).
     */
    readonly settleUnsearched: (
      song: UnsearchedSong,
      becomes: PlaylistSong,
    ) => Effect.Effect<UnsearchedEntriesSettled, LibraryStoreError>;
    /** Makes the playlist hold exactly [songs], in that order (an import's Replace). */
    readonly replacePlaylistSongs: (
      playlistId: number,
      songs: readonly PlaylistSong[],
    ) => Effect.Effect<void, LibraryStoreError>;
    /** Every track's id and file path, for matching an imported playlist's entries. */
    readonly trackPaths: Effect.Effect<
      readonly { readonly id: number; readonly path: string }[],
      LibraryStoreError
    >;
    /** Every track with what a BlackPlayer stats import matches its rows by. */
    readonly importTracks: Effect.Effect<readonly BlackPlayerTrack<number>[], LibraryStoreError>;
    /** Each track's BlackPlayer plays already in the history, in no order. */
    readonly importedPlays: Effect.Effect<readonly ImportedPlays<number>[], LibraryStoreError>;
    /** Adds plays imported from BlackPlayer to the history: counted, and marked as imported. */
    readonly saveImportedPlays: (
      plays: readonly BlackPlayerPlay<number>[],
    ) => Effect.Effect<void, LibraryStoreError>;
    /** The recording key of every song ever played (Core's `recordingKey`), files gone or not. */
    readonly playedRecordingKeys: Effect.Effect<readonly string[], LibraryStoreError>;
    /** The plays, stars and downloads Core's taste profile is derived from (`db/taste.ts`). */
    readonly tasteHistory: Effect.Effect<TasteHistory, LibraryStoreError>;
    /** The ids of every starred track. */
    readonly favoriteTrackIds: Effect.Effect<readonly number[], LibraryStoreError>;
    /** Stars (or unstars) the tracks; those starred already keep when they were starred. */
    readonly setFavorites: (
      trackIds: readonly number[],
      on: boolean,
    ) => Effect.Effect<void, LibraryStoreError>;
    /** Starred tracks, most recently starred first, for Library › Favorites. */
    readonly listFavorites: Effect.Effect<readonly FavoriteRow[], LibraryStoreError>;
    /**
     * Keeps liked songs the Library hasn't as pending favorites (Core's
     * `PendingFavorite`), each starred once a download or scan brings it in
     * (`saveBatch`). This phone only.
     */
    readonly addPendingFavorites: (
      songs: readonly PendingFavorite[],
    ) => Effect.Effect<void, LibraryStoreError>;
    /** Every pending favorite kept, starred songs waiting for their files. */
    readonly listPendingFavorites: Effect.Effect<readonly PendingFavorite[], LibraryStoreError>;
    /** Forgets the pending favorites of videos [videoIds]: unstarred before their files arrived. */
    readonly removePendingFavorites: (
      videoIds: readonly string[],
    ) => Effect.Effect<void, LibraryStoreError>;
    /** Every Library file with its length, bitrate and size (Core's `qualityUpgradeSongs` weighs them). */
    readonly qualityFiles: Effect.Effect<readonly QualityFile[], LibraryStoreError>;
    /** The Tracks recorded as having no better copy in [direction]. This phone only. */
    readonly noBetterCopies: (
      direction: QualityDirection,
    ) => Effect.Effect<readonly number[], LibraryStoreError>;
    /** Records songs as having no better copy (Core's `noBetterCopies`), each once. */
    readonly rememberNoBetterCopies: (
      songs: readonly NoBetterCopy[],
    ) => Effect.Effect<void, LibraryStoreError>;
    /** Library song [trackId] as its replacement takes it; null when gone or without a file. */
    readonly replacedTrack: (
      trackId: number,
    ) => Effect.Effect<ReplacedTrack | null, LibraryStoreError>;
    /**
     * A replacement's new file takes over Track [trackId] in place, keeping its id, favorites,
     * plays, playlist entries and recording key; "gone" when the Track was removed meanwhile.
     */
    readonly replaceTrackFile: (
      trackId: number,
      track: IndexedTrack,
      artworkRows: readonly IndexedArtwork[],
    ) => Effect.Effect<ReplacedFile, LibraryStoreError>;
    /**
     * Records that the files [paths] must go (`schema.fileDeletions`); the app's
     * `finishFileDeletions` deletes them. The swap records its old file itself.
     */
    readonly recordFileDeletions: (
      paths: readonly string[],
    ) => Effect.Effect<void, LibraryStoreError>;
    /** The files still recorded for deletion, oldest first; a file a Track holds is dropped from them. */
    readonly pendingFileDeletions: Effect.Effect<readonly string[], LibraryStoreError>;
    /** Clears the records of the files [paths]: deleted, or missing. */
    readonly forgetFileDeletions: (
      paths: readonly string[],
    ) => Effect.Effect<void, LibraryStoreError>;
    /** The MP3 and M4A files the check for songs a replacement left twice pairs (Core's `replacementDuplicates`). */
    readonly duplicateCheckFiles: Effect.Effect<readonly DuplicateCheckFile[], LibraryStoreError>;
    /**
     * Puts a song a replacement left twice back to one (`fixReplacementDuplicate`): the second
     * Track hands its history to the kept one and goes, the other file's deletion is recorded.
     * False when the Library changed meanwhile.
     */
    readonly fixReplacementDuplicate: (
      fix: DuplicateFixToApply,
    ) => Effect.Effect<boolean, LibraryStoreError>;
    /** Records a play as it starts (Core's `PlayEvent`); returns its id, to update it as it goes on. */
    readonly recordPlay: (
      play: PlayEvent,
      overlapping?: boolean,
    ) => Effect.Effect<number, LibraryStoreError>;
    /** Brings a recorded play up to date: listened time, how it ended (so far), counted. */
    readonly updatePlay: (id: number, play: PlayEvent) => Effect.Effect<void, LibraryStoreError>;
    /** Records how a play ended; it no longer changes, so it can go to the Wave account. */
    readonly endPlay: (id: number, play: PlayEvent) => Effect.Effect<void, LibraryStoreError>;
    /**
     * The Home tab: Recently Added, Recently Played, Most Played and
     * Favorites, of the songs in [scope] (Auto's: those with a file).
     */
    readonly home: (scope?: TrackScope) => Effect.Effect<HomeSections, LibraryStoreError>;
    /** Home's Recently Added: only songs entering or leaving the library change it. */
    readonly homeAdded: Effect.Effect<Pick<HomeSections, "recentlyAdded">, LibraryStoreError>;
    /** Home's Recently Played and Most Played, from the all-time play totals (`play_totals`). */
    readonly homePlays: Effect.Effect<HomePlays, LibraryStoreError>;
    /** Home's Favorites: stars change it. */
    readonly homeFavorites: Effect.Effect<Pick<HomeSections, "favorites">, LibraryStoreError>;
    /** The play recorded last, to pick back up when JS restarts while the player kept going. */
    readonly latestPlay: Effect.Effect<RecordedPlay | null, LibraryStoreError>;
    /**
     * Each track's counted plays within [window] (tracks still in the library),
     * in no order; with [trackIds], only those tracks'.
     */
    readonly trackPlayTotals: (
      window: StatsWindow,
      trackIds?: readonly number[],
    ) => Effect.Effect<readonly PlayTotals[], LibraryStoreError>;
    /**
     * Counted plays within [window] per album and credited artist (deleted
     * songs included; a collaboration in a row for each artist it credits), in
     * no order; Core's `albumPlayTotals` / `artistPlayTotals` group them.
     */
    readonly creditedPlayTotals: (
      window: StatsWindow,
    ) => Effect.Effect<readonly CreditedPlayTotals[], LibraryStoreError>;
    /** The albums with these ids, in no particular order; albums no longer in the library are left out. */
    readonly albumsByIds: (
      ids: readonly number[],
    ) => Effect.Effect<readonly AlbumRow[], LibraryStoreError>;
    /** The artists with these ids, in no particular order; artists without songs are left out. */
    readonly artistsByIds: (
      ids: readonly number[],
    ) => Effect.Effect<readonly ArtistRow[], LibraryStoreError>;
    /** The album and artist rows behind links to them, read ahead of a tap (`db/links.ts`). */
    readonly linkRows: (ids: LinkIds) => Effect.Effect<LinkRows, LibraryStoreError>;
    /**
     * The whole history's listening summed in one row, from the all-time play
     * totals (`play_totals`); Core's `summedListeningTotals` reads it.
     */
    readonly listeningSums: Effect.Effect<ListeningSums, LibraryStoreError>;
    /**
     * The whole history's counted listening, summed per quarter hour (deleted
     * songs included): what Core's `availableRecaps` and `recap` read.
     */
    readonly countedListening: Effect.Effect<readonly CountedListening[], LibraryStoreError>;
    /** The genre tags of these songs still in the library, in no order (Core's `recap` reads them). */
    readonly songGenres: (
      ids: readonly number[],
    ) => Effect.Effect<readonly RecapSongGenre[], LibraryStoreError>;
    /**
     * When each of these artists had their first counted play ever, deleted
     * songs included, in no order; artists never played are left out.
     */
    readonly artistFirstPlays: (
      ids: readonly number[],
    ) => Effect.Effect<readonly ArtistFirstPlay[], LibraryStoreError>;
    /**
     * What [artistId]'s page needs for its stats block (Core's `artistStats`),
     * read from that artist's songs and their plays alone: the songs in the
     * library whose credit names them, those songs' all-time listening
     * (deleted songs included) and their counted plays up to [now].
     */
    readonly artistPlays: (
      artistId: number,
      now: number,
    ) => Effect.Effect<ArtistPlays, LibraryStoreError>;
    /** The artists whose photo is due for a lookup now (Core's `artistPhotoLookups`). */
    readonly artistPhotoLookups: Effect.Effect<readonly ArtistPhotoLookup[], LibraryStoreError>;
    /** Records how an artist's photo lookup went, by artist key. */
    readonly recordArtistPhoto: (
      artistKey: string,
      record: ArtistPhotoRecord,
    ) => Effect.Effect<void, LibraryStoreError>;
    /** Every downloaded artist photo. */
    readonly listArtistPhotos: Effect.Effect<readonly ArtistPhotoRow[], LibraryStoreError>;
    /** Forgets every artist photo and miss (the files are deleted by the caller). */
    readonly clearArtistPhotos: Effect.Effect<void, LibraryStoreError>;
    /** What YouTube Music last answered for an artist's page section, by artist key; null for nothing. */
    readonly ytArtist: (
      artistKey: string,
    ) => Effect.Effect<YtArtistSaved<NativeYtSong> | null, LibraryStoreError>;
    /** Saves YouTube Music's answer for an artist's page section, replacing the last one. */
    readonly saveYtArtist: (
      artistKey: string,
      saved: YtArtistSaved<NativeYtSong>,
    ) => Effect.Effect<void, LibraryStoreError>;
    /** Records that the owner changed the synced preference [key] on this phone, now. */
    readonly stampPreference: (key: string) => Effect.Effect<void, LibraryStoreError>;
    /**
     * Syncs the Library with the Wave account signed in (`syncCycle`): pulls,
     * pushes what changed here, and pulls again after a push. Fails where a
     * request failed; what was done by then stays done.
     */
    readonly syncWithAccount: (
      input: Omit<SyncCycleInput, "db" | "splits">,
    ) => Effect.Effect<SyncCycleResult, LibraryStoreError>;
    /**
     * Signed out: the Library leaves the account (the next sign-in joins
     * anew) and its missing songs go (`signOut`).
     */
    readonly leaveAccount: Effect.Effect<void, LibraryStoreError>;
    /**
     * What the Lyrics view saved for a non-D song's video (Core's
     * `SavedLyrics`): lyrics it found online, or a miss; null for nothing.
     */
    readonly savedLyrics: (videoId: string) => Effect.Effect<SavedLyrics | null, LibraryStoreError>;
    /** Saves [saved] for [videoId], replacing what was saved before. This phone only. */
    readonly keepSavedLyrics: (
      videoId: string,
      saved: SavedLyrics,
    ) => Effect.Effect<void, LibraryStoreError>;
    /** Drops what was saved for [videoIds] (their lyrics are in a file now). */
    readonly forgetSavedLyrics: (
      videoIds: readonly string[],
    ) => Effect.Effect<void, LibraryStoreError>;
    /**
     * What the Lyrics view's online search for the Library track [trackId]
     * goes by, and when it last found nothing; null for no such track.
     */
    readonly lyricsSearchTrack: (
      trackId: number,
    ) => Effect.Effect<LyricsSearchTrack | null, LibraryStoreError>;
    /** Remembers that the search for [trackId] found nothing at [checkedAt]; null forgets it. This phone only. */
    readonly keepLyricsMiss: (
      trackId: number,
      checkedAt: number | null,
    ) => Effect.Effect<void, LibraryStoreError>;
    /**
     * Notes that the owner started streaming [song] at [at] (streamed plays
     * aren't play history; Home's mixes read them). This phone only.
     */
    readonly noteStreamedSong: (
      song: YtAlbumSong,
      at: number,
    ) => Effect.Effect<void, LibraryStoreError>;
    /** Every YT Music song the owner streamed, with how often and when first. */
    readonly streamedSongs: Effect.Effect<readonly StreamedSong[], LibraryStoreError>;
    /** The playlists' entries that aren't Library songs, with when each was added (Home's mixes). */
    readonly playlistedSongs: Effect.Effect<readonly MixPlaylistEntry[], LibraryStoreError>;
    /**
     * The videos of the songs streamed, in a playlist, or downloaded and
     * played or in a playlist: a mix's re-blend leaves its new songs among
     * them out (Core's `discoverMixKeep`).
     */
    readonly knownVideos: Effect.Effect<readonly string[], LibraryStoreError>;
    /**
     * Adds what a radio or an artist page brought at [at] to the candidate
     * catalog (Core's `catalogSeen`), and takes out what leaves
     * (`catalogLeaving`). This phone only.
     */
    readonly addCandidates: (
      page: CatalogPage,
      at: number,
    ) => Effect.Effect<void, LibraryStoreError>;
    /** The candidate catalog: every song with the radios that brought it. */
    /** ti-compatible taste projections for the subsequent #593 source migration. */
    readonly tastePlaysPage: (
      after: GraphPlayCursor,
    ) => Effect.Effect<ReturnType<typeof tastePlaysPage>, LibraryStoreError>;
    readonly tasteFavoritesPage: (
      after: number,
    ) => Effect.Effect<ReturnType<typeof tasteFavoritesPage>, LibraryStoreError>;
    readonly tasteDownloadsPage: (
      after: number,
    ) => Effect.Effect<ReturnType<typeof tasteDownloadsPage>, LibraryStoreError>;
    readonly mixStreamedPage: (
      after: number,
    ) => Effect.Effect<ReturnType<typeof mixStreamedPage>, LibraryStoreError>;
    readonly mixPlaylistedPage: (
      after: number,
    ) => Effect.Effect<ReturnType<typeof mixPlaylistedPage>, LibraryStoreError>;
    readonly mixCreditPage: (
      after: number,
    ) => Effect.Effect<ReturnType<typeof mixCreditPage>, LibraryStoreError>;
    readonly mixSongsPage: (
      after: number,
      options?: { readonly genres?: boolean },
    ) => Effect.Effect<ReturnType<typeof mixSongsPage>, LibraryStoreError>;
    readonly mixArtistsPage: (
      after: number,
    ) => Effect.Effect<ReturnType<typeof mixArtistsPage>, LibraryStoreError>;
    readonly mixHistoryPage: (
      after: number,
    ) => Effect.Effect<ReturnType<typeof mixHistoryPage>, LibraryStoreError>;
    readonly graphRadioPage: (
      after: number,
    ) => Effect.Effect<ReturnType<typeof graphRadioPage>, LibraryStoreError>;
    readonly graphCatalogPage: (
      after: number,
    ) => Effect.Effect<ReturnType<typeof graphCatalogPage>, LibraryStoreError>;
    readonly mixCatalogPage: (
      after: number,
    ) => Effect.Effect<ReturnType<typeof mixCatalogPage>, LibraryStoreError>;
    readonly graphSimilarPage: (
      after: string | null,
    ) => Effect.Effect<GraphPage<YtArtistSimilar, string>, LibraryStoreError>;
    readonly graphPlayPage: (
      after: GraphPlayCursor,
    ) => Effect.Effect<GraphPage<ArtistGraphPlay, GraphPlayCursor>, LibraryStoreError>;
    readonly candidateCatalog: Effect.Effect<readonly CatalogSong[], LibraryStoreError>;
    /**
     * Every saved YT Music artist page's artist with who "Fans might also
     * like", in the page's order (the artist graph's similar artists).
     */
    readonly ytArtistSimilar: Effect.Effect<readonly YtArtistSimilar[], LibraryStoreError>;
  }
>()("@wave/mobile/library/LibraryStore") {}

type Database = ExpoSQLiteDatabase<typeof schema>;

/** SQLite's default limit on bound parameters is far above this; it keeps statements small. */
const DELETE_CHUNK = 500;

const chunks = <A>(items: readonly A[]): A[][] => {
  const result: A[][] = [];
  for (let i = 0; i < items.length; i += DELETE_CHUNK) {
    result.push(items.slice(i, i + DELETE_CHUNK));
  }
  return result;
};

const removeRootSync = (db: Database, splits: CreditSplits, path: string): void => {
  const { scanRoots, tracks, excludedFolders } = schema;
  db.transaction((tx) => {
    const remaining = tx
      .select({ path: scanRoots.path })
      .from(scanRoots)
      .all()
      .map((root) => root.path)
      .filter((root) => root !== path);
    if (remaining.length === 0) throw new Error("Wave needs at least one music folder");

    const under = tx
      .select({ path: filePath })
      .from(tracks)
      // SQLite counts characters where JS counts UTF-16 units, so the length is taken in SQL.
      .where(and(hasFile, sql`substr(${tracks.path}, 1, length(${path}) + 1) = ${`${path}/`}`))
      .all()
      .map((row) => row.path);
    const leaving = filesLeavingWithRoot(under, path, remaining);
    leaveFiles(tx, leaving);
    tx.delete(scanRoots).where(eq(scanRoots.path, path)).run();

    // Exclusions only mean something inside a root.
    const exclusions = tx
      .select({ path: excludedFolders.path })
      .from(excludedFolders)
      .all()
      .map((row) => row.path);
    const stale = filesLeavingWithRoot(exclusions, path, remaining);
    if (stale.length > 0) {
      tx.delete(excludedFolders)
        .where(inArray(excludedFolders.path, [...stale]))
        .run();
    }

    pruneOrphans(tx, splits);
  });
};

/** Artists with songs (see `selectArtists`), only [ids] if given. */
const listArtistsSync = (db: Database, ids?: readonly number[]): ArtistRow[] =>
  selectArtists(db, { ids });

const getGenreSync = (db: Database, id: number): GenreDetail | null => {
  const { genres } = schema;
  const genre = db
    .select({ id: genres.id, name: genres.name, sort: genres.sort })
    .from(genres)
    .where(eq(genres.id, id))
    .get();
  if (genre === undefined) return null;
  const songs = selectGenreSongs(db, id);
  return { genre: { ...genre, trackCount: songs.length }, songs };
};

const SAVED_PLAYBACK_ID = 1;

const listRecentSearchesSync = (db: Pick<Database, "select">): string[] =>
  db
    .select({ query: schema.recentSearches.query })
    .from(schema.recentSearches)
    .orderBy(desc(schema.recentSearches.searchedAt))
    .all()
    .map((row) => row.query);

/** Rewrites the list Core's `rememberSearch` returns, newest with the latest time. */
const rememberSearchSync = (db: Database, query: string, now: number): readonly string[] =>
  db.transaction((tx) => {
    const recent = listRecentSearchesSync(tx);
    const next = rememberSearch(recent, query);
    if (next === recent) return recent;
    tx.delete(schema.recentSearches).run();
    tx.insert(schema.recentSearches)
      .values(next.map((search, i) => ({ query: search, searchedAt: now - i })))
      .run();
    return next;
  });

const writeAttempt = <A>(operation: string, run: () => A): Effect.Effect<A, LibraryStoreError> =>
  Effect.try({ try: run, catch: (cause) => new LibraryStoreError({ operation, cause }) });

// All synchronous reads share this boundary. Row counts are inspected only
// on the slow path; named bundles count the rows they actually returned.
const attempt = <A>(
  operation: string,
  run: () => A,
  rows?: (result: A) => number,
): Effect.Effect<A, LibraryStoreError> =>
  Effect.try({
    try: () => timeLibraryRead(operation, run, rows),
    catch: (cause) => new LibraryStoreError({ operation, cause }),
  });

const make = Effect.gen(function* () {
  const db: Database = yield* Effect.try({
    try: () => {
      const client = openDatabaseSync(DATABASE_NAME);
      client.execSync("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;");
      return drizzle(client, { schema });
    },
    catch: (cause) => new LibraryStoreError({ operation: "open the database", cause }),
  });
  yield* Effect.tryPromise({
    try: () => migrate(db, migrations),
    catch: (cause) => new LibraryStoreError({ operation: "migrate", cause }),
  });
  // The Library's credits and their splitter, kept between saves.
  const splits = creditSplits();
  // After the upgrade that brought credits in, the Library is re-filed under
  // each credited artist from the tags already stored (no rescan).
  yield* Effect.try({
    try: () => relinkCreditsIfUnlinked(db, splits),
    catch: (cause) => new LibraryStoreError({ operation: "split artist credits", cause }),
  });
  // After the upgrade that brought Wave accounts in, every song (and its
  // plays) gets its recording key from the tags already stored (no rescan).
  yield* Effect.try({
    try: () => keyRecordings(db),
    catch: (cause) => new LibraryStoreError({ operation: "key the Library's songs", cause }),
  });

  yield* Effect.tryPromise({
    try: () => backfillRecordingTitles(db),
    catch: (cause) => new LibraryStoreError({ operation: "key recording titles", cause }),
  });

  return LibraryStore.of({
    ensureDefaultRoot: (path) =>
      writeAttempt("set up scan roots", () => {
        const existing = db.select().from(schema.scanRoots).all();
        if (existing.length > 0) return existing;
        db.insert(schema.scanRoots).values({ path, addedAt: Date.now(), isDefault: true }).run();
        return db.select().from(schema.scanRoots).all();
      }),

    listRoots: attempt("list music folders", () => {
      const { scanRoots, tracks } = schema;
      return db
        .select({
          path: scanRoots.path,
          isDefault: scanRoots.isDefault,
          lastScannedAt: scanRoots.lastScannedAt,
          trackCount: sql<number>`(SELECT count(*) FROM ${tracks}
            WHERE substr(${tracks.path}, 1, length(${scanRoots.path}) + 1) = ${scanRoots.path} || '/')`,
        })
        .from(scanRoots)
        .orderBy(asc(scanRoots.addedAt), asc(scanRoots.path))
        .all();
    }),

    addRoot: (path, drop) =>
      writeAttempt("add a music folder", () =>
        db.transaction((tx) => {
          const { scanRoots } = schema;
          if (drop.length > 0)
            tx.delete(scanRoots)
              .where(inArray(scanRoots.path, [...drop]))
              .run();
          tx.insert(scanRoots).values({ path, addedAt: Date.now() }).onConflictDoNothing().run();
          tx.update(scanRoots).set({ isDefault: false }).run();
        }),
      ),

    removeRoot: (path) =>
      writeAttempt("remove a music folder", () => removeRootSync(db, splits, path)),

    excludedFolders: attempt("read excluded folders", () =>
      db
        .select({ path: schema.excludedFolders.path })
        .from(schema.excludedFolders)
        .all()
        .map((row) => row.path),
    ),

    saveBatch: (tracks, artworkRows, moves = [], options) =>
      writeAttempt("save scanned tracks", () =>
        saveBatch(db, splits, tracks, artworkRows, moves, Date.now(), options),
      ),

    linkPlaylistEntries: writeAttempt("link playlist entries", () =>
      db.transaction((tx) => linkPlaylistEntries(tx, Date.now())),
    ),

    playlistEntriesRevision: attempt("read the playlists' revision", () =>
      selectPlaylistEntriesRevision(db),
    ),

    hasUnscannedRoot: (roots) =>
      attempt("read which folders were scanned", () => hasUnscannedRoot(db, roots)),

    markScanned: (roots, at) =>
      writeAttempt("record the scan", () => {
        if (roots.length === 0) return;
        db.update(schema.scanRoots)
          .set({ lastScannedAt: at })
          .where(inArray(schema.scanRoots.path, [...roots]))
          .run();
      }),

    countTracks: attempt(
      "count tracks",
      () =>
        db
          .select({ count: sql<number>`count(*)` })
          .from(schema.tracks)
          .get()?.count ?? 0,
    ),

    countLibrary: attempt("count the library", () => libraryCounts(db)),
    countSectionSongs: attempt("count the library's songs", () => sectionSongCounts(db)),
    measureScale: attempt("measure the library", () => libraryScale(db)),

    playlistRecommendationInput: (id) =>
      attempt(
        "read playlist recommendations",
        () => selectPlaylistRecommendationInput(db, id),
        (result) =>
          result.playlist.length +
          result.librarySongs.length +
          result.catalog.length +
          result.favoriteVideos.size +
          result.feedback.length,
      ),
    dismissPlaylistRecommendation: (id, offer) =>
      writeAttempt("save playlist dismissal", () =>
        dismissPlaylistRecommendation(db, id, offer, Date.now()),
      ),
    acceptPlaylistRecommendation: (id, offer) =>
      writeAttempt("add playlist recommendation", () =>
        acceptPlaylistRecommendation(db, id, offer, Date.now()),
      ),
    matchingSong: (song) => attempt("read matching song", () => selectMatchingSong(db, song)),
    listSongs: attempt("list songs", () =>
      trackQuery(db)
        .orderBy(...BY_TITLE)
        .all(),
    ),

    listSongOrder: (sort) =>
      attempt(
        "order songs",
        () => selectSongOrder(db, sort),
        (result) => result.ids.length,
      ),

    songFindTexts: attempt("read songs to find", () => selectSongFindTexts(db)),

    songSummaries: (ids) => attempt("read songs", () => selectSongSummaries(db, ids)),

    songsWithIds: (ids) => attempt("read songs", () => selectSongsWithIds(db, ids)),

    listLibraryLookupSongs: attempt("list songs to look up", () => selectLibraryLookupSongs(db)),

    listSongGenres: attempt("list song genres", () => selectSongGenres(db)),

    trackDetails: (id) =>
      attempt(
        "read the playing track",
        () =>
          db
            .select({
              id: schema.tracks.id,
              artistId: schema.tracks.artistId,
              artistIds: trackArtistIds,
              artist: schema.tracks.artistCredit,
              albumId: schema.tracks.albumId,
              album: schema.albums.title,
              palette: schema.artwork.palette,
              path: filePath,
            })
            .from(schema.tracks)
            .innerJoin(schema.artists, withFile(eq(schema.tracks.artistId, schema.artists.id)))
            .innerJoin(schema.albums, eq(schema.tracks.albumId, schema.albums.id))
            .leftJoin(schema.artwork, eq(schema.tracks.artworkHash, schema.artwork.hash))
            .where(eq(schema.tracks.id, id))
            .get() ?? null,
      ),

    listAlbums: attempt("list albums", () => selectAlbums(db, undefined)),

    listAlbumsPage: (page) =>
      attempt("list albums", () => selectAlbums(db, undefined, page, "files")),

    artistNamesForLink: (after) =>
      attempt("read artist link names", () => selectArtistNamesForLink(db, after)),

    listArtists: attempt("list artists", () => listArtistsSync(db)),

    listArtistsPage: (page) =>
      attempt("list artists", () => selectArtists(db, { page, scope: "files" })),

    listArtistSongsPage: (id, page) =>
      attempt("list the artist's songs", () => selectArtistSongs(db, id, page, "files")),

    listPlaylistEntriesPage: (id, page) =>
      attempt("list the playlist's songs", () => selectPlaylistEntries(db, id, page, "files")),

    artistCovers: (ids) => attempt("load artist covers", () => selectArtistCovers(db, ids)),

    listGenres: attempt("list genres", () => {
      const { genres, tracks } = schema;
      return db
        .select({
          id: genres.id,
          name: genres.name,
          sort: genres.sort,
          trackCount: sql<number>`count(${tracks.id})`,
        })
        .from(genres)
        .innerJoin(tracks, eq(tracks.genreId, genres.id))
        .groupBy(genres.id)
        .orderBy(asc(genres.sort), asc(genres.id))
        .all();
    }),

    getAlbum: (id, scope) =>
      attempt(
        "open the album",
        () => selectAlbumDetail(db, id, scope),
        (result) => (result === null ? 0 : 1 + result.tracks.length),
      ),

    getArtist: (id, scope) =>
      attempt(
        "open the artist",
        () => selectArtistDetail(db, id, scope),
        (result) =>
          result === null
            ? 0
            : 1 + result.albums.length + result.appearsOn.length + result.songs.length,
      ),

    getGenre: (id) =>
      attempt(
        "open the genre",
        () => getGenreSync(db, id),
        (result) => (result === null ? 0 : 1 + result.songs.length),
      ),

    knownFiles: (roots) => attempt("read the library index", () => selectKnownFiles(db, roots)),

    indexedFiles: (paths) =>
      attempt("read missing files", () =>
        chunks(paths).flatMap((chunk) =>
          db
            .select({
              path: filePath,
              sizeBytes: schema.tracks.sizeBytes,
              durationMs: schema.tracks.durationMs,
              title: schema.tracks.title,
              artist: schema.tracks.artistCredit,
            })
            .from(schema.tracks)
            .innerJoin(schema.artists, eq(schema.tracks.artistId, schema.artists.id))
            .where(and(hasFile, inArray(schema.tracks.path, chunk)))
            .all(),
        ),
      ),

    filesGone: (paths) =>
      writeAttempt("update songs whose files are gone", () => filesGone(db, splits, paths)),

    removeSongs: (trackIds) =>
      writeAttempt("remove songs from the library", () =>
        removeSongs(db, splits, trackIds, Date.now()),
      ),
    missingSongs: (trackIds) =>
      attempt("read missing songs", () => selectMissingSongs(db, trackIds)),
    albumsMissingSongs: (albumIds) =>
      attempt("read albums' missing songs", () => selectAlbumsMissingSongs(db, albumIds)),

    addExcludedFolder: (path, drop) =>
      writeAttempt("exclude a folder", () =>
        db.transaction((tx) => {
          const { excludedFolders } = schema;
          if (drop.length > 0)
            tx.delete(excludedFolders)
              .where(inArray(excludedFolders.path, [...drop]))
              .run();
          tx.insert(excludedFolders)
            .values({ path, addedAt: Date.now() })
            .onConflictDoNothing()
            .run();
        }),
      ),

    removeExcludedFolder: (path) =>
      writeAttempt("include a folder again", () => {
        db.delete(schema.excludedFolders).where(eq(schema.excludedFolders.path, path)).run();
      }),

    hasPlayableSongOutside: (ids) =>
      attempt("probe Home pick growth", () => hasPlayableSongOutside(db, ids)),

    songsByIds: (ids) =>
      attempt("read queued songs", () => selectPlayableSongs(db, ids).filter(songHasFile)),

    videoIds: (ids) => attempt("read the songs' video ids", () => selectVideoIds(db, ids)),

    loadPlayback: attempt(
      "read the saved queue",
      () =>
        db
          .select({
            queue: schema.savedPlayback.queue,
            positionMs: schema.savedPlayback.positionMs,
          })
          .from(schema.savedPlayback)
          .where(eq(schema.savedPlayback.id, SAVED_PLAYBACK_ID))
          .get() ?? null,
    ),

    saveQueue: (queue, positionMs) =>
      writeAttempt("save the queue", () => {
        const row = { queue, positionMs: Math.round(positionMs), updatedAt: Date.now() };
        db.insert(schema.savedPlayback)
          .values({ id: SAVED_PLAYBACK_ID, ...row })
          .onConflictDoUpdate({ target: schema.savedPlayback.id, set: row })
          .run();
      }),

    savePosition: (positionMs) =>
      writeAttempt("save the playback position", () => {
        db.update(schema.savedPlayback)
          .set({ positionMs: Math.round(positionMs), updatedAt: Date.now() })
          .where(eq(schema.savedPlayback.id, SAVED_PLAYBACK_ID))
          .run();
      }),

    listRecentSearches: attempt("read recent searches", () => listRecentSearchesSync(db)),

    rememberSearch: (query) =>
      writeAttempt("save the search", () => rememberSearchSync(db, query, Date.now())),

    clearRecentSearches: writeAttempt("clear recent searches", () => {
      db.delete(schema.recentSearches).run();
    }),

    listPlaylists: attempt("list playlists", () => selectPlaylists(db)),

    playlistsLastPlayed: attempt("read when playlists last played", () =>
      selectPlaylistsLastPlayed(db),
    ),

    unsearchedEntries: attempt("read the playlists' unsearched songs", () =>
      selectUnsearchedEntries(db),
    ),

    getPlaylist: (id, scope) =>
      attempt(
        "open the playlist",
        () => selectPlaylist(db, id, scope),
        (result) => (result === null ? 0 : 1 + result.items.length),
      ),

    createPlaylist: (name, songs) =>
      writeAttempt("create the playlist", () => createPlaylist(db, name, songs, Date.now())),

    renamePlaylist: (id, name) =>
      writeAttempt("rename the playlist", () => renamePlaylist(db, id, name, Date.now())),

    deletePlaylist: (id) =>
      writeAttempt("delete the playlist", () => deletePlaylist(db, id, Date.now())),

    setPlaylistImage: (id, files) =>
      writeAttempt("change the playlist's image", () => setPlaylistImage(db, id, files)),

    playlistImageOriginal: (id) =>
      attempt("read the playlist's image", () => selectPlaylistImageOriginal(db, id)),

    removePlaylistImage: (id) =>
      writeAttempt("remove the playlist's image", () => removePlaylistImage(db, id)),

    takeDeletedPlaylistImages: writeAttempt("tidy deleted playlists' images", () =>
      takeDeletedPlaylistImages(db),
    ),

    addToPlaylist: (id, songs) =>
      writeAttempt("add to the playlist", () => addToPlaylist(db, id, songs, Date.now())),

    movePlaylistItem: (playlistId, itemId, toIndex) =>
      writeAttempt("reorder the playlist", () =>
        movePlaylistItem(db, playlistId, itemId, toIndex, Date.now()),
      ),

    removePlaylistItems: (playlistId, itemIds) =>
      writeAttempt("remove from the playlist", () =>
        removePlaylistItems(db, playlistId, itemIds, Date.now()),
      ),

    restorePlaylistItems: (removal) =>
      writeAttempt("restore the playlist entries", () =>
        restorePlaylistItems(db, removal, Date.now()),
      ),

    settleTryAgain: (playlistId, answered) =>
      writeAttempt("save what Try Again found", () =>
        settleTryAgain(db, playlistId, answered, Date.now()),
      ),

    settleUnsearched: (song, becomes) =>
      writeAttempt("save what the search found", () =>
        settleUnsearchedEntries(db, song, becomes, Date.now()),
      ),

    replacePlaylistSongs: (playlistId, songs) =>
      writeAttempt("replace the playlist's songs", () =>
        replacePlaylistSongs(db, playlistId, songs, Date.now()),
      ),

    trackPaths: attempt("read the library's files", () => selectTrackPaths(db)),

    importTracks: attempt("read the library's songs", () => selectImportTracks(db)),

    importedPlays: attempt("read the imported plays", () => importedPlays(db)),

    saveImportedPlays: (plays) =>
      writeAttempt("save the imported plays", () => saveImportedPlays(db, plays)),

    playedRecordingKeys: attempt("read the songs played", () => playedRecordingKeys(db)),

    tasteHistory: attempt(
      "read the taste history",
      () => tasteHistory(db),
      (result) => result.plays.length + result.favorites.length + result.downloads.length,
    ),

    favoriteTrackIds: attempt("read favorites", () => selectFavoriteTrackIds(db)),

    setFavorites: (trackIds, on) =>
      writeAttempt(on ? "add favorites" : "remove favorites", () =>
        setFavorites(db, trackIds, on, Date.now()),
      ),

    listFavorites: attempt("list favorites", () => listFavorites(db)),

    addPendingFavorites: (songs) =>
      writeAttempt("keep pending favorites", () => addPendingFavorites(db, songs, Date.now())),

    listPendingFavorites: attempt("read pending favorites", () => selectPendingFavorites(db)),

    removePendingFavorites: (videoIds) =>
      writeAttempt("forget pending favorites", () => removePendingFavorites(db, videoIds)),

    qualityFiles: attempt("read the files' quality", () => selectQualityFiles(db)),
    noBetterCopies: (direction) =>
      attempt("read the songs with no better copy", () => selectNoBetterCopies(db, direction)),
    rememberNoBetterCopies: (songs) =>
      writeAttempt("remember the songs with no better copy", () =>
        rememberNoBetterCopies(db, songs),
      ),
    replacedTrack: (trackId) =>
      attempt("read a song to replace", () => selectReplacedTrack(db, trackId)),
    replaceTrackFile: (trackId, track, artworkRows) =>
      writeAttempt("replace a song's file", () =>
        replaceTrackFile(db, splits, trackId, track, artworkRows, Date.now()),
      ),
    recordFileDeletions: (paths) =>
      writeAttempt("record files to delete", () => recordFileDeletions(db, paths, Date.now())),
    pendingFileDeletions: attempt("read the files to delete", () => pendingFileDeletions(db)),
    forgetFileDeletions: (paths) =>
      writeAttempt("forget deleted files", () => forgetFileDeletions(db, paths)),
    duplicateCheckFiles: attempt("read the files a replacement may have left twice", () =>
      selectDuplicateCheckFiles(db),
    ),
    fixReplacementDuplicate: (fix) =>
      writeAttempt("put a song left twice back to one", () =>
        fixReplacementDuplicate(db, splits, fix, Date.now()),
      ),

    recordPlay: (play, overlapping) =>
      writeAttempt("record the play", () => recordPlay(db, play, overlapping)),

    updatePlay: (id, play) => writeAttempt("update the play", () => updatePlay(db, id, play)),
    endPlay: (id, play) => writeAttempt("end the play", () => endPlay(db, id, play)),

    home: (scope) =>
      attempt(
        "read Home",
        () => homeSections(db, scope),
        (result) =>
          result.recentlyAdded.length +
          result.recentlyPlayed.length +
          result.mostPlayed.length +
          result.favorites.length,
      ),
    homeAdded: attempt(
      "read Recently Added",
      () => homeAdded(db),
      (result) => result.recentlyAdded.length,
    ),
    homePlays: attempt(
      "read Home's plays",
      () => homePlays(db),
      (result) => result.recentlyPlayed.length + result.mostPlayed.length,
    ),
    homeFavorites: attempt(
      "read Home's favorites",
      () => homeFavorites(db),
      (result) => result.favorites.length,
    ),

    latestPlay: attempt("read the latest play", () => latestPlay(db)),

    trackPlayTotals: (window, trackIds) =>
      attempt("sum up song plays", () => trackPlayTotals(db, window, trackIds)),

    creditedPlayTotals: (window) =>
      attempt("sum up album and artist plays", () => creditedPlayTotals(db, window)),

    albumsByIds: (ids) =>
      attempt("read ranked albums", () =>
        ids.length === 0 ? [] : selectAlbums(db, inArray(schema.albums.id, [...ids])),
      ),

    artistsByIds: (ids) =>
      attempt("read ranked artists", () => (ids.length === 0 ? [] : listArtistsSync(db, ids))),

    linkRows: (ids) =>
      attempt(
        "read linked rows",
        () => selectLinkRows(db, ids),
        (result) => Number(result.album !== null) + Number(result.artist !== null),
      ),

    listeningSums: attempt("sum up listening", () => listeningSums(db)),

    countedListening: attempt("sum up counted listening", () => countedListening(db)),

    songGenres: (ids) => attempt("read the songs' genres", () => songGenres(db, ids)),

    artistFirstPlays: (ids) =>
      attempt("read the artists' first plays", () => artistFirstPlays(db, ids)),

    artistPlays: (artistId, now) =>
      attempt(
        "sum up the artist's plays",
        () => artistPlays(db, artistId, now),
        (result) => result.songIds.length + result.listening.length + result.songPlays.length,
      ),

    artistPhotoLookups: attempt("list artist photo lookups", () =>
      selectArtistPhotoLookups(db, Date.now()),
    ),

    recordArtistPhoto: (artistKey, record) =>
      writeAttempt("record an artist photo", () => recordArtistPhoto(db, artistKey, record)),

    listArtistPhotos: attempt("list artist photos", () => selectArtistPhotos(db)),

    clearArtistPhotos: writeAttempt("clear artist photos", () => clearArtistPhotos(db)),

    ytArtist: (artistKey) =>
      attempt("read an artist's YT Music section", () =>
        selectYtArtist<NativeYtSong>(db, artistKey),
      ),

    saveYtArtist: (artistKey, saved) =>
      writeAttempt("save an artist's YT Music section", () => {
        saveYtArtist(db, artistKey, saved);
        artistGraphSourcesChanged("similar");
      }),

    stampPreference: (key) =>
      writeAttempt("record a preference change", () => stampPreference(db, key, Date.now())),

    syncWithAccount: (input) =>
      Effect.tryPromise({
        try: () => syncCycle({ ...input, db, splits }),
        catch: (cause) => new LibraryStoreError({ operation: "sync with the Wave account", cause }),
      }),

    leaveAccount: writeAttempt("leave the Wave account", () => signOut(db, splits)),

    savedLyrics: (videoId) => attempt("read saved lyrics", () => selectSavedLyrics(db, videoId)),

    keepSavedLyrics: (videoId, saved) =>
      writeAttempt("save lyrics", () => keepSavedLyrics(db, videoId, saved, Date.now())),

    forgetSavedLyrics: (videoIds) =>
      writeAttempt("forget saved lyrics", () => forgetSavedLyrics(db, videoIds)),

    lyricsSearchTrack: (trackId) =>
      attempt("read the song's lyrics search", () => selectLyricsSearchTrack(db, trackId)),

    keepLyricsMiss: (trackId, checkedAt) =>
      writeAttempt("remember the lyrics search", () => keepLyricsMiss(db, trackId, checkedAt)),

    noteStreamedSong: (song, at) =>
      writeAttempt("note a streamed song", () => noteStreamedSong(db, song, at)),

    streamedSongs: attempt("read the songs streamed", () => selectStreamedSongs(db)),

    playlistedSongs: attempt("read the playlists' songs", () => selectPlaylistedSongs(db)),

    knownVideos: attempt("read the videos the owner knows", () => selectKnownVideos(db)),

    addCandidates: (page, at) =>
      writeAttempt("add to the candidate catalog", () => {
        addCandidates(db, page, at);
        artistGraphSourcesChanged("catalog");
      }),

    mixStreamedPage: (after) =>
      attempt("read a mix streamed page", () => mixStreamedPage(db, after)),
    mixPlaylistedPage: (after) =>
      attempt("read a mix playlist page", () => mixPlaylistedPage(db, after)),
    mixCreditPage: (after) => attempt("read a mix credit page", () => mixCreditPage(db, after)),
    tastePlaysPage: (after) => attempt("read a taste play page", () => tastePlaysPage(db, after)),
    tasteFavoritesPage: (after) =>
      attempt("read a taste favorite page", () => tasteFavoritesPage(db, after)),
    tasteDownloadsPage: (after) =>
      attempt("read a taste download page", () => tasteDownloadsPage(db, after)),
    mixSongsPage: (after, options) =>
      attempt("read a mix song page", () => mixSongsPage(db, after, options)),
    mixArtistsPage: (after) => attempt("read a mix artist page", () => mixArtistsPage(db, after)),
    mixHistoryPage: (after) => attempt("read a mix history page", () => mixHistoryPage(db, after)),
    mixCatalogPage: (after) => attempt("read a mix catalog page", () => mixCatalogPage(db, after)),
    graphRadioPage: (after) => attempt("read a graph radio page", () => graphRadioPage(db, after)),
    graphCatalogPage: (after) =>
      attempt("read a graph catalog page", () => graphCatalogPage(db, after)),
    graphSimilarPage: (after) =>
      attempt("read a graph similar page", () => graphSimilarPage(db, after)),
    graphPlayPage: (after) => attempt("read a graph play page", () => graphPlayPage(db, after)),
    candidateCatalog: attempt("read the candidate catalog", () => selectCandidateCatalog(db)),

    ytArtistSimilar: attempt("read the saved artist pages' similar artists", () =>
      selectYtArtistSimilar(db),
    ),
  });
});

export const layer = Layer.effect(LibraryStore, make);
