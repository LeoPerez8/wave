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
  "library/LibraryStore.ts#listSongs",
  "library/LibraryStore.ts#listArtists",
  "library/LibraryStore.ts#tasteHistory",
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

export const WHOLE_LIBRARY: Record<string, Exception> = {
  "app/library/discover-mix/[id].tsx#DiscoverMixScreen": {
    reason: "Visible mix page resolves streamed entries against Library files.",
    capabilities: ["ytmusic/libraryFinder.ts#useLibraryFinder"],
  },
  "home/DiscoverMixActions.tsx#DiscoverMixActionsMenu": {
    reason:
      "Explicitly opened mix menu resolves downloads and playlist entries; not an always-mounted control.",
    capabilities: [
      "ytmusic/libraryFinder.ts#useLibraryFinder",
      "ytmusic/libraryFinder.ts#useLoadedInLibrary",
    ],
  },
  "home/DiscoverMixActions.tsx#openDiscoverMixActions": {
    reason:
      "Explicitly opened mix menu resolves downloads and playlist entries; not an always-mounted control.",
    capabilities: ["ytmusic/libraryFinder.ts#currentLibraryFinder"],
  },
  "home/discoverMixes.ts#useLibraryTracks": {
    reason:
      "Visible mix pages resolve Library tracks; Home blends saved mixes without this hook. Known videos are source-versioned and daily inputs run serially after settlement in bounded pages/CPU steps (knownVideosRead, mixInputs, settledWork and serialWork behavioral tests).",
    capabilities: ["library/hooks.ts#songs"],
  },
  "home/magicQueueSection.ts#MAGIC_QUEUE_LIBRARY": {
    reason:
      "Home Magic Queue row reads every song and artist for nine covers; replace with standing picks by id.",
    removeIn: 593,
    capabilities: ["library/LibraryStore.ts#listArtists", "library/LibraryStore.ts#listSongs"],
  },
  "library/BrowseLists.tsx#ArtistsList": {
    reason: "Visible Library Artists list displays all artists.",
    capabilities: ["library/hooks.ts#useArtists"],
  },
  "library/hooks.ts#listArtists": {
    reason:
      "Shared query definitions, used by the visible Library lists and background search index.",
    capabilities: ["library/LibraryStore.ts#listArtists"],
  },
  "library/hooks.ts#listSongs": {
    reason:
      "Shared query definitions, used by the visible Library lists and background search index.",
    capabilities: ["library/LibraryStore.ts#listSongs"],
  },
  "library/LibraryStore.ts#make": {
    reason:
      "The store implements the whole taste-history read; callers, rather than the driver, own scheduling.",
    capabilities: ["library/db/taste.ts#tasteHistory"],
  },
  "library/playlistImports.ts#listLibrary": {
    reason: "An explicit playlist import matches entries against the Library before saving.",
    capabilities: ["library/LibraryStore.ts#listSongs"],
  },
  "library/sectionSongs.ts#collections": {
    reason:
      "Explicit section actions read the selected section songs/artists for playback and menus.",
    capabilities: ["library/LibraryStore.ts#listArtists"],
  },
  "library/sectionSongs.ts#librarySectionSongs": {
    reason:
      "Explicit section actions read the selected section songs/artists for playback and menus.",
    capabilities: ["library/LibraryStore.ts#listSongs"],
  },
  "library/ytLibraryImport.ts#downloadPlaylist": {
    reason:
      "An explicit or resumed account import resolves playlist downloads against local files.",
    capabilities: ["ytmusic/libraryFinder.ts#currentLibraryFinder"],
  },
  "nowPlaying/hooks.ts#useDownloadedFile": {
    reason:
      "Now Playing downloaded-file lookup currently follows all songs; replace with one targeted lookup after sheet settled.",
    removeIn: 587,
    capabilities: ["ytmusic/libraryFinder.ts#useLoadedLibraryFinder"],
  },
  "nowPlaying/PlayerView.tsx#useNowPlayingStar": {
    reason:
      "Now Playing star currently follows the whole finder; replace with targeted song identity after sheet settled.",
    removeIn: 587,
    capabilities: ["ytmusic/libraryFinder.ts#useLoadedLibraryFinder"],
  },
  "nowPlaying/SongButtons.tsx#AddToPlaylistButton": {
    reason:
      "Now Playing Download/Add to Playlist currently ask the shared finder; replace with the targeted settled lookup.",
    removeIn: 587,
    capabilities: ["ytmusic/libraryFinder.ts#currentLibraryFinder"],
  },
  "nowPlaying/SongButtons.tsx#DownloadButton": {
    reason:
      "Now Playing Download/Add to Playlist currently ask the shared finder; replace with the targeted settled lookup.",
    removeIn: 587,
    capabilities: ["ytmusic/libraryFinder.ts#useLoadedLibraryFinder"],
  },
  "playback/ActionsMenu.tsx#usePlaylistDownloadEntries": {
    reason: "Visible playlist menu checks which entries are downloaded; created for a user action.",
    capabilities: ["ytmusic/libraryFinder.ts#useLoadedInLibrary"],
  },
  "playback/hooks.ts#useCurrentPlayingIds": {
    reason:
      "Playing-ids hook fans whole-Library updates out to mounted lists; replace with one current-song lookup.",
    removeIn: 588,
    capabilities: ["ytmusic/libraryFinder.ts#useLoadedLibraryFinder"],
  },
  "playback/itemActions.ts#useStreamedSongFinder": {
    reason: "A visible selection/menu resolves streamed items for user actions.",
    capabilities: ["ytmusic/libraryFinder.ts#useLibraryFinder"],
  },
  "playback/MagicQueue.ts#libraryNow": {
    reason: "Explicit Magic Queue start builds its candidate Library and artist map.",
    capabilities: ["library/LibraryStore.ts#listArtists", "library/LibraryStore.ts#listSongs"],
  },
  "playback/MagicQueue.ts#startMagicQueue": {
    reason: "Explicit Magic Queue start builds its candidate Library and artist map.",
    capabilities: ["library/LibraryStore.ts#listArtists"],
  },
  "playback/magicQueueRadio.ts#inLibraryOf": {
    reason:
      "Background radio batch resolves its candidates against an already supplied Library snapshot.",
    capabilities: ["../../../packages/core/src/ytMusic.ts#libraryFinder"],
  },
  "playback/magicSongs.ts#magicSongsOf": {
    reason:
      "Live taste signals map changed songs to their artist credits; share and step the taste derivation.",
    removeIn: 593,
    capabilities: ["library/LibraryStore.ts#listArtists"],
  },
  "playback/rowSwipe.ts#runTrackSwipe": {
    reason:
      "A completed swipe resolves its one requested action; it does not subscribe while rows render.",
    capabilities: ["ytmusic/libraryFinder.ts#currentLibraryFinder"],
  },
  "playback/TasteProfile.ts#live": {
    reason:
      "First live taste derivation reads whole history, songs and artists; reuse one input and derive in steps after settled.",
    removeIn: 593,
    capabilities: [
      "library/LibraryStore.ts#listArtists",
      "library/LibraryStore.ts#listSongs",
      "library/LibraryStore.ts#tasteHistory",
    ],
  },
  "search/searchIndex.ts#releasesOf": {
    reason:
      "Search deliberately shares the lists and lazily builds lookups; its index is built in yielding background steps.",
    capabilities: ["../../../packages/core/src/ytArtist.ts#libraryArtistFinder"],
  },
  "search/searchIndex.ts#useSearchIndex": {
    reason:
      "Search deliberately shares the lists and lazily builds lookups; its index is built in yielding background steps.",
    capabilities: [
      "library/hooks.ts#artists",
      "library/hooks.ts#songs",
      "ytmusic/libraryFinder.ts#useLoadedLibraryFinder",
    ],
  },
  "ytmusic/albumSection.ts#useYtAlbumSection": {
    reason:
      "The album opening policy enables the shared finder only after local content and screen settlement, with a loaded online release. Its local rows and offline note draw independently. albumOpening.test.ts checks real-store work and row placement.",
    capabilities: ["ytmusic/libraryFinder.ts#useLoadedLibraryFinder"],
  },
  "ytmusic/artistPage.ts#useLibraryReleases": {
    reason:
      "Only a settled, usable-network YT artist page with a standing full answer activates the shared artist/album identities and song finder. Offline/loading/failure render without those reads. See ytArtistPageOpening.test.ts and detailOpening.test.ts.",
    capabilities: [
      "../../../packages/core/src/ytArtist.ts#libraryArtistFinder",
      "library/hooks.ts#useArtists",
    ],
  },
  "ytmusic/artistPage.ts#useYtArtistPage": {
    reason:
      "Only a settled, usable-network YT artist page with a standing full answer activates the shared artist/album identities and song finder. Offline/loading/failure render without those reads. See ytArtistPageOpening.test.ts and detailOpening.test.ts.",
    capabilities: ["ytmusic/libraryFinder.ts#useLoadedLibraryFinder"],
  },
  "ytmusic/artistSection.ts#useDeferredArtistSection": {
    reason:
      "Online additions only: the artist opening policy gates this shared finder on local content, screen settlement, Online and a standing full answer. Library mode and missing, pending, partial or expired answers do not subscribe. See ytArtistOpening.test.ts and artistOpening.test.ts.",
    capabilities: ["ytmusic/libraryFinder.ts#useLoadedLibraryFinder"],
  },
  "ytmusic/artistSection.ts#useArtistSongsFinder": {
    reason:
      "Targeted finder over this artist's already read sorted songs, only when the deferred online finder exists; prefers a just-downloaded artist row without another read.",
    capabilities: ["../../../packages/core/src/ytMusic.ts#libraryFinder"],
  },
  "ytmusic/libraryFinder.ts#finderOver": {
    reason:
      "One shared finder implementation; following/building callers are inventoried separately.",
    capabilities: ["../../../packages/core/src/ytMusic.ts#libraryFinder"],
  },
  "ytmusic/libraryFinder.ts#songsQuery": {
    reason:
      "One shared finder implementation; following/building callers are inventoried separately.",
    capabilities: ["library/hooks.ts#songs"],
  },
  "ytmusic/libraryFinder.ts#useLibraryFinder": {
    reason:
      "One shared finder implementation; following/building callers are inventoried separately.",
    capabilities: ["ytmusic/libraryFinder.ts#useLoadedLibraryFinder"],
  },
  "ytmusic/libraryFinder.ts#useLoadedInLibrary": {
    reason:
      "One shared finder implementation; following/building callers are inventoried separately.",
    capabilities: ["ytmusic/libraryFinder.ts#useLoadedLibraryFinder"],
  },
  "ytmusic/YtAlbumActions.tsx#YtAlbumActionsMenu": {
    reason: "Explicit album menu resolves downloaded songs while the card is shown.",
    capabilities: [
      "ytmusic/libraryFinder.ts#useLibraryFinder",
      "ytmusic/libraryFinder.ts#useLoadedInLibrary",
    ],
  },
  "ytmusic/YtArtistActions.tsx#openYtArtistActions": {
    reason: "Explicit artist menu resolves its entries at action time.",
    capabilities: ["ytmusic/libraryFinder.ts#currentLibraryFinder"],
  },
  "ytmusic/YtDownloads.ts#forgetDeletedDownloads": {
    reason:
      "Download recovery runs on explicit/background work; the failed-download UI follows only while shown.",
    capabilities: ["library/LibraryStore.ts#listSongs"],
  },
  "ytmusic/YtDownloads.ts#forgetSettledFailures": {
    reason:
      "Download recovery runs on explicit/background work; the failed-download UI follows only while shown.",
    capabilities: [
      "../../../packages/core/src/ytMusic.ts#libraryFinder",
      "library/LibraryStore.ts#listSongs",
    ],
  },
  "ytmusic/YtDownloads.ts#requeueThrottledFailures": {
    reason:
      "Download recovery runs on explicit/background work; the failed-download UI follows only while shown.",
    capabilities: [
      "../../../packages/core/src/ytMusic.ts#libraryFinder",
      "library/LibraryStore.ts#listSongs",
    ],
  },
  "ytmusic/YtDownloads.ts#useFailedDownloadsInput": {
    reason:
      "Download recovery runs on explicit/background work; the failed-download UI follows only while shown.",
    capabilities: ["ytmusic/libraryFinder.ts#useLoadedLibraryFinder"],
  },
  "ytmusic/YtSongActions.tsx#useYtSongSwipe": {
    reason: "Explicit song menus and completed swipes resolve Library identity for their action.",
    capabilities: ["ytmusic/libraryFinder.ts#currentLibraryFinder"],
  },
  "ytmusic/YtSongActions.tsx#YtSongActionsMenu": {
    reason: "Explicit song menus and completed swipes resolve Library identity for their action.",
    capabilities: [
      "ytmusic/libraryFinder.ts#useLibraryFinder",
      "ytmusic/libraryFinder.ts#useLoadedInLibrary",
    ],
  },
  "ytmusic/YtSongList.tsx#useYtAlbumDownloadButton": {
    reason:
      "Only nonempty online album songs after screen settlement activate this finder. Library album openings with no online answer start no cold follower.",
    capabilities: [
      "ytmusic/libraryFinder.ts#useLoadedInLibrary",
      "ytmusic/libraryFinder.ts#useLoadedLibraryFinder",
    ],
  },
  "ytmusic/YtSongList.tsx#useYtPlaylistDownloadButton": {
    reason:
      "Visible online lists and their download buttons resolve local files; they are not the hidden Now Playing subtree.",
    capabilities: [
      "ytmusic/libraryFinder.ts#useLoadedInLibrary",
      "ytmusic/libraryFinder.ts#useLoadedLibraryFinder",
    ],
  },
  "ytmusic/YtSongList.tsx#YtSongList": {
    reason:
      "Only a loaded remote list after screen settlement follows the finder; offline/loading pages render without acquiring it.",
    capabilities: ["ytmusic/libraryFinder.ts#useLibraryFinder"],
  },
};
export const OPENING_REQUESTS: Record<string, Exception> = {
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
