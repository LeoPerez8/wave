/** Reviewed declaration identities. Keep reasons specific; never allow directories. */
export interface Exception {
  readonly reason: string;
  /** Existing opening-path debt: remove this entry when this ticket lands. */
  readonly removeIn?: number;
  readonly capabilities?: readonly string[];
  readonly kind?: "opening" | "gesture";
  /** Reviewed fixed opening boundary, backed by behavioral settlement tests. */
  readonly deferred?: {
    readonly settlement: "screen" | "nowPlaying";
    readonly connectivity: "android";
    readonly tests: readonly string[];
  };
}
export const LIBRARY_SEEDS = [
  "library/LibraryStore.ts#playlistRecommendationInput",
  "library/playlistRecommendationSource.ts#playlistRecommendationInput",
  "library/playlistRecommendationInputs.ts#sharePlaylistRecommendationInputs",
  "library/playlistRecommendationInputs.ts#observePlaylistRecommendationInputs",
  "library/LibraryStore.ts#listSongs",
  "library/LibraryStore.ts#listSortedSongs",
  "library/LibraryStore.ts#listArtists",
  "library/LibraryStore.ts#tasteHistory",
  "library/LibraryStore.ts#countedListening",
  "library/LibraryStore.ts#countedListeningPage",
  "library/db/stats.ts#countedListening",
  "library/db/stats.ts#countedListeningPage",
  "stats/Stats.ts#recaps",
  "library/db/taste.ts#tasteHistory",
  "library/hooks.ts#songs",
  "library/hooks.ts#artists",
  "library/hooks.ts#useArtists",
  ...[
    "currentLibraryFinder",
    "useLoadedLibraryFinder",
    "useLibraryFinder",
    "useLoadedInLibrary",
  ].map((name) => `ytmusic/libraryFinder.ts#${name}`),
  "../../../packages/core/src/ytMusic.ts#libraryFinder",
  "../../../packages/core/src/ytMusic.ts#libraryFinderSteps",
  "../../../packages/core/src/ytMusic.ts#libraryImportFinderSteps",
  "../../../packages/core/src/playlistImport.ts#planLinkImportSteps",
  "../../../packages/core/src/ytArtist.ts#libraryArtistFinder",
];

export const NETWORK_SEEDS = [
  "global#fetch",
  ...[
    "searchSongs",
    "searchArtists",
    "searchAlbums",
    "artist",
    "album",
    "playlist",
    "libraryPlaylists",
    "ownPlaylist",
    "createPlaylist",
    "editPlaylist",
    "radio",
    "artistRadio",
    "radioMore",
    "cacheArtwork",
    "checkSession",
    "signIn",
  ].map((name) => `ytmusic/YtMusic.ts#${name}`),
  ...[
    "searchSongs",
    "searchArtists",
    "searchAlbums",
    "artist",
    "playlist",
    "playlistMore",
    "libraryPlaylists",
    "ownPlaylist",
    "createPlaylist",
    "editPlaylist",
    "songRadio",
    "artistRadio",
    "startedRadio",
    "radioMore",
    "cacheArtwork",
    "checkSession",
    "signIn",
    "schedulePreDownload",
  ].map((name) => `native/waveYtMusic.ts#${name}`),
  ...["album", "watchSong", "lyrics"].map((name) => `native/waveYtDownloads.ts#${name}`),
];

