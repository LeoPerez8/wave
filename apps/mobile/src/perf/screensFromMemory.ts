/**
 * #1352's reviewed list: every local screen's first frame draws from memory
 * (Fluidity, "Real content in that frame"). Each screen names the hooks its
 * first frame draws, and each hook says how its data is in memory before the
 * screen opens; `screensFromMemoryGuard.test.ts` checks both against the
 * source, and that no screen reads the Library from its own render.
 */

/** How a hook's data is in memory before its screen opens. */
export type InMemory =
  /** A shared query `readyScreens.ts` keeps from startup: [name] is its query. */
  | { readonly kind: "kept"; readonly name: string }
  /** Drawn from the Library's rows Search's index keeps (`libraryMemory.ts`): [name] is the lookup. */
  | { readonly kind: "rows"; readonly name: string }
  /** Kept for the session as last read, and read at startup: [name] is the kept value. */
  | { readonly kind: "session"; readonly name: string }
  /**
   * Kept among the pushed screens opened last (`keepRecentlyOpened`); [name] is
   * its query, which `readyScreens.ts` may also keep ahead.
   */
  | { readonly kind: "recent"; readonly name: string }
  /** An external store held in memory for the session. */
  | { readonly kind: "store" };

/** Each hook a covered screen draws, as `file#symbol`, and how it's in memory. */
export const MEMORY_SOURCES: Record<string, InMemory> = {
  "library/hooks.ts#useAlbums": { kind: "kept", name: "listAlbums" },
  "library/hooks.ts#useArtists": { kind: "kept", name: "listArtists" },
  "library/hooks.ts#useGenres": { kind: "kept", name: "listGenres" },
  "library/hooks.ts#usePlaylists": { kind: "kept", name: "listPlaylists" },
  "library/hooks.ts#useFavoriteSongs": { kind: "kept", name: "listFavorites" },
  "library/playlistSort.ts#useSortedPlaylists": { kind: "kept", name: "playlistsLastPlayedQuery" },
  "library/dislikes.ts#useDislikeCount": { kind: "store" },
  "library/hooks.ts#useLibraryCounts": { kind: "kept", name: "countLibrary" },
  "library/hooks.ts#useTrackCount": { kind: "kept", name: "countTracks" },
  "library/hooks.ts#useScanRoots": { kind: "kept", name: "listRoots" },
  "library/hooks.ts#useLoadedScanRoots": { kind: "kept", name: "listRoots" },
  "library/hooks.ts#useLoadedExcludedFolders": { kind: "kept", name: "listExcludedFolders" },
  "library/hooks.ts#useHome": { kind: "kept", name: "readHomeAdded" },
  "library/pagedSongs.ts#useSongOrder": { kind: "kept", name: "songOrderQuery" },
  "library/pagedSongs.ts#usePagedSongs": { kind: "rows", name: "songSummariesInMemory" },
  "library/hooks.ts#useAlbum": { kind: "rows", name: "useMemoryAlbum" },
  "library/hooks.ts#useArtist": { kind: "rows", name: "useMemoryArtist" },
  "library/hooks.ts#usePlaylist": { kind: "recent", name: "playlistQuery" },
  "library/hooks.ts#usePlaylistGraveyard": { kind: "recent", name: "playlist-graveyard" },
  "library/GenreSongList.tsx#useGenreOpening": { kind: "recent", name: "genreOpeningQuery" },
  "collaboration/collaborativePlaylists.tsx#useCollaborations": {
    kind: "kept",
    name: "listCollaborations",
  },
  "library/collaborativePlaylists.tsx#usePrivateCopyNotice": { kind: "kept", name: "noticesQuery" },
  "library/dislikedSongList.ts#useDislikedSongList": { kind: "session", name: "keptList" },
  "library/useListeningHistory.ts#useListeningHistory": { kind: "session", name: "keptHead" },
  "stats/hooks.ts#useTopSongs": { kind: "session", name: "keptReadings" },
  "dj/DjScreen.tsx#useDjGrid": { kind: "session", name: "preparedDjOpening" },
  "updates/versionHistory.ts#useVersionHistory": { kind: "store" },
};

/** A covered screen: the files its first frame's hooks are called in, and those hooks. */
export interface ScreenFromMemory {
  /** Files besides the route that call [draws] (its screen component, its lists). */
  readonly via?: readonly string[];
  readonly draws: readonly string[];
}

const SECTION_LISTS: ScreenFromMemory = {
  via: [
    "library/SectionTab.tsx",
    "library/SectionList.tsx",
    "library/BrowseLists.tsx",
    "library/FavoritesList.tsx",
    "library/PlaylistsList.tsx",
    "library/SongsList.tsx",
    "library/playlistSort.ts",
  ],
  draws: [
    "library/hooks.ts#useAlbums",
    "library/hooks.ts#useArtists",
    "library/hooks.ts#useGenres",
    "library/hooks.ts#usePlaylists",
    "library/playlistSort.ts#useSortedPlaylists",
    "library/hooks.ts#useFavoriteSongs",
    "library/pagedSongs.ts#useSongOrder",
    "library/pagedSongs.ts#usePagedSongs",
  ],
};

/** Settings pages that draw only settings and stores kept in memory. */
const SETTINGS_ONLY: ScreenFromMemory = { draws: [] };

