import {
  listSongs,
  listGenres,
  removeRootSync,
  listArtistsSync,
  getGenreSync,
  listRecentSearchesSync,
  rememberSearchSync,
  ensureDefaultRoot,
  listRoots,
  addRoot,
  addExcludedFolder,
  excludedFolders,
  countTracks,
  trackDetails,
  indexedFiles,
  databaseWrites,
  markScanned,
  removeExcludedFolder,
  clearRecentSearches,
  albumsByIds,
  linkEntries,
} from "@wave/client/db/libraryQueries";
import {
  songHasFile,
  Database as ClientDatabase,
  SqliteDriver,
  databaseLayer,
  type LibraryDatabase,
} from "@wave/client";
import {
  finishReplaySteps,
  NotReplayable,
  sharedReplays,
  type ReplayedRead,
} from "@wave/client/db/offThreadReads";
import { SyncLibraryReads } from "./syncLibraryReads.ts";
import { sqliteDriverLayer } from "./sqliteDriver.ts";
import { collaborationStore, type CollaborationStore } from "@/collaboration/collaborationStore";
import type {
  AlbumDetail,
  AlbumRow,
  ArtistDetail,
  ArtistRow,
  GenreDetail,
  GenreRow,
  IndexedArtwork,
  IndexedKnownFile,
  IndexedTrack,
  LibraryLookupSong,
  PathMove,
  PlayableSongRow,
  PlaylistAddResult,
  PlaylistDetail,
  PlaylistEntryRow,
  PlaylistRow,
  ScanRoot,
  ScanRootSummary,
  SongRow,
  TrackDetails,
} from "@wave/client";
import { saveReleaseDate, saveTypedReleaseDate } from "@wave/client/db/releaseDates";
import { pendingStreamedGenres, keepStreamedGenre } from "@wave/client/db/streamedGenres";
import {
  pendingDjMoodSongs,
  keepDjMoodFeatures,
  selectDjMoodFeatures,
  type DjMoodFeatureWrite,
  type DjMoodLookupPage,
} from "@wave/client/db/djMoodFeatures";
import {
  pendingDjLibraryMoodSongs,
  keepDjLibraryMoodFeatures,
  selectDjLibraryMoodFeatures,
  type DjLibraryMoodFeatureWrite,
  type DjLibraryMoodSong,
} from "@wave/client/db/djLibraryMoodFeatures";
import {
  readFollowShows,
  saveFollowShows,
  markShowNotified,
  type FollowShowCacheRow,
} from "@wave/client/db/followShows";
import {
  readFollowReleases,
  saveFollowReleases,
  hideFollowRelease,
  followReleaseListening,
  type FollowReleaseCache,
} from "@wave/client/db/followReleases";
import type { FollowRelease, LeavingSong } from "@wave/core";
import type { FollowedArtist, FollowLevel } from "@wave/core";
import {
  selectFollow,
  selectFollows,
  countFollows,
  saveFollow,
  removeFollow,
  restoreFollow,
  type FollowTarget,
} from "@wave/client/db/follows";
import {
  dismissFollowSuggestion,
  selectDismissedFollowSuggestions,
  undoFollowSuggestionDismissal,
} from "@wave/client/db/followSuggestionDismissals";
import { selectDownloadsToForget } from "@wave/client/db/downloadRecovery";
import {
  selectListDownloadMembers,
  type DownloadListMembers,
} from "@wave/client/db/listDownloadMembers";
import type { ListDownloadsScope } from "@wave/core";
import {
  playedTotalsRead,
  playedTotalsSteps,
  playedArtistSongs,
  keptArtistSongs,
  streamedLibraryPlays,
  recapPlays,
  type PlayedArtist,
  type PlayedEntityTotals,
  type PlayedArtistSongs,
  type RecapPlays,
} from "@wave/client/db/playedEntities";
import {
  type RecommendationEntryCursor,
  recommendationFlagsPage,
  recommendationPendingPage,
  recommendationEntriesPage,
  recommendationFeedbackPage,
} from "@wave/client/db/recommendationPages";
import type {
  AppLanguage,
  KeptSongs,
  QueueWrite,
  ShuffleSong,
  YtSong,
  YtDownloadJournalJob,
} from "@wave/core";
import { makeExternalStore, type ExternalStore } from "@wave/client/externalStore";
import { followSaved } from "./followsSaved";
import { publishSavedRecordings } from "./libraryChanges";
import {
  backfillRecordingTitles,
  selectMatchingSong,
  selectMatchingSongs,
} from "@wave/client/db/matchingSong";
import {
  tastePlaysPage,
  tasteFavoritesPage,
  tasteDownloadsPage,
  tasteArtistsPage,
  tasteRevision,
  watchTasteSources,
} from "@wave/client/db/tastePages";
import { artistGraphSourcesChanged } from "@/home/graphSources";
import {
  mixCreditPage,
  mixPlaylistedPage,
  mixStreamedPage,
  mixStreamedPlaysPage,
  mixCreditNamesPage,
  mixSongsPage,
  mixArtistsPage,
  mixHistoryPage,
  mixSongs,
  mixArtists,
  mixPlayTotals,
  mixPlayedRecordingKeys,
  mixCredits,
  mixStreamedPlays,
  mixCreditNames,
  mixStreamed,
  mixPlaylisted,
} from "@wave/client/db/mixInputs";
import {
  mixCatalog,
  graphRadios,
  mixCatalogPage,
  graphRadioPage,
  graphCatalogPage,
  graphSimilarPage,
  graphPlayPage,
  graphPlays,
  type GraphPage,
  type GraphPlay,
  type GraphPlayCursor,
} from "@wave/client/db/artistGraph";
import { selectLeavingSong } from "@wave/client/db/leavingSong";
import {
  saveMeasurement,
  saveMeasurements,
  selectLibraryGains,
  selectLibraryToMeasure,
  selectSongLoudness,
  selectAlbumLoudness,
  selectSongsToMeasure,
  type MeasuredSong,
  type SongMeasurement,
  type SongToMeasure,
} from "@wave/client/db/loudness";
import { selectNowPlayingSong } from "@wave/client/db/nowPlayingSong";
import type { PlayingSongAnswer, PlayingSongTarget } from "@wave/client";
import {
  acceptPlaylistRecommendation,
  dismissPlaylistRecommendation,
  selectPlaylistRecommendationInput,
  type PlaylistRecommendationInput,
} from "@wave/client/db/playlistRecommendations";
import {
  type ArtistFirstPlay,
  type BlackPlayerPlay,
  type BlackPlayerTrack,
  type ImportedPlays,
  type TasteHistory,
  type IndexedFile,
  type LibrarySongSort,
  type PlaylistPlays,
  type PlaylistSong,
  type MissingTrack,
  type PendingFavorite,
  type DislikedSong,
  type CountedListening,
  type RecapSongGenre,
  type CreditedPlayTotals,
  type PlayEvent,
  type PlayTotals,
  type SongPlayTotals,
  type ListeningSums,
  type StatsWindow,
  type TryAgainAnswered,
  type UnsearchedSong,
  type YtAlbumSong,
  type YtArtistSaved,
  type SavedLyrics,
  type SongLoudness,
  type AlbumLoudness,
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
  finishSteps,
} from "@wave/core";

import * as Context from "effect/Context";
import * as Data from "effect/Data";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";

import {
  heldLibraryRead,
  libraryReadStaysHere as readsHere,
  timeLibraryRead,
} from "@/log/slowLibraryReads";
import type { NativeYtSong } from "@/native/waveYtMusic";
import {
  syncCollaborativePlaylist,
  syncCycle,
  type SyncCycleInput,
  type SyncCycleResult,
} from "@wave/client/sync/syncCycle";
import {
  dismissPrivateCopyNotice,
  markCollaborationSeen,
  selectCollaborations,
  selectPrivateCopyNotices,
} from "@wave/client/db/collaborations";

import { selectAlbumDetail, selectAlbums } from "@wave/client/db/albums";
import { importedPlays, saveImportedPlays, selectImportTracks } from "@wave/client/db/blackPlayer";
import {
  selectArtistCovers,
  selectArtistDetail,
  selectArtistSongs,
  selectArtists,
  selectArtistNamesForLink,
} from "@wave/client/db/artists";
import {
  clearArtistPhotos,
  recordArtistPhoto,
  selectArtistPhotoLookups,
  selectArtistPhotos,
  type ArtistPhotoLookup,
  type ArtistPhotoRecord,
  type ArtistPhotoRow,
} from "@wave/client/db/artistPhotos";
import {
  libraryCounts,
  libraryScale,
  sectionSongCounts,
  type LibraryCounts,
  type LibraryScale,
} from "@wave/client/db/counts";
import { creditSplits, relinkCreditsIfUnlinked } from "@wave/client/db/credits";
import {
  selectGenreOpening,
  selectGenreOrderSlice,
  type GenreCursor,
  type GenreOpening,
  type GenreOrderSlice,
} from "@wave/client/db/genrePages";

import type { RowPage } from "@wave/client/db/database";
import { optimizeDatabase } from "@wave/client/db/connection";