/** Whole-Library reads must state their actual trigger and frequency, beyond why they exist. */
export interface WholeLibraryException extends Exception {
  readonly howOften: string;
}
export const WHOLE_LIBRARY: Record<string, WholeLibraryException> = {
  "library/PlaylistRecommendations.tsx#PlaylistRecommendations": {
    howOften:
      "Once per settled visible playlist visit; source edits coalesce into one refresh, never while hidden.",
    reason:
      "The visit's read/refill waits for screen settlement, is aborted on loss of screen sight (including Now Playing), and reads the shared recommendation snapshot plus stepped Core ranking. Public behavior/work counts: playlistRecommendationVisit.test.ts and db/regressionSweep.test.ts.",
    capabilities: ["library/playlistRecommendationSource.ts#playlistRecommendationInput"],
  },
  "library/playlistRecommendationSource.ts#inputs": {
    howOften:
      "Once per shared snapshot version requested by a settled visit; retained for at most sixty idle seconds.",
    reason:
      "#633: the app's playlist inputs over the recommendation snapshot (Library, catalog, stars), read only once a settled visit asks; the Library's tracks are derived once per snapshot read. Membership/feedback are scoped to the requesting playlist. Real SQLite tests: playlistRecommendationInputs.test.ts.",
    capabilities: ["library/playlistRecommendationInputs.ts#sharePlaylistRecommendationInputs"],
  },
  "library/playlistRecommendationInputs.ts#observePlaylistRecommendationInputs": {
    howOften:
      "Once per source version while observed; changes share a pending read and idle snapshots expire after sixty seconds.",
    reason:
      "Desktop replays' and tests' copy of the app's recommendation snapshot: counts Library changes and catalog writes as source versions and releases both listeners on disposal. Each part is paged and kept for at most a lazy sixty-second idle time.",
    capabilities: ["library/playlistRecommendationInputs.ts#sharePlaylistRecommendationInputs"],
  },
  "library/startupJobs.ts#readImportDownloadInput": {
    howOften:
      "Once per resumed filled import download preparation, after startup settlement; never per download landing.",
    reason:
      "A kept filled import prepares download membership after settlement; source SQL is indivisible, indexing and per-entry matching yield. Actual store coverage: startupJobs.test.ts.",
    capabilities: [
      "../../../packages/core/src/ytMusic.ts#libraryImportFinderSteps",
      "library/LibraryStore.ts#listSongs",
    ],
  },
  "library/ytLibraryImport.ts#fill": {
    howOften: "Once per queued import or explicit retry after startup settlement.",
    reason:
      "A queued or explicitly retried library import builds its matching index on settled startup turns, in budgeted steps; never an opening read. Source order and pause/retry semantics have behavioral coverage in startupJobs.test.ts and libraryImportResume.test.ts.",
    capabilities: ["../../../packages/core/src/playlistImport.ts#planLinkImportSteps"],
  },
  "stats/statsLive.ts#readListeningPages": {
    howOften:
      "Once per requested period and source version, in pages of at most 512 events per free turn.",
    reason:
      "The sole listening source seam reads at most 512 raw events by indexed keyset per cancellable free turn, shared by availability and explicit Recap stories. Core retains all local calendar policy. recapAvailability.test.ts verifies real SQL bounds and semantic equality.",
    capabilities: ["library/LibraryStore.ts#countedListeningPage"],
  },
  "stats/recapAvailabilityLive.ts#getRecapAvailability": {
    howOften:
      "Once per changed history/calendar version requested by settled visible Home or Stats; unchanged returns reuse the cache.",
    reason:
      "One retained availability cache calls bounded Stats.recaps only for visible settled Home/Stats, sharing in-flight work and retaining the last usable answer. Real store/cache tests verify zero return SQL, hidden coalescing, cancellation and stale-result rejection.",
    capabilities: ["stats/Stats.ts#recaps"],
  },
  "app/library/discover-mix/[id].tsx#DiscoverMixScreen": {
    howOften:
      "Once per shared Library query version while this visible page or menu follows it; unchanged renders reuse the finder.",
    reason: "Visible mix page resolves streamed entries against Library files.",
    capabilities: ["ytmusic/libraryFinder.ts#useLibraryFinder"],
  },
  "home/DiscoverMixActions.tsx#DiscoverMixActionsMenu": {
    howOften:
      "Once per shared Library query version while this visible page or menu follows it; unchanged renders reuse the finder.",
    reason:
      "Explicitly opened mix menu resolves downloads and playlist entries; not an always-mounted control.",
    capabilities: [
      "ytmusic/libraryFinder.ts#useLibraryFinder",
      "ytmusic/libraryFinder.ts#useLoadedInLibrary",
    ],
  },
  "home/DiscoverMixActions.tsx#openDiscoverMixActions": {
    howOften: "Once per explicit mix menu action; finder reads are shared per Library version.",
    reason:
      "Explicitly opened mix menu resolves downloads and playlist entries; not an always-mounted control.",
    capabilities: ["ytmusic/libraryFinder.ts#currentLibraryFinder"],
  },
  "home/discoverMixes.ts#useLibraryTracks": {
    howOften:
      "Once per shared songs-query version while a mix page or menu is visible; Home does not follow these rows.",
    reason:
      "Visible mix page and menu resolve Library tracks; Home's saved mixes blend without this hook.",
    capabilities: ["library/hooks.ts#songs"],
  },

  "library/BrowseLists.tsx#ArtistsList": {
    howOften:
      "Once per shared artists-query version while the Artists list is visible; unchanged renders reuse the rows.",
    reason: "Visible Library Artists list displays all artists.",
    capabilities: ["library/hooks.ts#useArtists"],
  },
  "library/hooks.ts#listArtists": {
    howOften:
      "Once per shared query source version while followed; all active readers share the result.",
    reason:
      "Shared query definitions, used by the visible Library lists and background search index.",
    capabilities: ["library/LibraryStore.ts#listArtists"],
  },
  "library/hooks.ts#listSongs": {
    howOften:
      "Once per shared query source version while followed; all active readers share the result.",
    reason:
      "Shared query definitions, used by the visible Library lists and background search index.",
    capabilities: ["library/LibraryStore.ts#listSongs"],
  },
  "library/LibraryStore.ts#make": {
    howOften:
      "Service construction registers effects without reading; callers determine each execution frequency.",
    reason:
      "The store implements taste history and bounded counted-listening pages. Its legacy whole-history driver remains a compatibility/control capability only; production Stats callers must use the separately inventoried bounded seam.",
    capabilities: [
      "library/db/taste.ts#tasteHistory",
      "library/db/stats.ts#countedListening",
      "library/db/stats.ts#countedListeningPage",
    ],
  },
  "library/playlistImports.ts#listLibrary": {
    howOften: "Once per explicit playlist import or resumed import preparation.",
    reason: "An explicit playlist import matches entries against the Library before saving.",
    capabilities: ["library/LibraryStore.ts#listSongs"],
  },
  "library/sectionSongs.ts#collections": {
    howOften:
      "Once per explicit Library section menu or playback action requesting artist collection ids.",
    reason:
      "Explicit section actions read the selected section songs/artists for playback and menus.",
    capabilities: ["library/LibraryStore.ts#listArtists"],
  },
  "library/sectionSongs.ts#librarySectionSongs": {
    howOften: "Once per explicit Songs section menu or playback action, in its saved SQL sort.",
    reason:
      "Explicit section actions read the selected section songs/artists for playback and menus.",
    capabilities: ["library/LibraryStore.ts#listSortedSongs"],
  },

  "playback/ActionsMenu.tsx#usePlaylistDownloadEntries": {
    howOften:
      "Once per shared Library query version while this visible page or menu follows it; unchanged renders reuse the finder.",
    reason: "Visible playlist menu checks which entries are downloaded; created for a user action.",
    capabilities: ["ytmusic/libraryFinder.ts#useLoadedInLibrary"],
  },
  "playback/itemActions.ts#useStreamedSongFinder": {
    howOften:
      "Once per shared Library query version while this visible page or menu follows it; unchanged renders reuse the finder.",
    reason: "A visible selection/menu resolves streamed items for user actions.",
    capabilities: ["ytmusic/libraryFinder.ts#useLibraryFinder"],
  },
  "playback/actionTargets.ts#targetEntries": {
    howOften:
      "Once per chosen queue or playlist action; finder reads are shared per Library version.",
    reason:
      "A chosen queue or playlist action expands checked releases and then acquires the current finder. Selection sources and metadata-only bar planning never call it; Core's selectionEntries tests cover the reading order, matching and page order.",
    capabilities: ["ytmusic/libraryFinder.ts#currentLibraryFinder"],
  },
  "playback/itemActions.ts#resolveSelectionTarget": {
    howOften: "Once per selection action press; finder reads are shared per Library version.",
    reason:
      "Only a selection bar's onPress acquires current Library matches before running its chosen song action. Entering selection uses the displayed metadata and disables finder, artist, link and missing-album reads.",
    capabilities: ["ytmusic/libraryFinder.ts#currentLibraryFinder"],
  },
  "playback/rowSwipe.ts#runTrackSwipe": {
    howOften: "Once per completed swipe action; finder reads are shared per Library version.",
    reason:
      "A completed swipe resolves its one requested action; it does not subscribe while rows render.",
    capabilities: ["ytmusic/libraryFinder.ts#currentLibraryFinder"],
  },

  "search/searchIndex.ts#releasesOf": {
    howOften: "Once per artist/album snapshot version used to rebuild the background search index.",
    reason:
      "Search deliberately shares the lists and lazily builds lookups; its index is built in yielding background steps.",
    capabilities: ["../../../packages/core/src/ytArtist.ts#libraryArtistFinder"],
  },
  "search/searchIndex.ts#useSearchIndex": {
    howOften:
      "Once per shared Library query version while Search needs its index; unchanged renders reuse it.",
    reason:
      "Search deliberately shares the lists and lazily builds lookups; its index is built in yielding background steps.",
    capabilities: [
      "library/hooks.ts#artists",
      "library/hooks.ts#songs",
      "ytmusic/libraryFinder.ts#useLoadedLibraryFinder",
    ],
  },
  "ytmusic/albumSection.ts#useYtAlbumSection": {
    howOften:
      "Once per shared Library query version while this visible page or menu follows it; unchanged renders reuse the finder.",
    reason:
      "The album opening policy enables the shared finder only after local content and screen settlement, with a loaded online release. Its local rows and offline note draw independently. albumOpening.test.ts checks real-store work and row placement.",
    capabilities: ["ytmusic/libraryFinder.ts#useLoadedLibraryFinder"],
  },
  "ytmusic/artistPage.ts#useLibraryReleases": {
    howOften:
      "Once per shared Library query version while this visible page or menu follows it; unchanged renders reuse the finder.",
    reason:
      "Only a settled, usable-network YT artist page with a standing full answer activates the shared artist/album identities and song finder. Offline/loading/failure render without those reads. See ytArtistPageOpening.test.ts and detailOpening.test.ts.",
    capabilities: [
      "../../../packages/core/src/ytArtist.ts#libraryArtistFinder",
      "library/hooks.ts#useArtists",
    ],
  },
  "ytmusic/artistPage.ts#useYtArtistPage": {
    howOften:
      "Once per shared Library query version while this visible page or menu follows it; unchanged renders reuse the finder.",
    reason:
      "Only a settled, usable-network YT artist page with a standing full answer activates the shared artist/album identities and song finder. Offline/loading/failure render without those reads. See ytArtistPageOpening.test.ts and detailOpening.test.ts.",
    capabilities: ["ytmusic/libraryFinder.ts#useLoadedLibraryFinder"],
  },
  "ytmusic/artistSection.ts#useDeferredArtistSection": {
    howOften:
      "Once per shared Library query version while this visible page or menu follows it; unchanged renders reuse the finder.",
    reason:
      "Online additions only: the artist opening policy gates this shared finder on local content, screen settlement, Online and a standing full answer. Library mode and missing, pending, partial or expired answers do not subscribe. See ytArtistOpening.test.ts and artistOpening.test.ts.",
    capabilities: ["ytmusic/libraryFinder.ts#useLoadedLibraryFinder"],
  },

  "ytmusic/libraryFinder.ts#finderOver": {
    howOften:
      "Lazily on first lookup per rows identity; weakly cached while those rows remain reachable.",
    reason:
      "One shared finder implementation; following/building callers are inventoried separately.",
    capabilities: ["../../../packages/core/src/ytMusic.ts#libraryFinder"],
  },
  "ytmusic/libraryFinder.ts#songsQuery": {
    howOften:
      "Query definition only; active hooks and current reads share results per Library version.",
    reason:
      "One shared finder implementation; following/building callers are inventoried separately.",
    capabilities: ["library/hooks.ts#songs"],
  },
  "ytmusic/libraryFinder.ts#useLibraryFinder": {
    howOften:
      "Follows the shared songs query only while active; one finder per rows identity, never per row.",
    reason:
      "One shared finder implementation; following/building callers are inventoried separately.",
    capabilities: ["ytmusic/libraryFinder.ts#useLoadedLibraryFinder"],
  },
  "ytmusic/libraryFinder.ts#useLoadedInLibrary": {
    howOften:
      "Follows the shared songs query only while active; one finder per rows identity, never per row.",
    reason:
      "One shared finder implementation; following/building callers are inventoried separately.",
    capabilities: ["ytmusic/libraryFinder.ts#useLoadedLibraryFinder"],
  },
  "ytmusic/YtAlbumActions.tsx#YtAlbumActionsMenu": {
    howOften:
      "Once per shared Library query version while this visible page or menu follows it; unchanged renders reuse the finder.",
    reason: "Explicit album menu resolves downloaded songs while the card is shown.",
    capabilities: [
      "ytmusic/libraryFinder.ts#useLibraryFinder",
      "ytmusic/libraryFinder.ts#useLoadedInLibrary",
    ],
  },
  "ytmusic/YtArtistActions.tsx#openYtArtistActions": {
    howOften: "Once per explicit artist menu action; finder reads are shared per Library version.",
    reason: "Explicit artist menu resolves its entries at action time.",
    capabilities: ["ytmusic/libraryFinder.ts#currentLibraryFinder"],
  },

  "ytmusic/YtDownloads.ts#forgetSettledFailures": {
    howOften:
      "Once per launch when failures exist; uses the current shared finder, never per journal event.",
    reason:
      "Download recovery runs on explicit/background work; the failed-download UI follows only while shown.",
    capabilities: ["ytmusic/libraryFinder.ts#currentLibraryFinder"],
  },
  "ytmusic/YtDownloads.ts#requeueThrottledFailures": {
    howOften:
      "Once per install migration, retried next launch on failure; uses the current shared finder.",
    reason:
      "Download recovery runs on explicit/background work; the failed-download UI follows only while shown.",
    capabilities: ["ytmusic/libraryFinder.ts#currentLibraryFinder"],
  },
  "ytmusic/YtDownloads.ts#useFailedDownloadsInput": {
    howOften:
      "Once per shared Library query version while this visible page or menu follows it; unchanged renders reuse the finder.",
    reason:
      "Download recovery runs on explicit/background work; the failed-download UI follows only while shown.",
    capabilities: ["ytmusic/libraryFinder.ts#useLoadedLibraryFinder"],
  },
  "ytmusic/YtSongActions.tsx#useYtSongSwipe": {
    howOften: "Once per completed song swipe; finder reads are shared per Library version.",
    reason: "Explicit song menus and completed swipes resolve Library identity for their action.",
    capabilities: ["ytmusic/libraryFinder.ts#currentLibraryFinder"],
  },
  "ytmusic/YtSongActions.tsx#YtSongActionsMenu": {
    howOften:
      "Once per shared Library query version while this visible page or menu follows it; unchanged renders reuse the finder.",
    reason: "Explicit song menus and completed swipes resolve Library identity for their action.",
    capabilities: [
      "ytmusic/libraryFinder.ts#useLibraryFinder",
      "ytmusic/libraryFinder.ts#useLoadedInLibrary",
    ],
  },
  "ytmusic/YtSongList.tsx#useYtAlbumDownloadButton": {
    howOften:
      "Once per shared Library query version while this visible page or menu follows it; unchanged renders reuse the finder.",
    reason:
      "Only nonempty online album songs after screen settlement activate this finder. Library album openings with no online answer start no cold follower.",
    capabilities: [
      "ytmusic/libraryFinder.ts#useLoadedInLibrary",
      "ytmusic/libraryFinder.ts#useLoadedLibraryFinder",
    ],
  },
  "ytmusic/YtSongList.tsx#useYtPlaylistDownloadButton": {
    howOften:
      "Once per shared Library query version while this visible page or menu follows it; unchanged renders reuse the finder.",
    reason:
      "Visible online lists and their download buttons resolve local files; they are not the hidden Now Playing subtree.",
    capabilities: [
      "ytmusic/libraryFinder.ts#useLoadedInLibrary",
      "ytmusic/libraryFinder.ts#useLoadedLibraryFinder",
    ],
  },
  "ytmusic/YtSongList.tsx#YtSongList": {
    howOften:
      "Once per shared Library query version while this visible page or menu follows it; unchanged renders reuse the finder.",
    reason:
      "Only a loaded remote list after screen settlement follows the finder; offline/loading pages render without acquiring it.",
    capabilities: ["ytmusic/libraryFinder.ts#useLibraryFinder"],
  },
};
export const OPENING_REQUESTS: Record<string, Exception> = {
  "stats/PlayedEntityViews.tsx#openOnlineAlbum": {
    kind: "gesture",
    reason:
      "A tap on a ranked or recently played online album resolves its missing browse id. Consent is checked before search and again before opening the page.",
  },
  "stats/PlayedEntityViews.tsx#usePlayedArtist": {
    kind: "opening",
    reason:
      "Visible online artist rows ask for their image after screen settlement, with execution-time YT consent and Android connectivity checks. In-flight name requests are shared; disabled entries show placeholders.",
    deferred: {
      settlement: "screen",
      connectivity: "android",
      tests: ["apps/mobile/src/stats/playedEntityOpening.test.ts"],
    },
  },
  "playback/actionTargets.ts#targetEntries": {
    kind: "gesture",
    reason:
      "A chosen selection bar action reads the checked streamed releases. Rendering the page or bar never expands their tracklists; Core's selectionEntries tests cover matching and failure, mixedItems.test.ts that building the selection reads nothing.",
  },
  "playback/actions.ts#dispatchWithYt": {
    kind: "gesture",
    reason:
      "A Play/Enqueue queue command saves the streamed tracks and caches their artwork; the command is not dispatched while a page renders.",
  },
  "share/songShare.ts#shareNowPlaying": {
    kind: "gesture",
    reason: "Now Playing Share opens the song-share card only after its Share button is pressed.",
  },
  "library/backgroundFill.ts#playlistOpened": {
    kind: "opening",
    reason:
      "The playlist screen passes its settlement boundary; playlistOpened ignores an unsettled call. Fill searches check Android before the allowance and again when their turn executes, through artistOpeningRequest.",
    deferred: {
      settlement: "screen",
      connectivity: "android",
      tests: ["apps/mobile/src/ytmusic/detailOpening.test.ts"],
    },
  },
  "playback/actions.ts#playPage": {
    kind: "gesture",
    reason:
      "The page Play/Shuffle button or selected row starts this action; constructing the page does not play it.",
  },
  "playback/playTarget.ts#playTarget": {
    kind: "gesture",
    reason:
      "The Play/Shuffle choice in an explicitly opened menu runs playback, including caching streamed artwork.",
  },
  "library/tryAgainUnavailable.ts#tryAgainUnavailable": {
    kind: "gesture",
    reason: "Try Again for unavailable playlist entries searches only after its button is pressed.",
  },
  "library/starSongs.ts#starSongs": {
    kind: "gesture",
    reason:
      "A Favorite/Unfavorite press may queue the starred download; merely displaying the star reads state only.",
  },
  "ytmusic/YtDownloads.ts#runYtDownloadAction": {
    kind: "gesture",
    reason:
      "The album Download/Retry/Cancel button invokes this action; reading its progress never invokes it.",
  },
  "ytmusic/YtDownloads.ts#runYtPlaylistDownloadAction": {
    kind: "gesture",
    reason:
      "The playlist Download/Retry/Cancel button invokes this action after a press, not while its page mounts.",
  },
  "playback/itemActions.ts#itemActionPress": {
    kind: "gesture",
    reason:
      "A selected menu or selection-bar action runs here, after the user chooses it; rendering the action list does not run it.",
  },
  "playback/rowSwipe.ts#runTrackSwipe": {
    kind: "gesture",
    reason:
      "A committed row swipe dispatches its chosen action, including sharing or playback; mounted rows only construct callbacks.",
  },
  "library/promptForMusicFolder.ts#promptForMusicFolder": {
    kind: "gesture",
    reason:
      "The empty Library Add folder button opens a folder picker; choosing a folder starts the scan and background photo downloads.",
  },
  "library/playlistSuggestionRadios.ts#playlistSuggestionRadios": {
    kind: "opening",
    reason:
      "A visible settled playlist visit reads its drawn song radios. Execution-time Android connectivity is passed to the shared readers, so offline visits use cached pages. The shared setup does not read until this effect runs; each search and radio read has an eight-second limit.",
    deferred: {
      settlement: "screen",
      connectivity: "android",
      tests: [
        "apps/mobile/src/library/playlistRecommendationVisit.test.ts",
        "apps/mobile/src/playback/songRadioReaders.test.ts",
        "apps/mobile/src/playback/songRadioSession.test.ts",
      ],
    },
  },
  "ytmusic/artistSection.ts#useDeferredArtistSection": {
    kind: "opening",
    reason:
      "Popular and Online share one artist reader: local content and screen settlement, Online selection, execution-time Android connectivity, the shared search allowance and current automatic Wi-Fi eligibility gate every opening/retry. Library selection, artist changes and leaving abort it; stale answers cannot publish. Saved Popular is local.",
    deferred: {
      settlement: "screen",
      connectivity: "android",
      tests: [
        "packages/core/src/ytArtistOpening.test.ts",
        "apps/mobile/src/ytmusic/artistOpening.test.ts",
        "packages/core/src/ytPopularRead.test.ts",
        "apps/mobile/src/ytmusic/artistPopular.test.ts",
      ],
    },
  },
  "ytmusic/albumSection.ts#useYtAlbumSection": {
    kind: "opening",
    reason:
      "The album opening policy gates artist/release asks and retries on local content and screen settlement. Each request checks Android at execution; local rows and offline notes need no finder or remote answer.",
    deferred: {
      settlement: "screen",
      connectivity: "android",
      tests: [
        "packages/core/src/ytAlbumOpening.test.ts",
        "packages/core/src/ytArtistPageOpening.test.ts",
        "apps/mobile/src/ytmusic/albumOpening.test.ts",
        "apps/mobile/src/ytmusic/detailOpening.test.ts",
      ],
    },
  },
  "ytmusic/artistPage.ts#useYtArtistPage": {
    kind: "opening",
    reason:
      "A remote artist waits for screen settlement before asking and checks Android at execution. Its offline note renders immediately, including by-name openings with no saved answer or finder.",
    deferred: {
      settlement: "screen",
      connectivity: "android",
      tests: [
        "packages/core/src/ytAlbumOpening.test.ts",
        "packages/core/src/ytArtistPageOpening.test.ts",
        "apps/mobile/src/ytmusic/albumOpening.test.ts",
        "apps/mobile/src/ytmusic/detailOpening.test.ts",
      ],
    },
  },
  "ytmusic/YtSongList.tsx#useYtListPage": {
    kind: "opening",
    reason:
      "Remote album/playlist reads and retries wait for screen settlement; artistOpeningRequest checks Android at execution. Offline is rendered synchronously and unmount aborts the waiting effect.",
    deferred: {
      settlement: "screen",
      connectivity: "android",
      tests: [
        "packages/core/src/ytAlbumOpening.test.ts",
        "packages/core/src/ytArtistPageOpening.test.ts",
        "apps/mobile/src/ytmusic/albumOpening.test.ts",
        "apps/mobile/src/ytmusic/detailOpening.test.ts",
      ],
    },
  },
  "nowPlaying/useLyricsSearch.ts#useLyricsSearch": {
    kind: "gesture",
    reason:
      "LyricsView mounts only after selecting Lyrics; NowPlayingSheet starts on player and resets on hide. The explicit Lyrics search asks LRCLIB/YouTube, not the initial sheet opening.",
  },
  "nowPlaying/useLyricsTranslation.ts#useLyricsTranslation": {
    kind: "gesture",
    reason:
      "Translation runs only in the explicitly selected Lyrics view with translation enabled. Each sheet opening starts on player; this Google Translate request is also outside the three guarded hosts.",
  },
  "playback/hooks.ts#usePlayPage": {
    kind: "gesture",
    reason:
      "Creates Play/Shuffle callbacks; network is reached only after the owner invokes a playback action.",
  },
  "ytmusic/YtDownloads.ts#downloadMissingSongs": {
    kind: "gesture",
    reason:
      "Queues a missing song only for an explicit Play/Download/Favorite action; rendering download status does not start it.",
  },
  "ytmusic/YtDownloads.ts#downloadYtSong": {
    kind: "gesture",
    reason:
      "Explicit Download/Favorite action queues a song; a screen opening only reads job status.",
  },
  "ytmusic/YtSongActions.tsx#run": {
    kind: "gesture",
    reason:
      "Completed swipe or chosen menu action; sharing/downloading is never called by row mount.",
  },
  "ytmusic/YtAlbumActions.tsx#openYtAlbumActions": {
    kind: "gesture",
    reason: "Album long-press/menu gesture reads the album to populate its action card.",
  },
  "library/ytLibraryImport.ts#readYtLibraryPlaylistAgain": {
    kind: "gesture",
    reason:
      "The playlist Refresh action retries its import; the status line only displays progress.",
  },
  "library/runtime.ts#startRescan": {
    kind: "gesture",
    reason: "Scan banner Retry starts the scan and background photo downloads only when pressed.",
  },
  "library/importPlaylistLink.tsx#openPlaylistImport": {
    kind: "gesture",
    reason:
      "Import playlist opens an explicit link-entry flow; importing starts only after a URL is submitted.",
  },
};