export const SCREENS_FROM_MEMORY: Record<string, ScreenFromMemory> = {
  "app/(tabs)/library.tsx": {
    draws: [
      "library/hooks.ts#useLibraryCounts",
      "library/hooks.ts#useTrackCount",
      "library/hooks.ts#useScanRoots",
      "library/hooks.ts#useHome",
    ],
  },
  "app/library/[section].tsx": SECTION_LISTS,
  "app/(tabs)/albums/index.tsx": SECTION_LISTS,
  "app/(tabs)/artists/index.tsx": SECTION_LISTS,
  "app/(tabs)/favorites/index.tsx": SECTION_LISTS,
  "app/(tabs)/genres/index.tsx": SECTION_LISTS,
  "app/(tabs)/playlists/index.tsx": SECTION_LISTS,
  "app/(tabs)/songs/index.tsx": SECTION_LISTS,
  "app/library/album/[id].tsx": { draws: ["library/hooks.ts#useAlbum"] },
  "app/library/artist/[id].tsx": { draws: ["library/hooks.ts#useArtist"] },
  "app/library/genre/[id].tsx": {
    via: ["library/GenreSongList.tsx"],
    draws: ["library/GenreSongList.tsx#useGenreOpening", "library/pagedSongs.ts#usePagedSongs"],
  },
  "app/library/playlist/[id].tsx": {
    via: ["library/collaborativePlaylists.tsx"],
    draws: [
      "library/hooks.ts#usePlaylist",
      "collaboration/collaborativePlaylists.tsx#useCollaborations",
      "library/collaborativePlaylists.tsx#usePrivateCopyNotice",
    ],
  },
  "app/library/playlist-graveyard/[id].tsx": { draws: ["library/hooks.ts#usePlaylistGraveyard"] },
  "app/library/stats/index.tsx": { draws: ["stats/hooks.ts#useTopSongs"] },
  "app/library/stats/[ranking].tsx": { draws: ["stats/hooks.ts#useTopSongs"] },
  "app/dj.tsx": { via: ["dj/DjScreen.tsx"], draws: ["dj/DjScreen.tsx#useDjGrid"] },
  "app/music-folders.tsx": {
    draws: ["library/hooks.ts#useLoadedScanRoots", "library/hooks.ts#useLoadedExcludedFolders"],
  },
  "app/settings/index.tsx": {
    via: ["settings/settingsSummaries.ts"],
    draws: ["library/hooks.ts#useScanRoots", "library/dislikes.ts#useDislikeCount"],
  },
  "app/settings/library.tsx": {
    via: ["settings/LibrarySettingsSection.tsx"],
    draws: ["library/hooks.ts#useScanRoots"],
  },
  "app/settings/disliked-songs.tsx": {
    draws: ["library/dislikedSongList.ts#useDislikedSongList"],
  },
  "app/settings/history.tsx": {
    draws: ["library/useListeningHistory.ts#useListeningHistory"],
  },
  "app/settings/version-history.tsx": { draws: ["updates/versionHistory.ts#useVersionHistory"] },
  "app/settings/accounts.tsx": SETTINGS_ONLY,
  "app/settings/appearance.tsx": SETTINGS_ONLY,
  "app/settings/developer.tsx": SETTINGS_ONLY,
  "app/settings/downloads.tsx": SETTINGS_ONLY,
  "app/settings/followed-artists.tsx": SETTINGS_ONLY,
  "app/settings/lyrics-and-tags.tsx": SETTINGS_ONLY,
  "app/settings/playback.tsx": SETTINGS_ONLY,
  "app/settings/layout/index.tsx": SETTINGS_ONLY,
  "app/settings/layout/home.tsx": SETTINGS_ONLY,
  "app/settings/layout/library.tsx": SETTINGS_ONLY,
  "app/settings/layout/playlists.tsx": SETTINGS_ONLY,
  "app/settings/layout/tab-bar.tsx": SETTINGS_ONLY,
  "app/settings/layout/now-playing/index.tsx": SETTINGS_ONLY,
  "app/settings/layout/now-playing/[slot].tsx": SETTINGS_ONLY,
  "app/settings/swipe-actions/index.tsx": SETTINGS_ONLY,
  "app/settings/swipe-actions/left.tsx": SETTINGS_ONLY,
  "app/settings/swipe-actions/right.tsx": SETTINGS_ONLY,
};

/**
 * Where a covered route reads the Library itself, outside its render: a press
 * that reads what the screen hadn't yet. Each says why.
 */
export const SCREEN_PRESS_READS: Record<string, string> = {
  "app/library/playlist/[id].tsx":
    "Play or Shuffle pressed before a long playlist's songs are read reads them for that press alone.",
};

/** Route files that aren't #1352's local screens, each with its reason. */
export const NOT_LOCAL_SCREENS: Record<string, string> = {
  "app/(tabs)/index.tsx": "Home: its ready data and cold-start snapshot are #1353's.",
  "app/(tabs)/search.tsx": "Search: its in-memory index is #1354's (searchIndex.ts).",
  "app/library/yt-album/[id].tsx": "An online YT Music album page: #1356 opens it from known data.",
  "app/library/yt-artist/[id].tsx":
    "An online YT Music artist page: #1356 opens it from known data.",
  "app/library/yt-playlist/[id].tsx":
    "An online YT Music playlist page: #1356 opens it from known data.",
  "app/library/discover-mix/[id].tsx":
    "A Home mix's page: Home's mixes and their data are #1353's.",
  "app/library/discover.tsx": "A redirect to Home's Discover section, which draws nothing itself.",
  "app/recap/[id].tsx":
    "A Recap's stories over everything, built from Stats; not one of the ticket's screens.",
  "app/access.tsx":
    "The all-files access prompt before any Library exists; it reads no Library data.",
  "app/design-preview.tsx": "A developer design preview that draws no Library data at all.",
  "app/dev/glass.tsx": "A developer glass test screen that draws no Library data at all.",
  "app/+native-intent.tsx": "Routes a link from outside the app into a screen; it draws nothing.",
};