import { selectLinkRows, type LinkIds, type LinkRows } from "@wave/client/db/links";
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
} from "@wave/client/db/playHistory";
import { listeningSums, selectCountedPlays, songCountedPlays } from "@wave/client/db/playTotals";
import { keptTotalsSteps } from "@wave/client/db/keptPlayTotals";
import { loadPlayback, savePlayback, type SavedPlayback } from "@wave/client/db/playback";
import { shuffleSongs } from "@wave/client/db/shuffleSongs";
import {
  listeningHistory,
  listeningHistoryAround,
  newerListeningHistory,
  type ListeningHistoryCursor,
  type ListeningHistoryPage,
} from "@wave/client/db/listeningHistory";
import { tasteHistory } from "@wave/client/db/taste";
import {
  removePlaylistImage,
  selectPlaylistImageOriginal,
  setPlaylistImage,
  takeDeletedPlaylistImages,
  type PlaylistImageFiles,
  type PlaylistImageOriginal,
} from "@wave/client/db/playlistImages";
import {
  addToPlaylist,
  createPlaylist,
  addToShazam,
  deletePlaylist,
  movePlaylistItem,
  removePlaylistItems,
  restorePlaylistItems,
  restoreGraveyardItem,
  forgetGraveyardItems,
  type PlaylistRemoval,
  renamePlaylist,
  replacePlaylistSongs,
  selectInPlaylists,
  selectPlaylist,
  selectPlaylistEntries,
  selectPlaylistGraveyard,
  selectPlaylistEntriesRevision,
  selectPlaylistEntrySongs,
  selectPlaylistEntryVideoIdsPage,
  selectPlaylistEntryVideoIds,
  selectPlaylists,
  selectPlaylistPlays,
  selectPlaylistsLastPlayed,
  selectTrackPaths,
  selectUnsearchedEntries,
  settleTryAgain,
  settleUnsearchedEntries,
  type PlaylistUnsearched,
  type UnsearchedEntriesSettled,
} from "@wave/client/db/playlists";
import {
  addPendingFavorites,
  removePendingFavorites,
  selectPendingFavorites,
} from "@wave/client/db/pendingFavorites";
import {
  removeDislikes,
  selectDislikedTracks,
  selectDislikes,
  setDislikes,
  type DislikedTrack,
} from "@wave/client/db/dislikes";
import {
  forgetSavedLyrics,
  indexSavedLyrics,
  keepSavedLyrics,
  selectSavedLyrics,
  selectSavedLyricsCandidates,
  selectSavedLyricsSearchIndexPage,
  type SavedLyricsCandidate,
} from "@wave/client/db/savedLyrics";
import { notifyLyricsSearchIndexChanged } from "./lyricsSearchVersion";
import { runLibraryWrite } from "./libraryWrites";
import {
  rememberNoBetterCopies,
  replaceTrackFile,
  selectNoBetterCopies,
  selectQualityFiles,
  selectReplacedTrack,
  type ReplacedFile,
} from "@wave/client/db/qualityReplacement";
import {
  forgetFileDeletions,
  pendingFileDeletions,
  recordFileDeletions,
} from "@wave/client/db/fileDeletions";
import {
  fixReplacementDuplicate,
  selectDuplicateCheckFiles,
  type DuplicateFixToApply,
} from "@wave/client/db/replacementDuplicates";
import {
  keepLyricsMiss,
  selectLyricsSearchTrack,
  type LyricsSearchTrack,
} from "@wave/client/db/lyricsMisses";
import {
  keepLyricsSearchText,
  selectLyricsCandidates,
  selectLyricsIndexPage,
  selectLyricsIndexTarget,
  selectStaleLyricsIndexPage,
  selectLyricsTrackIdAtPath,
  type LyricsCandidate,
  type LyricsIndexTarget,
} from "@wave/client/db/lyricsSearchIndex";
import {
  type KnownVideosCursor,
  selectKnownVideos,
  selectKnownVideosPage,
  selectPlaylistedSongs,
  selectStreamedSongs,
} from "@wave/client/db/mixKnown";
import type { VideoPage } from "@wave/client/db/videoPages";
import { addCandidates, selectCandidateCatalog } from "@wave/client/db/candidateCatalog";
import { hasUnscannedRoot, saveBatch, type SavedBatch } from "@wave/client/db/save";

import {
  selectKnownFiles,
  selectLibraryLookupSongs,
  selectPlayableSongs,
  selectPlayableSongIds,
  hasPlayableSongOutside,
  selectSongGenres,
  selectSongWithVideo,
  selectVideoIds,
  type SongGenres,
  type TrackScope,
} from "@wave/client/db/tracks";
import {
  artistFirstPlays,
  artistPlays,
  countedListening,
  countedListeningPage,
  type CountedListeningPage,
  creditedPlayTotals,
  songGenres,
  songPlayTotals,
  trackPlayTotals,
  type ArtistPlays,
} from "@wave/client/db/stats";
import { streamedSongsOf } from "@wave/client/db/streamedSongs";
import { keyRecordings, stampPreference } from "@wave/client/db/sync";
import {
  filesGone,
  removeSongs,
  selectAlbumsMissingSongs,
  selectMissingSongs,
  signOut,
} from "@wave/client/db/missingSongs";
import {
  saveYtArtist,
  selectYtArtist,
  selectYtArtistSimilar,
  type YtArtistSimilar,
} from "@wave/client/db/ytArtists";
import {
  selectSongFindTexts,
  selectSongOrder,
  selectSongSummaries,
  selectSongsWithIds,
  selectSongsWithVideos,
  selectSortedSongs,
  type SongOrder,
  type SongSummary,
} from "@wave/client/db/songOrder";

import {
  selectSkippedFiles,
  skipFiles,
  unskipFiles,
  type SkippedFile,
} from "@wave/client/db/skippedFiles";

export class LibraryStoreError extends Data.TaggedError("LibraryStoreError")<{
  readonly operation: string;
  readonly cause: unknown;
}> {
  override get message(): string {
    return `Library store failed to ${this.operation}: ${String(this.cause)}`;
  }
}