/** Bounded source walks still belong on cancellable background turns. Keep these
 * separate from whole-source debts so paging cannot silently return to an opening.
 */
export const TASTE_SOURCE_SEEDS = [
  "mixSongsPage",
  "tasteArtistsPage",
  "tastePlaysPage",
  "tasteFavoritesPage",
  "tasteDownloadsPage",
  "tasteRevision",
].map((name) => `library/LibraryStore.ts#${name}`);
export const TASTE_SOURCES: Record<string, Exception> = {
  "home/mixBuildLibrary.ts#readMixBuildLibrary": {
    reason:
      "Cold Discover builds seek song and artist seed metadata in 128-row pages after Home settlement, yielding between pages. Stored play totals supply weights; only returned radio songs need indexed SQL recording matches. No history walk or derived matcher is awaited. Covered by home/mixBuildLibrary.test.ts.",
    capabilities: ["library/LibraryStore.ts#mixSongsPage"],
  },
  "playback/tasteDerivation.ts#tasteLibraryRows": {
    reason:
      "Due picks/shared taste seek at most 128 songs and identity-only artists per turn; sorting/mapping of the copy uses canonical runSteps. Due Home is screen-settled; taste-source stamps discard writes. Covered by tasteDerivation.test.ts and magicQueueJob.test.ts.",
    capabilities: [
      "library/LibraryStore.ts#mixSongsPage",
      "library/LibraryStore.ts#tasteArtistsPage",
    ],
  },
  "playback/tasteDerivation.ts#readTasteHistory": {
    reason:
      "Shared background taste walks chronological plays and raw favorite/download cursors, including empty decoded pages, at most 128 rows per turn. Covered by tasteDerivation.test.ts and db/mixInputs.test.ts.",
    capabilities: [
      "library/LibraryStore.ts#tastePlaysPage",
      "library/LibraryStore.ts#tasteFavoritesPage",
      "library/LibraryStore.ts#tasteDownloadsPage",
    ],
  },
  "playback/tasteDerivation.ts#tasteSnapshot": {
    reason:
      "Constant-size before/after stamps of taste-source writes protect yielding source walks without holding a transaction across scheduler turns; after three discarded walks the last runs in one task (ti's synchronous read), so a write storm can't livelock it. Covered by tasteSnapshot.test.ts and tasteDerivation.test.ts.",
    capabilities: ["library/LibraryStore.ts#tasteRevision"],
  },
  "playback/tasteDerivation.ts#stableTasteSnapshot": {
    reason:
      "The same constant-size stamps keep due picks current at publication, at most three attempts. Covered by tasteSnapshot.test.ts and magicQueueJob.test.ts.",
    capabilities: ["library/LibraryStore.ts#tasteRevision"],
  },
  "home/mixInputs.ts#readMixInputs": {
    reason:
      "Existing #594 daily mix background reader shares the bounded songs page; its multi-genre projection and cancellation remain owned by the mix build. Covered by db/mixInputs.test.ts.",
    capabilities: ["library/LibraryStore.ts#mixSongsPage"],
  },
};