export class LibraryStore extends Context.Service<
  LibraryStore,
  {
    /** Adds [path] as a scan root when there are no roots yet; returns the roots. */
    readonly ensureDefaultRoot: (
      path: string,
    ) => Effect.Effect<readonly ScanRoot[], LibraryStoreError>;
    /** Each shows-level artist's Ticketmaster attraction, country and last shows, and the show ids already notified. */
    readonly followShowCache: Effect.Effect<ReturnType<typeof readFollowShows>, LibraryStoreError>;
    /** Replaces one artist's saved shows (a new country replaces the old country's). */
    readonly saveFollowShows: (row: FollowShowCacheRow) => Effect.Effect<void, LibraryStoreError>;
    /** Claims a show for its one notification: false when it was already claimed. */
    readonly markShowNotified: (id: string) => Effect.Effect<boolean, LibraryStoreError>;
    readonly followReleaseCache: Effect.Effect<FollowReleaseCache, LibraryStoreError>;
    readonly saveFollowReleases: (
      key: string,
      releases: readonly FollowRelease[],
      checkedAt: number,
    ) => Effect.Effect<void, LibraryStoreError>;
    readonly hideFollowRelease: (key: string) => Effect.Effect<void, LibraryStoreError>;
    readonly followReleaseListening: (
      releases: readonly FollowRelease[],
    ) => Effect.Effect<ReturnType<typeof followReleaseListening>, LibraryStoreError>;
    readonly listFollows: Effect.Effect<readonly FollowedArtist[], LibraryStoreError>;
    readonly countFollows: Effect.Effect<number, LibraryStoreError>;
    readonly getFollow: (name: string) => Effect.Effect<FollowedArtist | null, LibraryStoreError>;
    readonly setFollow: (
      target: FollowTarget,
      level: FollowLevel,
    ) => Effect.Effect<void, LibraryStoreError>;
    readonly unfollow: (name: string) => Effect.Effect<void, LibraryStoreError>;
    /**
     * Puts back a follow as it was before an unfollow (its level and date),
     * unless the artist was followed again since.
     */
    readonly restoreFollow: (follow: FollowedArtist) => Effect.Effect<void, LibraryStoreError>;
    /** The follow keys of the follow suggestions the owner dismissed. */
    readonly dismissedFollowSuggestions: Effect.Effect<readonly string[], LibraryStoreError>;
    /** Dismisses the follow suggestion with follow key [key], for good. */
    readonly dismissFollowSuggestion: (key: string) => Effect.Effect<void, LibraryStoreError>;
    /** Undo after a dismissal: the artist can be suggested again. */
    readonly undoFollowSuggestionDismissal: (key: string) => Effect.Effect<void, LibraryStoreError>;
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
    /** Legacy complete input, retained for explicit desktop probes; production uses deferred pages. */
    readonly playlistRecommendationInput: (
      id: number,
    ) => Effect.Effect<PlaylistRecommendationInput, LibraryStoreError>;
    readonly recommendationFlagsPage: (
      after: number,
    ) => Effect.Effect<ReturnType<typeof recommendationFlagsPage>, LibraryStoreError>;
    readonly recommendationPendingPage: (
      after: number,
    ) => Effect.Effect<ReturnType<typeof recommendationPendingPage>, LibraryStoreError>;
    readonly recommendationEntriesPage: (
      id: number,
      after: RecommendationEntryCursor,
      includeTracks?: boolean,
    ) => Effect.Effect<ReturnType<typeof recommendationEntriesPage>, LibraryStoreError>;
    readonly recommendationFeedbackPage: (
      id: number,
      after: string | null,
    ) => Effect.Effect<ReturnType<typeof recommendationFeedbackPage>, LibraryStoreError>;
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
    /** Each of [songs]' `matchingSong`, in their order, in one read (a mix build's radio songs). */
    readonly matchingSongs: (
      songs: readonly YtSong[],
    ) => Effect.Effect<readonly (SongRow | null)[], LibraryStoreError>;
    readonly downloadsToForget: (
      jobs: readonly YtDownloadJournalJob[],
    ) => Effect.Effect<readonly string[], LibraryStoreError>;
    readonly listSongs: Effect.Effect<readonly SongRow[], LibraryStoreError>;
    /**
     * Library › Songs in [sort] as Track ids, with its A–Z spine and its
     * missing songs, without the rows' details (`songSummaries` reads those
     * for the rows on screen).
     */
    readonly listSortedSongs: (
      sort: LibrarySongSort,
    ) => Effect.Effect<readonly SongRow[], LibraryStoreError>;
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
    /** Every song of a genre, as full rows: what its menu acts on (its screen opens on `openGenre`). */
    readonly getGenre: (id: number) => Effect.Effect<GenreDetail | null, LibraryStoreError>;
    /**
     * What a genre's screen opens on (#601): its header and count, and the
     * first page of its songs in [sort], read by an index seek; null once
     * the genre is gone. `genreOrderSlice` reads the rest of its order.
     */
    readonly openGenre: (
      id: number,
      sort: LibrarySongSort,
    ) => Effect.Effect<GenreOpening | null, LibraryStoreError>;
    /**
     * The next stretch of a genre's order in [sort] from [cursor] (from the
     * start without one), as Track ids; null once the genre's order has
     * changed since the cursor's read, or the cursor isn't this genre's and sort's.
     */
    readonly genreOrderSlice: (
      id: number,
      sort: LibrarySongSort,
      cursor: GenreCursor | null,
    ) => Effect.Effect<GenreOrderSlice | null, LibraryStoreError>;

    /** The indexed files under [roots], for an incremental scan to skip the unchanged ones. */
    readonly knownFiles: (
      roots: readonly string[],
    ) => Effect.Effect<readonly IndexedKnownFile[], LibraryStoreError>;
    /** The voice notes and recordings under [roots] that scans left out, for the next one to pass over. */
    readonly skippedFiles: (
      roots: readonly string[],
    ) => Effect.Effect<readonly SkippedFile[], LibraryStoreError>;
    /**
     * Leaves [files] (voice notes and recordings) out of the Library: a song
     * indexed at one of them goes as Remove from Library takes it, never as a
     * missing song. Resolves to how many songs left.
     */
    readonly skipFiles: (files: readonly SkippedFile[]) => Effect.Effect<number, LibraryStoreError>;
    /** Forgets the skipped files at [paths]: gone, or music after all. */
    readonly unskipFiles: (paths: readonly string[]) => Effect.Effect<void, LibraryStoreError>;
    /** What identifies the indexed files at [paths] when they turn up elsewhere. */
    readonly indexedFiles: (
      paths: readonly string[],
    ) => Effect.Effect<readonly IndexedFile[], LibraryStoreError>;
    /**
     * The files at [paths] are gone (a scan no longer found them): signed in
     * to a Wave account their songs stay as missing songs, signed out they
     * leave the Library. Then the albums, artists, genres and folders left
     * without tracks go (also after tag changes, so call it once per scan).
     * With no files, it does nothing when nothing was written since it last ran.
     */
    readonly filesGone: (paths: readonly string[]) => Effect.Effect<void, LibraryStoreError>;
    /**
     * Takes these songs out of the Library and, signed in, out of the Wave
     * account (Remove from Library; Delete once their files are gone).
     * Their playlist entries stay, as songs without a file.
     */
    readonly removeSongs: (trackIds: readonly number[]) => Effect.Effect<void, LibraryStoreError>;
    /** Whether any of these songs is in a playlist (the Delete confirmation says they stay there). */
    readonly inPlaylists: (
      trackIds: readonly number[],
    ) => Effect.Effect<boolean, LibraryStoreError>;
    /** Entries belonging to journal songs or saved files, without opening each list. */
    readonly listDownloadMembers: (
      scope: ListDownloadsScope,
    ) => Effect.Effect<DownloadListMembers, LibraryStoreError>;
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
    readonly songsByIds: (
      ids: readonly number[],
    ) => Effect.Effect<readonly PlayableSongRow[], LibraryStoreError>;
    /**
     * What's known of the loudness of the songs [ids] (Normalize Volume), by
     * Track id: those with a file and a value; the others are left out.
     */
    /** Every Library song of a local album, for Normalize Volume completeness and priority. */
    readonly albumLoudness: (id: number) => Effect.Effect<AlbumLoudness | null, LibraryStoreError>;
    readonly songLoudness: (
      ids: readonly number[],
    ) => Effect.Effect<ReadonlyMap<number, SongLoudness>, LibraryStoreError>;
    /**
     * The songs among [ids], in their order, Normalize Volume should measure:
     * Library files without tags not measured, or tried, as they are now.
     */
    readonly songsToMeasure: (
      ids: readonly number[],
    ) => Effect.Effect<readonly SongToMeasure[], LibraryStoreError>;
    /**
     * Keeps what measuring [song] gave (null: it couldn't be measured); false
     * when its file changed meanwhile or it has tags now, and nothing was kept.
     */
    readonly saveMeasurement: (
      song: SongToMeasure,
      measurement: SongMeasurement,
    ) => Effect.Effect<boolean, LibraryStoreError>;
    /** The gain every Library song with a value plays at, for the typical gain (Core's `typicalGain`). */
    readonly libraryGains: Effect.Effect<readonly number[], LibraryStoreError>;
    /** Every Library file Normalize Volume should measure, oldest first, for the charging job. */
    readonly libraryToMeasure: Effect.Effect<readonly SongToMeasure[], LibraryStoreError>;
    /**
     * Keeps what the charging job measured, in one go; the Track ids kept,
     * leaving out files that changed since or have tags now.
     */
    readonly saveMeasurements: (
      measured: readonly MeasuredSong[],
    ) => Effect.Effect<readonly number[], LibraryStoreError>;
    /** All playable ids, without metadata or history, for Home's random Magic Queue grid. */
    readonly playableSongIds: Effect.Effect<readonly number[], LibraryStoreError>;
    /**
     * A page of the video ids of the playlists' YT Music entries, none the
     * Library has as a file, without decoding a song, for the same grid. Start
     * after 0; [next] is null past the last.
     */
    readonly playlistEntryVideoIdsPage: (
      after: number,
    ) => Effect.Effect<VideoPage<number>, LibraryStoreError>;
    /** Every page of `playlistEntryVideoIdsPage` in one read, each video once (#1351). */
    readonly playlistEntryVideoIds: Effect.Effect<readonly string[], LibraryStoreError>;
    /** The YT Music songs the playlists hold as these video ids, one per video, in no particular order. */
    readonly playlistEntrySongs: (
      videoIds: readonly string[],
    ) => Effect.Effect<readonly YtAlbumSong[], LibraryStoreError>;
    /** Whether a short Home row has another playable song to fill it (one id at most). */
    readonly hasPlayableSongOutside: (
      ids: readonly number[],
    ) => Effect.Effect<boolean, LibraryStoreError>;
    /**
     * The Library song [id] as it would leave the Library (Core's
     * `LeavingSong`: its video id, its credits split); null when it isn't there.
     */
    readonly leavingSong: (id: number) => Effect.Effect<LeavingSong | null, LibraryStoreError>;
    /** The YouTube video id each of the songs [ids] was downloaded from, by song id (those with one). */
    readonly videoIds: (
      ids: readonly number[],
    ) => Effect.Effect<ReadonlyMap<number, string>, LibraryStoreError>;
    /**
     * The song with a file here downloaded from the YouTube video [videoId]
     * (a song link's Library copy), or null.
     */
    readonly songWithVideo: (videoId: string) => Effect.Effect<SongRow | null, LibraryStoreError>;
    /** Downloaded Library copies of [videoIds], in one read, by video id. */
    readonly songsWithVideos: (
      videoIds: readonly string[],
    ) => Effect.Effect<ReadonlyMap<string, SongRow>, LibraryStoreError>;
    /** Each of the songs [ids]' counted plays, by song id (those with any). */
    readonly countedPlays: (
      ids: readonly number[],
    ) => Effect.Effect<ReadonlyMap<number, number>, LibraryStoreError>;
    /**
     * Each of the queue's songs [trackIds]' counted plays over all time, by
     * track id (those with any), streamed songs included and merged into the
     * Library song they are: what Smart Shuffle and a Magic Queue's seeds
     * weigh songs by.
     */
    readonly songCountedPlays: (
      trackIds: readonly string[],
    ) => Effect.Effect<ReadonlyMap<string, number>, LibraryStoreError>;
    /**
     * Each of the Library songs among [trackIds]' primary artist, genre and
     * album, by track id (those the Library has): what Even Shuffle orders by.
     */
    readonly shuffleSongs: (
      trackIds: readonly string[],
    ) => Effect.Effect<ReadonlyMap<string, ShuffleSong>, LibraryStoreError>;
    readonly loadPlayback: Effect.Effect<SavedPlayback | null, LibraryStoreError>;
    /** Saves the parts of the queue a change touched (Core's `queueWrite`). */
    readonly saveQueue: (write: QueueWrite) => Effect.Effect<void, LibraryStoreError>;
    readonly savePosition: (positionMs: number) => Effect.Effect<void, LibraryStoreError>;
    /** The playing track's links and artwork palette, for Now Playing; null once it's gone. */
    readonly nowPlayingSong: (
      target: PlayingSongTarget,
    ) => Effect.Effect<PlayingSongAnswer, LibraryStoreError>;
    readonly trackDetails: (id: number) => Effect.Effect<TrackDetails | null, LibraryStoreError>;
    /** The recent searches, newest first. */
    readonly listRecentSearches: Effect.Effect<readonly string[], LibraryStoreError>;
    /** Adds a search to the recent ones (see Core's `rememberSearch`); returns them, newest first. */
    readonly rememberSearch: (query: string) => Effect.Effect<readonly string[], LibraryStoreError>;
    readonly clearRecentSearches: Effect.Effect<void, LibraryStoreError>;
    /**
     * Keeps a found first-release date for a song without one; the song's file (null for a
     * missing song) when it went in, so the date is written there once (`releaseTagDate`).
     */
    readonly saveReleaseDate: (
      id: number,
      date: string,
    ) => Effect.Effect<{ readonly path: string | null } | null, LibraryStoreError>;
    /**
     * Keeps a release date the owner typed as the song's, whatever it had (null clears it, so
     * the lookup can find one again); the song's file (null for a missing song), for the date
     * to replace the file's too (`writeReleaseDateTag`). Null when the song is gone.
     */
    readonly saveTypedReleaseDate: (
      id: number,
      date: string | null,
    ) => Effect.Effect<{ readonly path: string | null } | null, LibraryStoreError>;
    /** Every playlist by name, with its mosaic. */
    readonly listPlaylists: Effect.Effect<readonly PlaylistRow[], LibraryStoreError>;
    /** When a song last played from each playlist, by playlist id (never played: absent). */
    readonly playlistsLastPlayed: Effect.Effect<ReadonlyMap<number, number>, LibraryStoreError>;
    /**
     * Each playlist's counted plays, those of the 14 days up to [now] apart
     * (never played: absent), for Core's `fromYourLibrary`.
     */
    readonly playlistPlays: (
      now: number,
    ) => Effect.Effect<readonly PlaylistPlays[], LibraryStoreError>;
    /** Every playlist's unsearched songs, top to bottom, for the background fill. */
    readonly unsearchedEntries: Effect.Effect<readonly PlaylistUnsearched[], LibraryStoreError>;
    /** A playlist with its YT Music entries and its Library songs in [scope]. */
    readonly playlistGraveyard: (
      id: number,
    ) => Effect.Effect<
      readonly (PlaylistEntryRow & { readonly removedAt: number })[],
      LibraryStoreError
    >;
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
    /** Saves a Recognize result at the top of the playlist remembered by sync id. */
    readonly addToShazam: (
      rememberedId: string | null,
      song: PlaylistSong,
      language: AppLanguage,
    ) => Effect.Effect<ReturnType<typeof addToShazam>, LibraryStoreError>;
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
    readonly restoreGraveyardItem: (
      playlistId: number,
      itemId: number,
    ) => Effect.Effect<void, LibraryStoreError>;
    readonly forgetGraveyardItems: (
      playlistId: number,
      itemId?: number,
    ) => Effect.Effect<void, LibraryStoreError>;
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
    /** Constant-size stamp of writes to what the taste reads (`db/tastePages.ts#watchTasteSources`). */
    readonly tasteRevision: Effect.Effect<string, LibraryStoreError>;
    /**
     * Re-files an upgrade's credits, keys its songs and their titles, and starts the taste
     * sources' write stamp: once, after the first screen settles, not while the layer builds.
     */
    readonly startupUpkeep: Effect.Effect<void, LibraryStoreError>;
    /** The ids of every starred track. */
    readonly favoriteTrackIds: Effect.Effect<readonly number[], LibraryStoreError>;
    /**
     * Stars (or unstars) the tracks; those starred already keep when they were starred.
     * A star removes its song's dislike: the keys of the dislikes removed come back.
     */
    readonly setFavorites: (
      trackIds: readonly number[],
      on: boolean,
    ) => Effect.Effect<readonly string[], LibraryStoreError>;
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
    /**
     * Keeps [songs] as disliked (Core's `DislikedSong`), each by its
     * `dislikeKey`; one disliked already keeps when it was.
     */
    readonly setDislikes: (
      songs: readonly Omit<DislikedSong, "dislikedAt">[],
    ) => Effect.Effect<void, LibraryStoreError>;
    /** Forgets the dislikes kept under [keys]. */
    readonly removeDislikes: (keys: readonly string[]) => Effect.Effect<void, LibraryStoreError>;
    /** Every dislike kept, the newest first. */
    readonly listDislikes: Effect.Effect<readonly DislikedSong[], LibraryStoreError>;
    /** The Library's songs the dislikes are about, each with its video (Core's `dislikedSongs` reads them). */
    readonly dislikedTracks: Effect.Effect<readonly DislikedTrack[], LibraryStoreError>;
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
      streamedSong?: YtAlbumSong,
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
    /** Counted plays with saved display metadata, newest first, 50 per page. */
    readonly listeningHistory: (
      before?: ListeningHistoryCursor,
      query?: string,
    ) => Effect.Effect<ListeningHistoryPage, LibraryStoreError>;
    /** The 50 plays newer than [after], for history opened at a moment. */
    readonly newerListeningHistory: (
      after: ListeningHistoryCursor,
    ) => Effect.Effect<ListeningHistoryPage, LibraryStoreError>;
    /** History opened at a moment: the 50 plays around [playId], it in the middle. */
    readonly listeningHistoryAround: (
      playId: number,
    ) => Effect.Effect<ListeningHistoryPage, LibraryStoreError>;
    /**
     * Each track's counted plays within [window] (tracks still in the library),
     * in no order; with [trackIds], only those tracks'.
     */
    readonly trackPlayTotals: (
      window: StatsWindow,
      trackIds?: readonly number[],
    ) => Effect.Effect<readonly PlayTotals[], LibraryStoreError>;
    /**
     * Each song's counted plays within [window], streamed songs included, in
     * no order: a streamed song the Library has (by video id or recording
     * key) is that Library song's entry.
     */
    readonly songPlayTotals: (
      window: StatsWindow,
    ) => Effect.Effect<readonly SongPlayTotals[], LibraryStoreError>;
    /** The streamed songs [videoIds] as their latest plays had them, by video id. */
    readonly streamedSongsByIds: (
      videoIds: readonly string[],
    ) => Effect.Effect<ReadonlyMap<string, YtAlbumSong>, LibraryStoreError>;
    /**
     * Counted plays within [window] per album and credited artist (deleted
     * songs included; a collaboration in a row for each artist it credits), in
     * no order; Core's `albumPlayTotals` / `artistPlayTotals` group them.
     */
    readonly playedEntityTotals: (
      window: StatsWindow,
    ) => Effect.Effect<PlayedEntityTotals, LibraryStoreError>;
    /** `playedEntityTotals`' artists alone, without reading albums. */
    readonly playedArtistTotals: (
      window: StatsWindow,
    ) => Effect.Effect<PlayedEntityTotals["artists"], LibraryStoreError>;
    /** What the owner keeps (Library songs and playlists), for a light listener's follow suggestions. */
    readonly keptArtistSongs: Effect.Effect<KeptSongs<PlayedArtist>, LibraryStoreError>;
    /**
     * The all-time counted plays streamed of each Library song they are now
     * (a download of the video, or the same recording), by its id.
     */
    readonly streamedLibraryPlays: Effect.Effect<ReadonlyMap<number, number>, LibraryStoreError>;
    readonly playedArtistSongs: (
      artistId: number,
      now: number,
    ) => Effect.Effect<PlayedArtistSongs, LibraryStoreError>;
    /**
     * What a Recap of [window] is computed from (Core's `recap`): its songs',
     * albums' and artists' counted plays, streamed plays included and credited
     * as Stats credits them, the songs' genres and the artists' first plays.
     */
    readonly recapPlays: (
      window: StatsWindow,
      includeStreamedGenres?: boolean,
    ) => Effect.Effect<RecapPlays, LibraryStoreError>;
    readonly creditedPlayTotals: (
      window: StatsWindow,
    ) => Effect.Effect<readonly CreditedPlayTotals[], LibraryStoreError>;
    /**
     * What the kept play totals owe (#1349: an upgrade's history, a changed
     * Library's credits) as steps for the scheduler's slices, each one
     * transaction at most; done once nothing is owed. A step's failure is
     * thrown from the steps.
     */
    readonly keptTotalsSteps: Effect.Effect<Generator<void, true>>;
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
    /** Changes after every committed listening write, including progress and each sync page. */
    readonly listeningHistoryVersion: Pick<ExternalStore<number>, "get" | "subscribe">;
    /**
     * Lets SQLite refresh its planner statistics, sampling a bounded number of rows: those
     * it lacks once Wave has `opened` (after migrations), and those this session's reads
     * made stale when `leaving` for the background (`optimizeDatabase`).
     */
    readonly optimize: (when: "opened" | "leaving") => Effect.Effect<void, LibraryStoreError>;
    /** Legacy whole-history quarter sums, retained as a semantic control; UI uses bounded pages. */
    readonly countedListening: Effect.Effect<readonly CountedListening[], LibraryStoreError>;
    /** At most 512 raw events per indexed read, with Core's historical quarter-hour projection. */
    readonly countedListeningPage: (
      after: number,
    ) => Effect.Effect<CountedListeningPage, LibraryStoreError>;
    /** A bounded page of history video ids with no completed genre lookup. */
    readonly pendingStreamedGenres: (
      after: string,
    ) => Effect.Effect<readonly string[], LibraryStoreError>;
    /** Keeps a Deezer answer, including a permanent null miss, on this phone only. */
    readonly keepStreamedGenre: (
      videoId: string,
      genre: string | null,
    ) => Effect.Effect<void, LibraryStoreError>;
    /** Candidate catalog songs due for local mood feature lookup. */
    readonly pendingDjMoodSongs: (
      after: string,
      now: number,
    ) => Effect.Effect<DjMoodLookupPage, LibraryStoreError>;
    /** Keeps feature matches permanently and misses for their retry window. */
    readonly keepDjMoodFeatures: (
      writes: readonly DjMoodFeatureWrite[],
    ) => Effect.Effect<void, LibraryStoreError>;
    /** Cached ReccoBeats features by YouTube video id. */
    readonly djMoodFeatures: (
      videoIds: readonly string[],
    ) => Effect.Effect<
      ReadonlyMap<string, import("@wave/core").DjAudioFeatures>,
      LibraryStoreError
    >;
    /** Library songs with an ISRC tag due for a mood feature lookup, after Track [afterTrackId]. */
    readonly pendingDjLibraryMoodSongs: (
      afterTrackId: number,
      now: number,
    ) => Effect.Effect<readonly DjLibraryMoodSong[], LibraryStoreError>;
    /** Keeps Library songs' feature matches for their ISRC, and misses for their retry window. */
    readonly keepDjLibraryMoodFeatures: (
      writes: readonly DjLibraryMoodFeatureWrite[],
    ) => Effect.Effect<void, LibraryStoreError>;
    /** Library songs' cached ReccoBeats features, by Track id as Core's candidates name it. */
    readonly djLibraryMoodFeatures: () => Effect.Effect<
      ReadonlyMap<string, import("@wave/core").DjAudioFeatures>,
      LibraryStoreError
    >;
    /** Library tags and cached streamed answers by ranking id; pass the Fix songs online setting. */
    readonly songGenres: (
      ids: readonly (number | string)[],
      includeStreamedGenres?: boolean,
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
      input: Omit<SyncCycleInput, "db" | "splits" | "historyChanged">,
    ) => Effect.Effect<SyncCycleResult, LibraryStoreError>;
    /**
     * Signed out: the Library leaves the account (the next sign-in joins
     * anew) and its missing songs go (`signOut`).
     */
    readonly leaveAccount: Effect.Effect<void, LibraryStoreError>;
    /**
     * Syncs the collaborative playlist [playlistId] alone, for its page in sight
     * (`syncCollaborativePlaylist`): nothing for an ordinary playlist.
     */
    readonly syncCollaborativePlaylist: (
      input: Omit<SyncCycleInput, "db" | "splits" | "historyChanged">,
      playlistId: number,
    ) => Effect.Effect<SyncCycleResult, LibraryStoreError>;
    /** The playlist [playlistId] was opened: its changed mark goes, on this device. */
    readonly markCollaborationSeen: (playlistId: number) => Effect.Effect<void, LibraryStoreError>;
    /** The playlists that became the member's own copy and whose page hasn't said so yet. */
    readonly privateCopyNotices: Effect.Effect<readonly number[], LibraryStoreError>;
    /** The page of [playlistId] said once that it is now the member's own copy. */
    readonly dismissPrivateCopyNotice: (
      playlistId: number,
    ) => Effect.Effect<void, LibraryStoreError>;
    /**
     * The playlist here of the collaborative playlist [syncId] (an invite just joined); null
     * while no pull has brought it.
     */
    readonly joinedPlaylistId: (syncId: string) => Effect.Effect<number | null, LibraryStoreError>;
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
    /** A page of existing Library files whose lyrics have not been indexed yet. */
    readonly lyricsIndexPage: (
      afterId: number,
      limit: number,
    ) => Effect.Effect<readonly LyricsIndexTarget[], LibraryStoreError>;
    /** Current file and has-lyrics flag for a track changed by a scan or tag write. */
    readonly lyricsIndexTarget: (
      trackId: number,
    ) => Effect.Effect<LyricsIndexTarget | null, LibraryStoreError>;
    /** A bounded page of indexed rows whose file/lyrics flag became stale. */
    readonly staleLyricsIndexPage: (
      afterId: number,
      limit: number,
    ) => Effect.Effect<readonly LyricsIndexTarget[], LibraryStoreError>;
    /** Track id currently using a file path, if any. */
    readonly lyricsTrackIdAtPath: (path: string) => Effect.Effect<number | null, LibraryStoreError>;
    /**
     * Stores timestamp-free lyrics and their searchable word positions, local to
     * this phone. Empty lyrics mark the file checked; null removes the song.
     */
    readonly keepLyricsSearchText: (
      trackId: number,
      lyrics: string | null,
    ) => Effect.Effect<void, LibraryStoreError>;
    /** Indexed phrase candidates; Core finds their matching line and highlight ranges. */
    readonly searchLyrics: (
      query: string,
    ) => Effect.Effect<readonly LyricsCandidate[], LibraryStoreError>;
    /** Indexed saved streamed-song lyrics that may contain [query]. */
    readonly searchSavedLyrics: (
      query: string,
    ) => Effect.Effect<readonly SavedLyricsCandidate[], LibraryStoreError>;
    /** A bounded page of found saved lyrics still to backfill into Search. */
    readonly savedLyricsSearchIndexPage: (
      afterVideoId: string,
      limit: number,
    ) => Effect.Effect<readonly SavedLyricsCandidate[], LibraryStoreError>;
    /** Adds a pre-migration saved lyric to Search's word index. */
    readonly indexSavedLyricsSearchText: (
      candidate: SavedLyricsCandidate,
    ) => Effect.Effect<void, LibraryStoreError>;
    /**
     * Every YT Music song the owner streamed before streamed plays were
     * recorded (the old counter), with how often and when first.
     */
    readonly streamedSongs: Effect.Effect<readonly StreamedSong[], LibraryStoreError>;
    /** The playlists' entries that aren't Library songs, with when each was added (Home's mixes). */
    readonly playlistedSongs: Effect.Effect<readonly MixPlaylistEntry[], LibraryStoreError>;
    /**
     * The videos of the songs streamed, in a playlist, or downloaded and
     * played or in a playlist: a mix's re-blend leaves its new songs among
     * them out (Core's `discoverMixKeep`).
     */
    readonly knownVideos: Effect.Effect<readonly string[], LibraryStoreError>;
    /** A page of `knownVideos`: what the app reads, so a long list doesn't hold the JavaScript thread. */
    readonly knownVideosPage: (
      cursor: KnownVideosCursor,
    ) => Effect.Effect<VideoPage<KnownVideosCursor>, LibraryStoreError>;
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
    /** Artist identity only; unused orphan identities cannot affect the song mapper. */
    readonly tasteArtistsPage: (
      after: number,
    ) => Effect.Effect<ReturnType<typeof tasteArtistsPage>, LibraryStoreError>;
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
    /** A page of the streamed plays' kept totals (`streamed_totals`), by rowid. */
    readonly mixStreamedPlaysPage: (
      after: number,
    ) => Effect.Effect<ReturnType<typeof mixStreamedPlaysPage>, LibraryStoreError>;
    /** A page of the Library's credits as written, by track id, to split streamed credits with. */
    readonly mixCreditNamesPage: (
      after: number,
    ) => Effect.Effect<ReturnType<typeof mixCreditNamesPage>, LibraryStoreError>;
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
    /**
     * Home's mix build reads each source whole, one read a source, off the JS
     * thread (#1351): the same rows, in the same order, as all of its pages.
     */
    readonly mixSongs: Effect.Effect<ReturnType<typeof mixSongs>, LibraryStoreError>;
    readonly mixArtists: Effect.Effect<ReturnType<typeof mixArtists>, LibraryStoreError>;
    /** Each Library song's counted plays started by [now], summed (`mixHistoryPage`'s rows). */
    readonly mixPlayTotals: (
      now: number,
    ) => Effect.Effect<ReturnType<typeof mixPlayTotals>, LibraryStoreError>;
    /** The recording keys of the Library songs' plays, each once. */
    readonly mixPlayedRecordingKeys: Effect.Effect<readonly string[], LibraryStoreError>;
    readonly mixCredits: Effect.Effect<ReturnType<typeof mixCredits>, LibraryStoreError>;
    readonly mixStreamedPlays: Effect.Effect<
      ReturnType<typeof mixStreamedPlays>,
      LibraryStoreError
    >;
    readonly mixCreditNames: Effect.Effect<readonly string[], LibraryStoreError>;
    readonly mixStreamed: Effect.Effect<ReturnType<typeof mixStreamed>, LibraryStoreError>;
    readonly mixPlaylisted: Effect.Effect<ReturnType<typeof mixPlaylisted>, LibraryStoreError>;
    /** The whole candidate catalog, and its radios, each as one page. */
    readonly mixCatalog: Effect.Effect<ReturnType<typeof mixCatalog>, LibraryStoreError>;
    readonly graphRadios: Effect.Effect<ReturnType<typeof graphRadios>, LibraryStoreError>;
    readonly graphSimilarPage: (
      after: string | null,
    ) => Effect.Effect<GraphPage<YtArtistSimilar, string>, LibraryStoreError>;
    readonly graphPlayPage: (
      after: GraphPlayCursor,
    ) => Effect.Effect<GraphPage<GraphPlay, GraphPlayCursor>, LibraryStoreError>;
    /** Every play as the artist graph reads it, in one read (Home's mix build, #1351). */
    readonly graphPlays: Effect.Effect<readonly GraphPlay[], LibraryStoreError>;
    readonly candidateCatalog: Effect.Effect<readonly CatalogSong[], LibraryStoreError>;
    /**
     * Every saved YT Music artist page's artist with who "Fans might also
     * like", in the page's order (the artist graph's similar artists).
     */
    readonly ytArtistSimilar: Effect.Effect<readonly YtArtistSimilar[], LibraryStoreError>;
    /** The account's collaborative playlists on this device, as their menu reads and writes them. */
    readonly collaborations: CollaborationStore<LibraryStoreError>;
  }
>()("@wave/mobile/library/LibraryStore") {}

/**
 * A settle step's size: summing or crediting 2 songs, seeding 250 of an
 * upgrade's plays, or counting again 24 days a write to the history marked
 * owed, one transaction each. At 12,000 songs on the desktop each
 * takes under 8 ms (`bench/keptPlayTotals.ts`).
 */
const KEPT_TOTALS_STEP = { songs: 2, plays: 250, days: 24 };

/** A synchronous write on the JS thread, named for the block log (`runLibraryWrite`). */
const writeAttempt = <A>(operation: string, run: () => A): Effect.Effect<A, LibraryStoreError> =>
  Effect.try({
    try: () => runLibraryWrite(operation, run),
    catch: (cause) => new LibraryStoreError({ operation, cause }),
  });

const now = () => performance.now();

const make = Effect.gen(function* () {
  const db = yield* ClientDatabase;
  // Library reads leave the JS thread on the read connections (#1348).
  const { reads } = yield* SqliteDriver;
  // Callers asking for the same read at once share one replay (#1452).
  const replays = reads === undefined ? undefined : sharedReplays(reads, now);

  // A read on this connection, on the JS thread: tests and desktop benches, the reads
  // that must finish in their task (`SyncLibraryReads`) and the few that can't replay.
  const readHere = <A>(
    operation: string,
    run: (db: LibraryDatabase) => A,
    rows?: (result: A) => number,
  ): A => timeLibraryRead(operation, () => run(db), rows);

  const readOffThread = async <A>(
    replay: NonNullable<typeof replays>,
    operation: string,
    run: (db: LibraryDatabase) => A,
    rows?: (result: A) => number,
  ): Promise<A> => {
    let replayed: ReplayedRead<A>;
    try {
      replayed = await replay(run);
    } catch (cause) {
      // The synchronous read is the reference: it gives the result, or the error, it
      // always did. A read that can't replay is named once in the app log.
      if (cause instanceof NotReplayable) readsHere(operation, cause);
      return readHere(operation, run, rows);
    }
    heldLibraryRead(operation, replayed.heldMs, replayed.value, rows);
    return replayed.value;
  };

  // A read whose working out is Core's steps (#1451): off the thread, the statements
  // replay, then the steps run in replay slices, so the work holds the thread no longer
  // than its rows' mapping. On this connection, the read and its steps run whole.
  const readSteppedOffThread = async <R, A>(
    replay: NonNullable<typeof replays>,
    operation: string,
    read: (db: LibraryDatabase) => R,
    steps: (read: R) => Generator<void, A>,
    rows?: (result: A) => number,
  ): Promise<A> => {
    let replayed: ReplayedRead<R>;
    try {
      replayed = await replay(read);
    } catch (cause) {
      if (cause instanceof NotReplayable) readsHere(operation, cause);
      return readHere(operation, (here) => finishSteps(steps(read(here))), rows);
    }
    const worked = await finishReplaySteps(steps(replayed.value), now);
    heldLibraryRead(operation, replayed.heldMs + worked.heldMs, worked.value, rows);
    return worked.value;
  };

  // Every read shares this boundary: [run] reads through the database it's handed, which
  // each read names `db` too, so the main connection is out of its reach.
  // Row counts are inspected only on the slow path; named bundles count the rows
  // they actually returned.
  const attempt = <A>(
    operation: string,
    run: (db: LibraryDatabase) => A,
    rows?: (result: A) => number,
  ): Effect.Effect<A, LibraryStoreError> =>
    Effect.flatMap(Effect.service(SyncLibraryReads), (here) =>
      here || replays === undefined
        ? Effect.try({
            try: () => readHere(operation, run, rows),
            catch: (cause) => new LibraryStoreError({ operation, cause }),
          })
        : Effect.tryPromise({
            try: () => readOffThread(replays, operation, run, rows),
            catch: (cause) => new LibraryStoreError({ operation, cause }),
          }),
    );
  // `attempt` for a read whose working out runs in steps (`readSteppedOffThread`).
  const attemptStepped = <R, A>(
    operation: string,
    read: (db: LibraryDatabase) => R,
    steps: (read: R) => Generator<void, A>,
    rows?: (result: A) => number,
  ): Effect.Effect<A, LibraryStoreError> =>
    Effect.flatMap(Effect.service(SyncLibraryReads), (here) =>
      here || replays === undefined
        ? Effect.try({
            try: () => readHere(operation, (d) => finishSteps(steps(read(d))), rows),
            catch: (cause) => new LibraryStoreError({ operation, cause }),
          })
        : Effect.tryPromise({
            try: () => readSteppedOffThread(replays, operation, read, steps, rows),
            catch: (cause) => new LibraryStoreError({ operation, cause }),
          }),
    );
  // The Library's credits and their splitter, kept between saves.
  const splits = creditSplits();
  // Every write on this connection and others, as SQLite counts them: a scan's cleanup
  // (`filesGone`) with nothing written since the last one has nothing left to do.
  const writes = () => databaseWrites(db);
  // Null until this process cleans up: a save before it started may have left something.
  let prunedAt: string | null = null;
  // The taste sources' write stamp, made on its first read or by the upkeep, whichever is first.
  let tasteWatched = false;
  const watchTaste = Effect.try({
    try: () => {
      if (tasteWatched) return;
      watchTasteSources(db);
      tasteWatched = true;
    },
    catch: (cause) => new LibraryStoreError({ operation: "watch the taste sources", cause }),
  });
  // After the upgrade that brought credits in, the Library is re-filed under each credited
  // artist from the tags already stored (no rescan); after the one that brought Wave accounts
  // in, every song (and its plays) gets its recording key and its titles. All three stay in the
  // opening: matching a song and recovering downloads read them, and once done they cost under
  // 3 ms together (the first title pass after its update is the one slow run).
  yield* Effect.try({
    try: () => relinkCreditsIfUnlinked(db, splits),
    catch: (cause) => new LibraryStoreError({ operation: "split artist credits", cause }),
  });
  yield* Effect.try({
    try: () => keyRecordings(db),
    catch: (cause) => new LibraryStoreError({ operation: "key the Library's songs", cause }),
  });
  yield* Effect.tryPromise({
    try: () => backfillRecordingTitles(db),
    catch: (cause) => new LibraryStoreError({ operation: "key recording titles", cause }),
  });
  // The taste sources' write stamp used to be made while the first `appRuntime` use built this
  // layer, on the JS thread before the first screen (#1359): a startup job makes it once the
  // first screen settles (`app/_layout.tsx`, "libraryUpkeep"), or the first taste read does.
  let upkept = false;
  const startupUpkeep = Effect.gen(function* () {
    if (upkept) return;
    upkept = true;
    yield* watchTaste;
  });

  const listeningHistoryVersion = makeExternalStore(0);
  const historyChanged = () => listeningHistoryVersion.update((value) => value + 1);
  const historyWrite = <A>(operation: string, run: () => A) =>
    writeAttempt(operation, run).pipe(Effect.tap(() => Effect.sync(historyChanged)));

  return LibraryStore.of({
    followShowCache: attempt("read shows", (db) => readFollowShows(db)),
    saveFollowShows: (row) => writeAttempt("save shows", () => saveFollowShows(db, row)),
    markShowNotified: (id) =>
      writeAttempt("claim show", () => markShowNotified(db, id, Date.now())).pipe(
        Effect.tap((claimed) => Effect.sync(() => claimed && followSaved())),
      ),
    followReleaseCache: attempt("read follow release cache", (db) => readFollowReleases(db)),
    saveFollowReleases: (key, releases, checkedAt) =>
      writeAttempt("save follow releases", () => saveFollowReleases(db, key, releases, checkedAt)),
    hideFollowRelease: (key) =>
      writeAttempt("hide follow release", () => hideFollowRelease(db, key, Date.now())).pipe(
        Effect.tap(() => Effect.sync(followSaved)),
      ),
    followReleaseListening: (releases) =>
      attempt("read release listening", (db) => followReleaseListening(db, releases)),
    listFollows: attempt("list follows", (db) => selectFollows(db)),
    countFollows: attempt("count follows", (db) => countFollows(db)),
    getFollow: (name) => attempt("read follow", (db) => selectFollow(db, name)),
    setFollow: (target, level) =>
      writeAttempt("follow artist", () => saveFollow(db, target, level, Date.now())).pipe(
        Effect.tap((changed) => Effect.sync(() => changed && followSaved())),
        Effect.asVoid,
      ),
    unfollow: (name) =>
      writeAttempt("unfollow artist", () => removeFollow(db, name, Date.now())).pipe(
        Effect.tap(() => Effect.sync(followSaved)),
      ),
    restoreFollow: (follow) =>
      writeAttempt("restore follow", () => restoreFollow(db, follow, Date.now())).pipe(
        Effect.tap((changed) => Effect.sync(() => changed && followSaved())),
        Effect.asVoid,
      ),
    dismissedFollowSuggestions: attempt("read dismissed suggestions", (db) =>
      selectDismissedFollowSuggestions(db),
    ),
    dismissFollowSuggestion: (key) =>
      writeAttempt("dismiss suggestion", () => dismissFollowSuggestion(db, key, Date.now())).pipe(
        Effect.tap(() => Effect.sync(followSaved)),
      ),
    undoFollowSuggestionDismissal: (key) =>
      writeAttempt("undo suggestion dismissal", () =>
        undoFollowSuggestionDismissal(db, key, Date.now()),
      ).pipe(Effect.tap(() => Effect.sync(followSaved))),
    listeningHistoryVersion,
    optimize: (when) => writeAttempt("optimize the database", () => optimizeDatabase(db, when)),
    ensureDefaultRoot: (path) =>
      writeAttempt("set up scan roots", () => ensureDefaultRoot(db, path)),

    listRoots: attempt("list music folders", (db) => listRoots(db)),

    addRoot: (path, drop) => writeAttempt("add a music folder", () => addRoot(db, path, drop)),

    removeRoot: (path) =>
      writeAttempt("remove a music folder", () => removeRootSync(db, splits, path)),

    excludedFolders: attempt("read excluded folders", (db) => excludedFolders(db)),

    saveBatch: (tracks, artworkRows, moves = [], options) =>
      writeAttempt("save scanned tracks", () =>
        saveBatch(db, splits, tracks, artworkRows, moves, Date.now(), options),
      ).pipe(Effect.tap(() => Effect.sync(() => publishSavedRecordings(tracks)))),

    linkPlaylistEntries: writeAttempt("link playlist entries", () => linkEntries(db, Date.now())),

    playlistEntriesRevision: attempt("read the playlists' revision", (db) =>
      selectPlaylistEntriesRevision(db),
    ),

    hasUnscannedRoot: (roots) =>
      attempt("read which folders were scanned", (db) => hasUnscannedRoot(db, roots)),

    markScanned: (roots, at) =>
      writeAttempt("record the scan", () => {
        if (roots.length === 0) return;
        const pruned = prunedAt !== null && prunedAt === writes();
        markScanned(db, roots, at);
        // When a scan ends: nothing the cleanup reads, so the Library stays cleaned up.
        if (pruned) prunedAt = writes();
      }),

    countTracks: attempt("count tracks", (db) => countTracks(db)),

    countLibrary: attempt("count the library", (db) => libraryCounts(db)),
    countSectionSongs: attempt("count the library's songs", (db) => sectionSongCounts(db)),
    measureScale: attempt("measure the library", (db) => libraryScale(db)),

    playlistRecommendationInput: (id) =>
      attempt(
        "read playlist recommendations",
        (db) => selectPlaylistRecommendationInput(db, id),
        (result) =>
          result.playlist.length +
          result.librarySongs.length +
          result.favoriteVideos.size +
          result.feedback.length,
      ),
    recommendationFlagsPage: (after) =>
      attempt("read recommendation page", (db) => recommendationFlagsPage(db, after)),
    recommendationPendingPage: (after) =>
      attempt("read recommendation page", (db) => recommendationPendingPage(db, after)),
    recommendationEntriesPage: (id, after, includeTracks) =>
      attempt("read recommendation page", (db) =>
        recommendationEntriesPage(db, id, after, includeTracks),
      ),
    recommendationFeedbackPage: (id, after) =>
      attempt("read recommendation page", (db) => recommendationFeedbackPage(db, id, after)),
    dismissPlaylistRecommendation: (id, offer) =>
      writeAttempt("save playlist dismissal", () =>
        dismissPlaylistRecommendation(db, id, offer, Date.now()),
      ),
    acceptPlaylistRecommendation: (id, offer) =>
      writeAttempt("add playlist recommendation", () =>
        acceptPlaylistRecommendation(db, id, offer, Date.now()),
      ),
    matchingSong: (song) => attempt("read matching song", (db) => selectMatchingSong(db, song)),
    matchingSongs: (songs) =>
      attempt("read matching songs", (db) => selectMatchingSongs(db, songs)),
    downloadsToForget: (jobs) =>
      attempt("read downloaded files", (db) => selectDownloadsToForget(db, jobs)),
    listSongs: attempt("list songs", (db) => listSongs(db)),

    listSortedSongs: (sort) => attempt("list sorted songs", (db) => selectSortedSongs(db, sort)),
    listSongOrder: (sort) =>
      attempt(
        "order songs",
        (db) => selectSongOrder(db, sort),
        (result) => result.ids.length,
      ),

    songFindTexts: attempt("read songs to find", (db) => selectSongFindTexts(db)),

    songSummaries: (ids) => attempt("read songs", (db) => selectSongSummaries(db, ids)),

    songsWithIds: (ids) => attempt("read songs", (db) => selectSongsWithIds(db, ids)),

    listLibraryLookupSongs: attempt("list songs to look up", (db) => selectLibraryLookupSongs(db)),

    listSongGenres: attempt("list song genres", (db) => selectSongGenres(db)),

    nowPlayingSong: (target) =>
      attempt("read the Now Playing song", (db) => selectNowPlayingSong(db, target)),

    trackDetails: (id) => attempt("read the playing track", (db) => trackDetails(db, id)),

    listAlbums: attempt("list albums", (db) => selectAlbums(db, undefined)),

    listAlbumsPage: (page) =>
      attempt("list albums", (db) => selectAlbums(db, undefined, page, "files")),

    artistNamesForLink: (after) =>
      attempt("read artist link names", (db) => selectArtistNamesForLink(db, after)),

    listArtists: attempt("list artists", (db) => listArtistsSync(db)),

    listArtistsPage: (page) =>
      attempt("list artists", (db) => selectArtists(db, { page, scope: "files" })),

    listArtistSongsPage: (id, page) =>
      attempt("list the artist's songs", (db) => selectArtistSongs(db, id, page, "files")),

    listPlaylistEntriesPage: (id, page) =>
      attempt("list the playlist's songs", (db) => selectPlaylistEntries(db, id, page, "files")),

    artistCovers: (ids) => attempt("load artist covers", (db) => selectArtistCovers(db, ids)),

    listGenres: attempt("list genres", (db) => listGenres(db)),

    getAlbum: (id, scope) =>
      attempt(
        "open the album",
        (db) => selectAlbumDetail(db, id, scope),
        (result) => (result === null ? 0 : 1 + result.tracks.length),
      ),

    getArtist: (id, scope) =>
      attempt(
        "open the artist",
        (db) => selectArtistDetail(db, id, scope),
        (result) =>
          result === null
            ? 0
            : 1 + result.albums.length + result.appearsOn.length + result.songs.length,
      ),

    openGenre: (id, sort) =>
      attempt(
        "open the genre",
        (db) => selectGenreOpening(db, id, sort),
        (result) => (result === null ? 0 : 1 + result.songs.length),
      ),

    genreOrderSlice: (id, sort, cursor) =>
      attempt(
        "order the genre",
        (db) => selectGenreOrderSlice(db, id, sort, cursor),
        (result) => result?.ids.length ?? 0,
      ),

    getGenre: (id) =>
      attempt(
        "read the genre's songs",
        (db) => getGenreSync(db, id),
        (result) => (result === null ? 0 : 1 + result.songs.length),
      ),

    knownFiles: (roots) => attempt("read the library index", (db) => selectKnownFiles(db, roots)),
    skippedFiles: (roots) =>
      attempt("read skipped voice notes", (db) => selectSkippedFiles(db, roots)),
    skipFiles: (files) =>
      writeAttempt("skip voice notes", () => skipFiles(db, splits, files, Date.now())),
    unskipFiles: (paths) =>
      writeAttempt("forget skipped voice notes", () => unskipFiles(db, paths)),

    indexedFiles: (paths) => attempt("read missing files", (db) => indexedFiles(db, paths)),

    filesGone: (paths) =>
      writeAttempt("update songs whose files are gone", () => {
        if (paths.length === 0 && prunedAt === writes()) return;
        filesGone(db, splits, paths, Date.now());
        prunedAt = writes();
      }),

    removeSongs: (trackIds) =>
      writeAttempt("remove songs from the library", () =>
        removeSongs(db, splits, trackIds, Date.now()),
      ),
    inPlaylists: (trackIds) =>
      attempt("read whether songs are in playlists", (db) => selectInPlaylists(db, trackIds)),
    listDownloadMembers: (scope) =>
      attempt("read download list membership", (db) => selectListDownloadMembers(db, scope)),
    missingSongs: (trackIds) =>
      attempt("read missing songs", (db) => selectMissingSongs(db, trackIds)),
    albumsMissingSongs: (albumIds) =>
      attempt("read albums' missing songs", (db) => selectAlbumsMissingSongs(db, albumIds)),

    addExcludedFolder: (path, drop) =>
      writeAttempt("exclude a folder", () => addExcludedFolder(db, path, drop)),

    removeExcludedFolder: (path) =>
      writeAttempt("include a folder again", () => {
        removeExcludedFolder(db, path);
      }),

    hasPlayableSongOutside: (ids) =>
      attempt("probe Home pick growth", (db) => hasPlayableSongOutside(db, ids)),

    playableSongIds: attempt("read Home seed ids", (db) => selectPlayableSongIds(db)),
    playlistEntryVideoIdsPage: (after) =>
      attempt("read a page of Home's playlist seed ids", (db) =>
        selectPlaylistEntryVideoIdsPage(db, after),
      ),
    playlistEntryVideoIds: attempt("read Home's playlist seed ids", (db) =>
      selectPlaylistEntryVideoIds(db),
    ),
    playlistEntrySongs: (videoIds) =>
      attempt("read Home's playlist seeds", (db) => selectPlaylistEntrySongs(db, videoIds)),

    songsByIds: (ids) =>
      attempt("read queued songs", (db) => selectPlayableSongs(db, ids).filter(songHasFile)),
    albumLoudness: (id) => attempt("read the album loudness", (db) => selectAlbumLoudness(db, id)),
    songLoudness: (ids) => attempt("read the songs' loudness", (db) => selectSongLoudness(db, ids)),
    songsToMeasure: (ids) =>
      attempt("read the songs to measure", (db) => selectSongsToMeasure(db, ids)),
    saveMeasurement: (song, measurement) =>
      writeAttempt("save a song's measurement", () => saveMeasurement(db, song, measurement)),
    libraryGains: attempt("read the Library's gains", (db) => selectLibraryGains(db)),
    libraryToMeasure: attempt("read the Library's songs to measure", (db) =>
      selectLibraryToMeasure(db),
    ),
    saveMeasurements: (measured) =>
      writeAttempt("save the songs' measurements", () => saveMeasurements(db, measured)),

    leavingSong: (id) => attempt("read the song leaving", (db) => selectLeavingSong(db, id)),
    videoIds: (ids) => attempt("read the songs' video ids", (db) => selectVideoIds(db, ids)),
    songWithVideo: (videoId) =>
      attempt("read the song of a video", (db) => {
        const id = selectSongWithVideo(db, videoId);
        return id === null ? null : (selectSongsWithIds(db, [id])[0] ?? null);
      }),
    songsWithVideos: (videoIds) =>
      attempt("read the songs of videos", (db) => selectSongsWithVideos(db, videoIds)),
    countedPlays: (ids) =>
      attempt("read the songs' counted plays", (db) => selectCountedPlays(db, ids)),
    songCountedPlays: (trackIds) =>
      attempt("read the songs' counted plays", (db) => songCountedPlays(db, trackIds)),
    shuffleSongs: (trackIds) =>
      attempt("read the songs' artists, genres and albums", (db) => shuffleSongs(db, trackIds)),

    loadPlayback: attempt("read the saved queue", (db) => loadPlayback(db)),

    saveQueue: (write) => writeAttempt("save the queue", () => savePlayback(db, write, Date.now())),

    savePosition: (positionMs) =>
      writeAttempt("save the playback position", () =>
        savePlayback(db, { positionMs }, Date.now()),
      ),

    listRecentSearches: attempt("read recent searches", (db) => listRecentSearchesSync(db)),

    rememberSearch: (query) =>
      writeAttempt("save the search", () => rememberSearchSync(db, query, Date.now())),

    clearRecentSearches: writeAttempt("clear recent searches", () => {
      clearRecentSearches(db);
    }),

    saveReleaseDate: (id, date) =>
      attempt("save release date", (db) => saveReleaseDate(db, id, date)),
    saveTypedReleaseDate: (id, date) =>
      attempt("save typed release date", (db) => saveTypedReleaseDate(db, id, date)),
    listPlaylists: attempt("list playlists", (db) => selectPlaylists(db)),

    playlistsLastPlayed: attempt("read when playlists last played", (db) =>
      selectPlaylistsLastPlayed(db),
    ),

    playlistPlays: (now) =>
      attempt("count the playlists' plays", (db) => selectPlaylistPlays(db, now)),

    unsearchedEntries: attempt("read the playlists' unsearched songs", (db) =>
      selectUnsearchedEntries(db),
    ),

    playlistGraveyard: (id) =>
      attempt("read the playlist graveyard", (db) => selectPlaylistGraveyard(db, id)),

    getPlaylist: (id, scope) =>
      attempt(
        "open the playlist",
        (db) => selectPlaylist(db, id, scope),
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
      attempt("read the playlist's image", (db) => selectPlaylistImageOriginal(db, id)),

    removePlaylistImage: (id) =>
      writeAttempt("remove the playlist's image", () => removePlaylistImage(db, id)),

    takeDeletedPlaylistImages: writeAttempt("tidy deleted playlists' images", () =>
      takeDeletedPlaylistImages(db),
    ),

    addToPlaylist: (id, songs) =>
      writeAttempt("add to the playlist", () => addToPlaylist(db, id, songs, Date.now())),

    addToShazam: (rememberedId, song, language) =>
      writeAttempt("add to Shazam", () =>
        addToShazam(db, rememberedId, song, Date.now(), language),
      ),

    movePlaylistItem: (playlistId, itemId, toIndex) =>
      writeAttempt("reorder the playlist", () =>
        movePlaylistItem(db, playlistId, itemId, toIndex, Date.now()),
      ),

    removePlaylistItems: (playlistId, itemIds) =>
      writeAttempt("remove from the playlist", () =>
        removePlaylistItems(db, playlistId, itemIds, Date.now()),
      ),

    restoreGraveyardItem: (playlistId, itemId) =>
      writeAttempt("restore a Graveyard song", () =>
        restoreGraveyardItem(db, playlistId, itemId, Date.now()),
      ),
    forgetGraveyardItems: (playlistId, itemId) =>
      writeAttempt("forget Graveyard songs", () =>
        forgetGraveyardItems(db, playlistId, itemId, Date.now()),
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

    trackPaths: attempt("read the library's files", (db) => selectTrackPaths(db)),

    importTracks: attempt("read the library's songs", (db) => selectImportTracks(db)),

    importedPlays: attempt("read the imported plays", (db) => importedPlays(db)),

    saveImportedPlays: (plays) =>
      historyWrite("save the imported plays", () => saveImportedPlays(db, plays)),

    playedRecordingKeys: attempt("read the songs played", (db) => playedRecordingKeys(db)),

    tasteHistory: attempt(
      "read the taste history",
      (db) => tasteHistory(db),
      (result) => result.plays.length + result.favorites.length + result.downloads.length,
    ),

    tasteRevision: Effect.flatMap(watchTaste, () =>
      attempt("read the taste source revision", (db) => tasteRevision(db)),
    ),
    startupUpkeep,

    favoriteTrackIds: attempt("read favorites", (db) => selectFavoriteTrackIds(db)),

    setFavorites: (trackIds, on) =>
      writeAttempt(on ? "add favorites" : "remove favorites", () =>
        setFavorites(db, trackIds, on, Date.now()),
      ),

    listFavorites: attempt("list favorites", (db) => listFavorites(db)),

    addPendingFavorites: (songs) =>
      writeAttempt("keep pending favorites", () => addPendingFavorites(db, songs, Date.now())),

    listPendingFavorites: attempt("read pending favorites", (db) => selectPendingFavorites(db)),

    removePendingFavorites: (videoIds) =>
      writeAttempt("forget pending favorites", () => removePendingFavorites(db, videoIds)),

    setDislikes: (songs) => writeAttempt("keep dislikes", () => setDislikes(db, songs, Date.now())),

    removeDislikes: (keys) =>
      writeAttempt("forget dislikes", () => removeDislikes(db, keys, Date.now())),

    listDislikes: attempt("read dislikes", (db) => selectDislikes(db)),
    dislikedTracks: attempt("read the disliked songs' tracks", (db) => selectDislikedTracks(db)),

    qualityFiles: attempt("read the files' quality", (db) => selectQualityFiles(db)),
    noBetterCopies: (direction) =>
      attempt("read the songs with no better copy", (db) => selectNoBetterCopies(db, direction)),
    rememberNoBetterCopies: (songs) =>
      writeAttempt("remember the songs with no better copy", () =>
        rememberNoBetterCopies(db, songs),
      ),
    replacedTrack: (trackId) =>
      attempt("read a song to replace", (db) => selectReplacedTrack(db, trackId)),
    replaceTrackFile: (trackId, track, artworkRows) =>
      writeAttempt("replace a song's file", () =>
        replaceTrackFile(db, splits, trackId, track, artworkRows, Date.now()),
      ),
    recordFileDeletions: (paths) =>
      writeAttempt("record files to delete", () => recordFileDeletions(db, paths, Date.now())),
    pendingFileDeletions: attempt("read the files to delete", (db) => pendingFileDeletions(db)),
    forgetFileDeletions: (paths) =>
      writeAttempt("forget deleted files", () => forgetFileDeletions(db, paths)),
    duplicateCheckFiles: attempt("read the files a replacement may have left twice", (db) =>
      selectDuplicateCheckFiles(db),
    ),
    fixReplacementDuplicate: (fix) =>
      writeAttempt("put a song left twice back to one", () =>
        fixReplacementDuplicate(db, splits, fix, Date.now()),
      ),

    recordPlay: (play, overlapping, streamedSong) =>
      historyWrite("record the play", () => recordPlay(db, play, overlapping, streamedSong)),

    updatePlay: (id, play) => historyWrite("update the play", () => updatePlay(db, id, play)),
    endPlay: (id, play) => historyWrite("end the play", () => endPlay(db, id, play)),

    home: (scope) =>
      attempt(
        "read Home",
        (db) => homeSections(db, scope),
        (result) =>
          result.recentlyAdded.length +
          result.recentlyPlayed.length +
          result.mostPlayed.length +
          result.favorites.length,
      ),
    homeAdded: attempt(
      "read Recently Added",
      (db) => homeAdded(db),
      (result) => result.recentlyAdded.length,
    ),
    homePlays: attempt(
      "read Home's plays",
      (db) => homePlays(db),
      (result) => result.recentlyPlayed.length + result.mostPlayed.length,
    ),
    homeFavorites: attempt(
      "read Home's favorites",
      (db) => homeFavorites(db),
      (result) => result.favorites.length,
    ),

    latestPlay: attempt("read the latest play", (db) => latestPlay(db)),
    listeningHistory: (before, query) =>
      attempt("read listening history", (db) => listeningHistory(db, before, query)),
    newerListeningHistory: (after) =>
      attempt("read newer listening history", (db) => newerListeningHistory(db, after)),
    listeningHistoryAround: (playId) =>
      attempt("read listening history around a play", (db) => listeningHistoryAround(db, playId)),

    trackPlayTotals: (window, trackIds) =>
      attempt("sum up song plays", (db) => trackPlayTotals(db, window, trackIds)),

    songPlayTotals: (window) => attempt("sum up song plays", (db) => songPlayTotals(db, window)),

    streamedSongsByIds: (videoIds) =>
      attempt("read streamed songs", (db) => streamedSongsOf(db, videoIds)),

    // While the kept totals settle these sum the history: the summing runs in steps.
    playedEntityTotals: (window) =>
      attemptStepped(
        "sum up played albums and artists",
        (db) => playedTotalsRead(db, window, true),
        playedTotalsSteps,
      ),
    playedArtistTotals: (window) =>
      Effect.map(
        attemptStepped(
          "sum up played artists",
          (db) => playedTotalsRead(db, window, false),
          playedTotalsSteps,
        ),
        (totals) => totals.artists,
      ),
    keptArtistSongs: attempt("read the artists of kept songs", (db) => keptArtistSongs(db)),
    streamedLibraryPlays: attempt("sum up the Library songs' streamed plays", (db) =>
      streamedLibraryPlays(db),
    ),
    playedArtistSongs: (artistId, now) =>
      attempt("read the artist listening", (db) => playedArtistSongs(db, artistId, now)),
    recapPlays: (window, includeStreamedGenres = true) =>
      attempt("sum up a Recap's plays", (db) => recapPlays(db, window, includeStreamedGenres)),
    creditedPlayTotals: (window) =>
      attempt("sum up album and artist plays", (db) => creditedPlayTotals(db, window)),
    keptTotalsSteps: Effect.sync(() => keptTotalsSteps(db, KEPT_TOTALS_STEP)),

    albumsByIds: (ids) => attempt("read ranked albums", (db) => albumsByIds(db, ids)),

    artistsByIds: (ids) =>
      attempt("read ranked artists", (db) => (ids.length === 0 ? [] : listArtistsSync(db, ids))),

    linkRows: (ids) =>
      attempt(
        "read linked rows",
        (db) => selectLinkRows(db, ids),
        (result) => Number(result.album !== null) + Number(result.artist !== null),
      ),

    listeningSums: attempt("sum up listening", (db) => listeningSums(db)),

    countedListeningPage: (after) =>
      attempt(
        "read counted listening page",
        (db) => countedListeningPage(db, after),
        (page) => page.rows.length,
      ),
    countedListening: attempt("sum up counted listening", (db) => countedListening(db)),

    pendingStreamedGenres: (after) =>
      attempt("read pending streamed genres", (db) => pendingStreamedGenres(db, after)),
    keepStreamedGenre: (videoId, genre) =>
      writeAttempt("save a streamed genre", () => keepStreamedGenre(db, videoId, genre)),
    pendingDjMoodSongs: (after, now) =>
      attempt(
        "read pending DJ mood songs",
        (db) => pendingDjMoodSongs(db, after, now),
        // The page's songs, not the page: an empty one logged as "1 row" looked like a stuck song.
        (page) => page.songs.length + page.unreadable.length,
      ),
    keepDjMoodFeatures: (writes) =>
      writeAttempt("save DJ mood features", () => keepDjMoodFeatures(db, writes)),
    djMoodFeatures: (videoIds) =>
      attempt("read DJ mood features", (db) => selectDjMoodFeatures(db, videoIds)),
    pendingDjLibraryMoodSongs: (afterTrackId, now) =>
      attempt("read pending DJ Library mood songs", (db) =>
        pendingDjLibraryMoodSongs(db, afterTrackId, now),
      ),
    keepDjLibraryMoodFeatures: (writes) =>
      writeAttempt("save DJ Library mood features", () => keepDjLibraryMoodFeatures(db, writes)),
    djLibraryMoodFeatures: () =>
      attempt("read DJ Library mood features", (db) => selectDjLibraryMoodFeatures(db)),
    songGenres: (ids, includeStreamedGenres = true) =>
      attempt("read the songs' genres", (db) => songGenres(db, ids, includeStreamedGenres)),

    artistFirstPlays: (ids) =>
      attempt("read the artists' first plays", (db) => artistFirstPlays(db, ids)),

    artistPlays: (artistId, now) =>
      attempt(
        "sum up the artist's plays",
        (db) => artistPlays(db, artistId, now),
        (result) => result.songIds.length + result.listening.length + result.songPlays.length,
      ),

    // The time is taken once: a replayed read must see the same statements on every pass.
    artistPhotoLookups: Effect.suspend(() => {
      const at = Date.now();
      return attempt("list artist photo lookups", (db) => selectArtistPhotoLookups(db, at));
    }),

    recordArtistPhoto: (artistKey, record) =>
      writeAttempt("record an artist photo", () => recordArtistPhoto(db, artistKey, record)),

    listArtistPhotos: attempt("list artist photos", (db) => selectArtistPhotos(db)),

    clearArtistPhotos: writeAttempt("clear artist photos", () => clearArtistPhotos(db)),

    ytArtist: (artistKey) =>
      attempt("read an artist's YT Music section", (db) =>
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
        try: () => syncCycle({ ...input, db, splits, historyChanged }),
        catch: (cause) => new LibraryStoreError({ operation: "sync with the Wave account", cause }),
      }),

    leaveAccount: writeAttempt("leave the Wave account", () => signOut(db, splits)),

    syncCollaborativePlaylist: (input, playlistId) =>
      Effect.tryPromise({
        try: () => syncCollaborativePlaylist({ ...input, db, splits, historyChanged }, playlistId),
        catch: (cause) =>
          new LibraryStoreError({ operation: "sync a collaborative playlist", cause }),
      }),

    markCollaborationSeen: (playlistId) =>
      writeAttempt("mark a collaborative playlist seen", () =>
        markCollaborationSeen(db, playlistId),
      ),

    privateCopyNotices: attempt("read the private copy notices", (db) =>
      selectPrivateCopyNotices(db),
    ),

    dismissPrivateCopyNotice: (playlistId) =>
      writeAttempt("dismiss a private copy notice", () => dismissPrivateCopyNotice(db, playlistId)),

    joinedPlaylistId: (syncId) =>
      attempt(
        "read a joined playlist",
        (db) => selectCollaborations(db).find((held) => held.syncId === syncId)?.playlistId ?? null,
      ),

    savedLyrics: (videoId) => attempt("read saved lyrics", (db) => selectSavedLyrics(db, videoId)),

    keepSavedLyrics: (videoId, saved) =>
      writeAttempt("save lyrics", () => {
        keepSavedLyrics(db, videoId, saved, Date.now());
        notifyLyricsSearchIndexChanged();
      }),

    forgetSavedLyrics: (videoIds) =>
      writeAttempt("forget saved lyrics", () => {
        forgetSavedLyrics(db, videoIds);
        notifyLyricsSearchIndexChanged();
      }),

    lyricsSearchTrack: (trackId) =>
      attempt("read the song's lyrics search", (db) => selectLyricsSearchTrack(db, trackId)),

    keepLyricsMiss: (trackId, checkedAt) =>
      writeAttempt("remember the lyrics search", () => keepLyricsMiss(db, trackId, checkedAt)),

    lyricsIndexPage: (afterId, limit) =>
      attempt("read a page of lyrics to index", (db) => selectLyricsIndexPage(db, afterId, limit)),

    lyricsIndexTarget: (trackId) =>
      attempt("read lyrics index target", (db) => selectLyricsIndexTarget(db, trackId)),

    staleLyricsIndexPage: (afterId, limit) =>
      attempt("read stale lyrics index rows", (db) =>
        selectStaleLyricsIndexPage(db, afterId, limit),
      ),

    lyricsTrackIdAtPath: (path) =>
      attempt("find lyrics index track", (db) => selectLyricsTrackIdAtPath(db, path)),

    keepLyricsSearchText: (trackId, lyrics) =>
      writeAttempt("index lyrics for Search", () => keepLyricsSearchText(db, trackId, lyrics)),

    searchLyrics: (query) =>
      attempt("search indexed lyrics", (db) => selectLyricsCandidates(db, query)),

    searchSavedLyrics: (query) =>
      attempt("search saved lyrics", (db) => selectSavedLyricsCandidates(db, query)),

    savedLyricsSearchIndexPage: (afterVideoId, limit) =>
      attempt("read saved lyrics to index", (db) =>
        selectSavedLyricsSearchIndexPage(db, afterVideoId, limit),
      ),

    indexSavedLyricsSearchText: (candidate) =>
      writeAttempt("index saved lyrics for Search", () => indexSavedLyrics(db, candidate)),

    streamedSongs: attempt("read the songs streamed", (db) => selectStreamedSongs(db)),

    playlistedSongs: attempt("read the playlists' songs", (db) => selectPlaylistedSongs(db)),

    knownVideos: attempt("read the videos the owner knows", (db) => selectKnownVideos(db)),
    knownVideosPage: (cursor) =>
      attempt("read a page of the videos the owner knows", (db) =>
        selectKnownVideosPage(db, cursor),
      ),

    addCandidates: (page, at) =>
      writeAttempt("add to the candidate catalog", () => {
        addCandidates(db, page, at);
        artistGraphSourcesChanged("catalog");
      }),

    mixStreamedPage: (after) =>
      attempt("read a mix streamed page", (db) => mixStreamedPage(db, after)),
    mixStreamedPlaysPage: (after) =>
      attempt("read a mix streamed plays page", (db) => mixStreamedPlaysPage(db, after)),
    mixCreditNamesPage: (after) =>
      attempt("read a mix credit names page", (db) => mixCreditNamesPage(db, after)),
    mixPlaylistedPage: (after) =>
      attempt("read a mix playlist page", (db) => mixPlaylistedPage(db, after)),
    mixCreditPage: (after) => attempt("read a mix credit page", (db) => mixCreditPage(db, after)),
    tasteArtistsPage: (after) =>
      attempt("read a taste artist page", (db) => tasteArtistsPage(db, after)),
    tastePlaysPage: (after) => attempt("read a taste play page", (db) => tastePlaysPage(db, after)),
    tasteFavoritesPage: (after) =>
      attempt("read a taste favorite page", (db) => tasteFavoritesPage(db, after)),
    tasteDownloadsPage: (after) =>
      attempt("read a taste download page", (db) => tasteDownloadsPage(db, after)),
    mixSongsPage: (after, options) =>
      attempt("read a mix song page", (db) => mixSongsPage(db, after, options)),
    mixArtistsPage: (after) => attempt("read a mix artist page", (db) => mixArtistsPage(db, after)),
    mixHistoryPage: (after) =>
      attempt("read a mix history page", (db) => mixHistoryPage(db, after)),
    mixCatalogPage: (after) =>
      attempt("read a mix catalog page", (db) => mixCatalogPage(db, after)),
    mixSongs: attempt("read Home's mix songs", (db) => mixSongs(db)),
    mixArtists: attempt("read Home's mix artists", (db) => mixArtists(db)),
    mixPlayTotals: (now) => attempt("read Home's mix play totals", (db) => mixPlayTotals(db, now)),
    mixPlayedRecordingKeys: attempt("read Home's mix played recordings", (db) =>
      mixPlayedRecordingKeys(db),
    ),
    mixCredits: attempt("read Home's mix credits", (db) => mixCredits(db)),
    mixStreamedPlays: attempt("read Home's mix streamed plays", (db) => mixStreamedPlays(db)),
    mixCreditNames: attempt("read Home's mix credit names", (db) => mixCreditNames(db)),
    mixStreamed: attempt("read Home's mix streamed songs", (db) => mixStreamed(db)),
    mixPlaylisted: attempt("read Home's mix playlist entries", (db) => mixPlaylisted(db)),
    mixCatalog: attempt("read Home's mix catalog", (db) => mixCatalog(db)),
    graphRadios: attempt("read Home's mix catalog radios", (db) => graphRadios(db)),
    graphRadioPage: (after) =>
      attempt("read a graph radio page", (db) => graphRadioPage(db, after)),
    graphCatalogPage: (after) =>
      attempt("read a graph catalog page", (db) => graphCatalogPage(db, after)),
    graphSimilarPage: (after) =>
      attempt("read a graph similar page", (db) => graphSimilarPage(db, after)),
    graphPlayPage: (after) => attempt("read a graph play page", (db) => graphPlayPage(db, after)),
    graphPlays: attempt("read Home's graph plays", (db) => graphPlays(db)),
    candidateCatalog: attempt("read the candidate catalog", (db) => selectCandidateCatalog(db)),

    ytArtistSimilar: attempt("read the saved artist pages' similar artists", (db) =>
      selectYtArtistSimilar(db),
    ),
    collaborations: collaborationStore(
      db,
      (operation, cause) => new LibraryStoreError({ operation, cause }),
      attempt,
    ),
  });
});

export const layer = Layer.effect(LibraryStore, make).pipe(
  Layer.provide(databaseLayer),
  Layer.provide(sqliteDriverLayer),
);
