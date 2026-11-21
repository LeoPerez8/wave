/**
 * The only way from Wave's window to its services. The preload exposes `createBridge`'s
 * object as `window.wave`; main answers each call in `BridgeContract` and nothing else.
 * A call that reads a list returns a `Page`, never the whole list.
 */
import type {
  PlayerView,
  PlaybackCommand,
  PlaybackTransport,
  PlayStart,
  QueueRow,
} from "./playerView.ts";
import type { WindowSettings } from "./windowSettings.ts";
import type { DatedRelease, LanguageChoice, SongSortKey } from "@wave/core";

import type { LanguageView } from "./language.ts";
import type { LibraryCounts } from "@wave/client/db/counts";
import type { PlaybackStatus } from "./playback.ts";
import type { SongState } from "./songState.ts";
import type { PlaybackSettings } from "./playbackSettings.ts";
import type { SongTags } from "./tags.ts";
import type { DesktopFolder, DesktopSong, ScanStatus } from "./library.ts";
import type { BrowseKind, BrowseScope, BrowsePage, BrowseRow } from "./browse.ts";
import type { YtSearchPage, YtStatus } from "./yt.ts";
import type { SearchOnline } from "@wave/core";
import type {
  DiscoverMixesView,
  DiscoverSettings,
  MagicQueueView,
  YtAlbumView,
  YtArtistView,
  YtRelatedView,
} from "./ytPages.ts";
import type { AccountView } from "./account.ts";
import type { MissingSongsDownloadAction, SleepTimer, SleepTimerChoice } from "@wave/core";
import type {
  DownloadRow,
  DownloadsView,
  MissingSongsList,
  MissingSongsView,
} from "./downloads.ts";
import type { GeniusPhase, SongGenius, SongLyrics } from "./lyrics.ts";
import type { GeniusHitOpened, GeniusLyricsSearchView } from "./geniusLyricsSearch.ts";
import {
  PLAYLIST_CALLS,
  playlistBridge,
  type PlaylistBridge,
  type PlaylistContract,
} from "./playlists.ts";
import type { LibrarySearchView } from "./search.ts";
import type { HomeView } from "./home.ts";
import type { HomeFollowView, HomeReleaseOpening } from "./homeFollow.ts";
import type { StatsPeriod, StatsRanking } from "@wave/core";
import type { StatsOverview, StatsRow } from "./stats.ts";
import type {
  ActionSurface,
  SongMenu,
  SongRunAction,
  SongRunResult,
  SongTarget,
} from "./songActions.ts";
import type {
  CollectionActionOptions,
  CollectionMenu,
  CollectionRunAction,
  CollectionRunResult,
  CollectionTarget,
} from "./collectionActions.ts";
import {
  LYRICS_AND_TAGS_CALLS,
  lyricsAndTagsBridge,
  type LyricsAndTagsBridge,
  type LyricsAndTagsContract,
} from "./lyricsAndTags.ts";
import { LINK_CALLS, linkBridge, type LinkContract } from "./links.ts";
import { ARTIST_PAGE_CALLS, artistPageBridge, type ArtistPageContract } from "./artistPage.ts";
import { STREAMED_CALLS, streamedBridge, type StreamedContract } from "./streamedSongs.ts";
import { YT_ACCOUNT_CALLS, ytAccountBridge, type YtAccountContract } from "./ytAccount.ts";
import {
  SPOTIFY_ACCOUNT_CALLS,
  spotifyAccountBridge,
  type SpotifyAccountContract,
} from "./spotifyAccount.ts";
export type Appearance = "system" | "light" | "dark";

/** One window of a list, as a list call returns it. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly offset: number;
  /** Rows in the whole list. */
  readonly total: number;
}

export const VERSION_HISTORY_PAGE_SIZE = 20;

export interface DesktopVersionHistory {
  readonly version: string;
  readonly channel: "ti" | "main" | null;
  readonly currentListed: boolean;
  readonly releases: Page<DatedRelease> | null;
}

/** Each call's arguments and result. Arguments reach main as untrusted data. */
export interface BridgeContract
  extends
    PlaylistContract,
    LinkContract,
    ArtistPageContract,
    StreamedContract,
    LyricsAndTagsContract,
    YtAccountContract,
    SpotifyAccountContract {
  readonly "system.mediaBackend": {
    readonly args: readonly [];
    readonly result: "native" | "chromium";
  };
  readonly "settings.versionHistory": {
    readonly args: readonly [offset: number, reload: boolean];
    readonly result: DesktopVersionHistory;
  };
  readonly "settings.window": { readonly args: readonly []; readonly result: WindowSettings };
  readonly "settings.setWindow": {
    readonly args: readonly [change: Partial<WindowSettings>];
    readonly result: WindowSettings;
  };
  readonly "playback.view": { readonly args: readonly []; readonly result: PlayerView };
  readonly "playback.start": {
    readonly args: readonly [scope: BrowseScope, index?: number, shuffle?: boolean];
    readonly result: PlayStart;
  };
  readonly "playback.startYt": {
    readonly args: readonly [videoIds: readonly string[], index: number];
    readonly result: void;
  };
  readonly "playback.command": {
    readonly args: readonly [command: PlaybackCommand];
    readonly result: void;
  };
  readonly "playback.play": { readonly args: readonly []; readonly result: void };
  readonly "playback.pause": { readonly args: readonly []; readonly result: void };
  readonly "playback.seek": { readonly args: readonly [positionMs: number]; readonly result: void };
  readonly "playback.undo": { readonly args: readonly []; readonly result: void };
  readonly "playback.dismissUndo": { readonly args: readonly []; readonly result: void };
  readonly "playback.favorite": { readonly args: readonly []; readonly result: void };
  readonly "playback.volume": {
    readonly args: readonly [volume: number, muted: boolean];
    readonly result: void;
  };
  readonly "playback.queue": {
    readonly args: readonly [offset: number, limit: number];
    readonly result: Page<QueueRow>;
  };
  /** Starts a sleep timer, replacing the running one; null cancels it. Main enforces it. */
  /** What the Lyrics view shows for a queue track (`QueueEntry.trackId`). */
  readonly "lyrics.song": {
    readonly args: readonly [trackId: string];
    readonly result: SongLyrics;
  };
  readonly "lyrics.genius": {
    readonly args: readonly [trackId: string, requestId: string, phase: GeniusPhase];
    readonly result: SongGenius;
  };
  readonly "lyrics.cancelGenius": {
    readonly args: readonly [requestId: string];
    readonly result: void;
  };
  /** Search's online lyrics for a query: Genius's songs, or the line to show instead. */
  readonly "lyrics.searchOnline": {
    readonly args: readonly [query: string];
    readonly result: GeniusLyricsSearchView;
  };
  /** A click on a hit of the last answer, by Genius's song id. */
  readonly "lyrics.openOnlineHit": {
    readonly args: readonly [id: number];
    readonly result: GeniusHitOpened;
  };
  readonly "playback.setSleepTimer": {
    readonly args: readonly [choice: SleepTimerChoice | null];
    readonly result: SleepTimer | null;
  };

  readonly "account.view": { readonly args: readonly []; readonly result: AccountView };
  /** Opens Google's sign-in in the browser; resolves once it ended, however it did. */
  readonly "account.signIn": { readonly args: readonly []; readonly result: void };
  readonly "account.cancelSignIn": { readonly args: readonly []; readonly result: void };
  readonly "account.signOut": { readonly args: readonly []; readonly result: void };
  readonly "account.signOutEverywhere": { readonly args: readonly []; readonly result: void };
  readonly "account.deleteAccount": { readonly args: readonly []; readonly result: void };
  readonly "account.answerInvitation": { readonly args: readonly []; readonly result: void };

  readonly "settings.appearance": { readonly args: readonly []; readonly result: Appearance };
  readonly "settings.language": { readonly args: readonly []; readonly result: LanguageView };
  readonly "settings.setLanguage": {
    readonly args: readonly [choice: LanguageChoice];
    readonly result: void;
  };
  readonly "settings.setAppearance": {
    readonly args: readonly [appearance: Appearance];
    readonly result: void;
  };
  readonly "settings.playback": { readonly args: readonly []; readonly result: PlaybackSettings };
  readonly "settings.setPlayback": {
    readonly args: readonly [change: Partial<PlaybackSettings>];
    readonly result: PlaybackSettings;
  };
  readonly "settings.ytMusic": { readonly args: readonly []; readonly result: boolean };
  readonly "settings.searchOnline": { readonly args: readonly []; readonly result: SearchOnline };
  readonly "settings.setSearchOnline": {
    readonly args: readonly [value: SearchOnline];
    readonly result: void;
  };
  readonly "settings.setYtMusic": { readonly args: readonly [on: boolean]; readonly result: void };
  /** YouTube Music's songs for a query; never fails, `status` says why there are none. */
  readonly "yt.search": { readonly args: readonly [query: string]; readonly result: YtSearchPage };
  /** A YouTube Music cover as a data URL, or null. */
  readonly "yt.artwork": { readonly args: readonly [url: string]; readonly result: string | null };
  readonly "downloads.view": { readonly args: readonly []; readonly result: DownloadsView };
  readonly "downloads.rows": {
    readonly args: readonly [offset: number, limit: number];
    readonly result: Page<DownloadRow>;
  };
  /** A page's missing songs and their downloads; null for no such page. */
  readonly "downloads.list": {
    readonly args: readonly [list: MissingSongsList];
    readonly result: MissingSongsView | null;
  };
  readonly "downloads.yt": {
    readonly args: readonly [videoIds: readonly string[]];
    readonly result: void;
  };
  readonly "downloads.missing": {
    readonly args: readonly [trackIds: readonly number[]];
    readonly result: void;
  };
  readonly "downloads.missingAction": {
    readonly args: readonly [action: MissingSongsDownloadAction, list?: MissingSongsList];
    readonly result: void;
  };
  readonly "downloads.retry": {
    readonly args: readonly [ids?: readonly string[]];
    readonly result: void;
  };
  readonly "downloads.cancel": {
    readonly args: readonly [ids: readonly string[]];
    readonly result: void;
  };
  readonly "downloads.clearFailed": { readonly args: readonly []; readonly result: void };
  readonly "downloads.folder": { readonly args: readonly []; readonly result: string };
  /** Asks for the folder downloads go to; null when cancelled. */
  readonly "downloads.pickFolder": { readonly args: readonly []; readonly result: string | null };
  readonly "downloads.bestQuality": { readonly args: readonly []; readonly result: boolean };
  readonly "downloads.setBestQuality": {
    readonly args: readonly [on: boolean];
    readonly result: boolean;
  };
  /** A YouTube Music artist page, by its browse id. */
  readonly "yt.artist": {
    readonly args: readonly [browseId: string];
    readonly result: YtArtistView;
  };
  /** The YouTube Music artist named [name]'s browse id, or null. */
  readonly "yt.findArtist": {
    readonly args: readonly [name: string];
    readonly result: { readonly status: YtStatus; readonly browseId: string | null };
  };
  /** A YouTube Music album page, by its browse id. */
  readonly "yt.album": { readonly args: readonly [browseId: string]; readonly result: YtAlbumView };
  /** The Related tab of the song playing. */
  readonly "yt.related": { readonly args: readonly []; readonly result: YtRelatedView };
  /** Plays a YouTube Music song a page brought now, or adds it to the end of the queue. */
  readonly "yt.queue": {
    readonly args: readonly [type: "playNow" | "addToQueue", videoId: string];
    readonly result: void;
  };
  /** Discover's Magic Queue row: nine songs at random, the playlists' YT Music entries among them. */
  readonly "discover.picks": { readonly args: readonly []; readonly result: Page<BrowseRow> };
  /** Discover's Artist mixes, built once a day. */
  readonly "discover.mixes": { readonly args: readonly []; readonly result: DiscoverMixesView };
  readonly "discover.settings": { readonly args: readonly []; readonly result: DiscoverSettings };
  readonly "discover.setSettings": {
    readonly args: readonly [DiscoverSettings];
    readonly result: DiscoverSettings;
  };
  /** Plays today's mix [id] from its song [index]; false when the mix is gone. */
  readonly "discover.playMix": {
    readonly args: readonly [id: string, index: number];
    readonly result: boolean;
  };
  /** Plays a Magic Queue of [target]'s songs; false when none can play. */
  readonly "magicQueue.start": {
    readonly args: readonly [target: SongTarget];
    readonly result: boolean;
  };
  /** Plays a Magic Queue of a YouTube Music song's radio. */
  readonly "magicQueue.startStreamed": {
    readonly args: readonly [videoId: string];
    readonly result: void;
  };
  readonly "magicQueue.view": { readonly args: readonly []; readonly result: MagicQueueView };
  /** Try Again, after a batch found nothing. */
  readonly "magicQueue.retry": { readonly args: readonly []; readonly result: void };
  readonly "library.artwork": {
    readonly args: readonly [hash: string, large: boolean];
    readonly result: string | null;
  };
  readonly "library.cover": {
    readonly args: readonly [kind: "song" | "album" | "artist", id: number, large: boolean];
    readonly result: string | null;
  };
  readonly "library.browse": {
    readonly args: readonly [scope: BrowseScope, offset: number, limit: number];
    readonly result: BrowsePage;
  };
  readonly "library.letter": {
    readonly args: readonly [scope: BrowseScope, letter: string];
    readonly result: number | null;
  };
  readonly "library.counts": { readonly args: readonly []; readonly result: LibraryCounts };
  readonly "library.sortBy": {
    readonly args: readonly [kind: BrowseKind, key: SongSortKey];
    readonly result: void;
  };
  readonly "library.scanStatus": { readonly args: readonly []; readonly result: ScanStatus };
  readonly "library.refresh": { readonly args: readonly []; readonly result: void };
  readonly "library.songs": {
    readonly args: readonly [offset: number, limit: number];
    readonly result: Page<DesktopSong>;
  };
  readonly "library.roots": {
    readonly args: readonly [offset: number, limit: number];
    readonly result: Page<DesktopFolder>;
  };
  readonly "library.exclusions": {
    readonly args: readonly [offset: number, limit: number];
    readonly result: Page<string>;
  };
  readonly "library.addRoot": { readonly args: readonly []; readonly result: void };
  readonly "library.exclude": { readonly args: readonly []; readonly result: void };
  readonly "library.removeRoot": { readonly args: readonly [path: string]; readonly result: void };
  readonly "library.include": { readonly args: readonly [path: string]; readonly result: void };
  /** The entries a song's menu (or the selection bar) offers for [target]. */
  readonly "songs.states": {
    readonly args: readonly [ids: readonly number[]];
    readonly result: Page<SongState>;
  };
  readonly "songs.actions": {
    readonly args: readonly [target: SongTarget, surface: ActionSurface];
    readonly result: SongMenu;
  };
  /** Runs one of the entries main runs; Add to Playlist names the playlist. */
  readonly "collections.actions": {
    readonly args: readonly [target: CollectionTarget, options?: CollectionActionOptions];
    readonly result: CollectionMenu;
  };
  readonly "collections.run": {
    readonly args: readonly [
      target: CollectionTarget,
      action: CollectionRunAction,
      playlistId?: number,
    ];
    readonly result: CollectionRunResult;
  };
  readonly "songs.run": {
    readonly args: readonly [target: SongTarget, action: SongRunAction, playlistId?: number];
    readonly result: SongRunResult;
  };
  /** Opens an audio file by its absolute path, paused at its start. */
  readonly "player.load": {
    readonly args: readonly [path: string];
    readonly result: PlaybackStatus;
  };
  readonly "player.play": { readonly args: readonly []; readonly result: PlaybackStatus };
  readonly "player.pause": { readonly args: readonly []; readonly result: PlaybackStatus };
  readonly "player.seek": {
    readonly args: readonly [positionMs: number];
    readonly result: PlaybackStatus;
  };
  readonly "player.status": { readonly args: readonly []; readonly result: PlaybackStatus };
  /** Reads an audio file's tags, by its absolute path, as the phone's scan does. */
  readonly "tags.read": { readonly args: readonly [path: string]; readonly result: SongTags };
  /** The Library's results for a query, ranked as the phone ranks them. */
  readonly "search.library": {
    readonly args: readonly [query: string];
    readonly result: LibrarySearchView;
  };
  /** The recent searches, newest first: all of them, at most Core's `RECENT_SEARCHES`. */
  readonly "search.recent": { readonly args: readonly []; readonly result: Page<string> };
  /** Keeps a search (Core's `rememberSearch`) and answers the list as it is now. */
  readonly "search.remember": {
    readonly args: readonly [query: string];
    readonly result: Page<string>;
  };
  readonly "search.clearRecent": { readonly args: readonly []; readonly result: void };
  readonly "home.view": { readonly args: readonly []; readonly result: HomeView };
  readonly "home.play": {
    readonly args: readonly [section: "most-played" | "favorites", index: number];
    readonly result: void;
  };
  readonly "home.follow": { readonly args: readonly []; readonly result: HomeFollowView };
  readonly "home.followCheck": { readonly args: readonly []; readonly result: boolean };
  readonly "home.openRelease": {
    readonly args: readonly [key: string];
    readonly result: HomeReleaseOpening;
  };
  readonly "home.releaseArtwork": {
    readonly args: readonly [key: string];
    readonly result: string | null;
  };
  readonly "stats.overview": {
    readonly args: readonly [period: StatsPeriod];
    readonly result: StatsOverview;
  };
  readonly "stats.ranking": {
    readonly args: readonly [ranking: StatsRanking, period: StatsPeriod];
    readonly result: Page<StatsRow>;
  };
  readonly "stats.play": {
    readonly args: readonly [period: StatsPeriod, key: string, full: boolean];
    readonly result: void;
  };
  readonly "stats.open": {
    readonly args: readonly [
      ranking: "albums" | "artists",
      period: StatsPeriod,
      key: string,
      full: boolean,
    ];
    readonly result: string | null;
  };
}

export type BridgeCall = keyof BridgeContract;

/** A list call that skips paging fails to compile here. */
type PagedLists<T> = {
  readonly [C in keyof T]: T[C] extends { readonly result: readonly unknown[] } ? never : T[C];
};
export const BRIDGE_CALLS = [
  "system.mediaBackend",
  "playback.view",
  "playback.start",
  "playback.startYt",
  "playback.command",
  "playback.play",
  "playback.pause",
  "playback.seek",
  "playback.undo",
  "playback.dismissUndo",
  "playback.favorite",
  "playback.volume",
  "playback.queue",
  "playback.setSleepTimer",
  "lyrics.song",
  "lyrics.genius",
  "lyrics.cancelGenius",
  "lyrics.searchOnline",
  "lyrics.openOnlineHit",

  "library.artwork",
  "library.cover",
  "library.browse",
  "library.letter",
  "library.counts",
  "library.scanStatus",
  "library.refresh",
  "library.songs",
  "library.roots",
  "library.exclusions",
  "library.addRoot",
  "library.exclude",
  "library.removeRoot",
  "library.include",
  "library.sortBy",
  "songs.states",
  "songs.actions",
  "songs.run",
  "player.load",
  "player.play",
  "player.pause",
  "player.seek",
  "player.status",
  "tags.read",
  "settings.appearance",
  "settings.language",
  "settings.setLanguage",
  "settings.versionHistory",
  "settings.window",
  "settings.setWindow",
  "settings.setAppearance",
  "settings.playback",
  "settings.setPlayback",
  "settings.ytMusic",
  "settings.searchOnline",
  "settings.setSearchOnline",
  "settings.setYtMusic",
  "yt.search",
  "yt.artwork",
  "yt.artist",
  "yt.findArtist",
  "yt.album",
  "yt.related",
  "yt.queue",
  "discover.picks",
  "discover.mixes",
  "discover.settings",
  "discover.setSettings",
  "discover.playMix",
  "magicQueue.start",
  "magicQueue.startStreamed",
  "magicQueue.view",
  "magicQueue.retry",
  "downloads.view",
  "downloads.rows",
  "downloads.list",
  "downloads.yt",
  "downloads.missing",
  "downloads.missingAction",
  "downloads.retry",
  "downloads.cancel",
  "downloads.clearFailed",
  "downloads.folder",
  "downloads.pickFolder",
  "downloads.bestQuality",
  "downloads.setBestQuality",
  "account.view",
  "account.signIn",
  "account.cancelSignIn",
  "account.signOut",
  "account.signOutEverywhere",
  "account.deleteAccount",
  "account.answerInvitation",
  "collections.actions",
  "collections.run",
  ...PLAYLIST_CALLS,
  ...LYRICS_AND_TAGS_CALLS,
  "search.library",
  "search.recent",
  "search.remember",
  "search.clearRecent",
  "home.view",
  "home.play",
  "home.follow",
  "home.followCheck",
  "home.openRelease",
  "home.releaseArtwork",
  ...LINK_CALLS,
  ...ARTIST_PAGE_CALLS,
  ...STREAMED_CALLS,
  ...YT_ACCOUNT_CALLS,
  ...SPOTIFY_ACCOUNT_CALLS,
  "stats.overview",
  "stats.ranking",
  "stats.play",
  "stats.open",
] as const satisfies readonly BridgeCall[] &
  (BridgeContract extends PagedLists<BridgeContract> ? unknown : never);

export type Invoke = <C extends BridgeCall>(
  call: C,
  ...args: BridgeContract[C]["args"]
) => Promise<BridgeContract[C]["result"]>;

/** `window.wave`. */
export interface WaveBridge {
  readonly links: ReturnType<typeof linkBridge>;
  readonly artistPage: ReturnType<typeof artistPageBridge>;
  /** A streamed YouTube Music song's menu. */
  readonly streamed: ReturnType<typeof streamedBridge>;
  /** The YouTube account: its session never reaches the window. */
  readonly ytAccount: ReturnType<typeof ytAccountBridge>;
  readonly spotifyAccount: ReturnType<typeof spotifyAccountBridge>;
  readonly stats: {
    readonly overview: (period: StatsPeriod) => Promise<StatsOverview>;
    readonly ranking: (ranking: StatsRanking, period: StatsPeriod) => Promise<Page<StatsRow>>;
    readonly play: (period: StatsPeriod, key: string, full: boolean) => Promise<void>;
    readonly open: (
      ranking: "albums" | "artists",
      period: StatsPeriod,
      key: string,
      full: boolean,
    ) => Promise<string | null>;
  };
  readonly system: { readonly mediaBackend: () => Promise<"native" | "chromium"> };
  readonly home: {
    readonly view: () => Promise<HomeView>;
    readonly play: (section: "most-played" | "favorites", index: number) => Promise<void>;
    /** New from Artists You Follow and Upcoming Shows, from what the last check saved. */
    readonly follow: () => Promise<HomeFollowView>;
    /** Checks followed artists' releases and shows that are due; true when the cards changed. */
    readonly followCheck: () => Promise<boolean>;
    readonly openRelease: (key: string) => Promise<HomeReleaseOpening>;
    /** A release card's cover as a data URL, or null. */
    readonly releaseArtwork: (key: string) => Promise<string | null>;
  };
  readonly playback: PlaybackTransport & {
    readonly view: () => Promise<PlayerView>;
    readonly start: (scope: BrowseScope, index?: number, shuffle?: boolean) => Promise<PlayStart>;
    readonly dismissUndo: () => Promise<void>;
    readonly favorite: () => Promise<void>;
    readonly volume: (volume: number, muted: boolean) => Promise<void>;
    readonly queue: (offset: number, limit: number) => Promise<Page<QueueRow>>;
    readonly setSleepTimer: (choice: SleepTimerChoice | null) => Promise<SleepTimer | null>;
  };
  readonly lyrics: {
    readonly song: (trackId: string) => Promise<SongLyrics>;
    readonly genius: (
      trackId: string,
      requestId: string,
      phase: GeniusPhase,
    ) => Promise<SongGenius>;
    readonly cancelGenius: (requestId: string) => Promise<void>;
    readonly searchOnline: (query: string) => Promise<GeniusLyricsSearchView>;
    readonly openOnlineHit: (id: number) => Promise<GeniusHitOpened>;
  };
  readonly library: {
    readonly artwork: (hash: string, large: boolean) => Promise<string | null>;
    readonly cover: (
      kind: "song" | "album" | "artist",
      id: number,
      large: boolean,
    ) => Promise<string | null>;
    readonly browse: (scope: BrowseScope, offset: number, limit: number) => Promise<BrowsePage>;
    readonly letter: (scope: BrowseScope, letter: string) => Promise<number | null>;
    readonly counts: () => Promise<LibraryCounts>;
    readonly scanStatus: () => Promise<ScanStatus>;
    readonly refresh: () => Promise<void>;
    readonly songs: (offset: number, limit: number) => Promise<Page<DesktopSong>>;
    readonly roots: (offset: number, limit: number) => Promise<Page<DesktopFolder>>;
    readonly exclusions: (offset: number, limit: number) => Promise<Page<string>>;
    readonly addRoot: () => Promise<void>;
    readonly exclude: () => Promise<void>;
    readonly removeRoot: (path: string) => Promise<void>;
    readonly include: (path: string) => Promise<void>;
    readonly sortBy: (kind: BrowseKind, key: SongSortKey) => Promise<void>;
  };
  readonly songs: {
    /** Where each song's download is and whether its file failed to play; 200 songs at most. */
    readonly states: (ids: readonly number[]) => Promise<Page<SongState>>;
    readonly actions: (target: SongTarget, surface: ActionSurface) => Promise<SongMenu>;
    readonly run: (
      target: SongTarget,
      action: SongRunAction,
      playlistId?: number,
    ) => Promise<SongRunResult>;
  };
  /** One song at a time; each call answers with the engine's status after it. */
  readonly player: {
    readonly load: (path: string) => Promise<PlaybackStatus>;
    readonly play: () => Promise<PlaybackStatus>;
    readonly pause: () => Promise<PlaybackStatus>;
    readonly seek: (positionMs: number) => Promise<PlaybackStatus>;
    readonly status: () => Promise<PlaybackStatus>;
  };
  readonly tags: {
    readonly read: (path: string) => Promise<SongTags>;
  };
  readonly settings: {
    readonly versionHistory: (offset: number, reload: boolean) => Promise<DesktopVersionHistory>;
    readonly window: () => Promise<WindowSettings>;
    readonly setWindow: (change: Partial<WindowSettings>) => Promise<WindowSettings>;
    readonly appearance: () => Promise<Appearance>;
    readonly language: () => Promise<LanguageView>;
    readonly setLanguage: (choice: LanguageChoice) => Promise<void>;
    readonly setAppearance: (appearance: Appearance) => Promise<void>;
    /** Settings › Playback: Crossfade, Normalize Volume and Buffer, synced with the account. */
    readonly playback: () => Promise<PlaybackSettings>;
    /** Keeps a change to Settings › Playback; it applies from the next song. */
    readonly setPlayback: (change: Partial<PlaybackSettings>) => Promise<PlaybackSettings>;
    readonly ytMusic: () => Promise<boolean>;
    readonly searchOnline: () => Promise<SearchOnline>;
    readonly setSearchOnline: (value: SearchOnline) => Promise<void>;
    readonly setYtMusic: (on: boolean) => Promise<void>;
  };
  readonly yt: {
    readonly search: (query: string) => Promise<YtSearchPage>;
    readonly artwork: (url: string) => Promise<string | null>;
    readonly artist: (browseId: string) => Promise<YtArtistView>;
    readonly findArtist: (
      name: string,
    ) => Promise<{ readonly status: YtStatus; readonly browseId: string | null }>;
    readonly album: (browseId: string) => Promise<YtAlbumView>;
    readonly related: () => Promise<YtRelatedView>;
    readonly queue: (type: "playNow" | "addToQueue", videoId: string) => Promise<void>;
  };
  readonly discover: {
    readonly picks: () => Promise<Page<BrowseRow>>;
    readonly mixes: () => Promise<DiscoverMixesView>;
    readonly settings: () => Promise<DiscoverSettings>;
    readonly setSettings: (value: DiscoverSettings) => Promise<DiscoverSettings>;
    readonly playMix: (id: string, index: number) => Promise<boolean>;
  };
  readonly magicQueue: {
    readonly start: (target: SongTarget) => Promise<boolean>;
    readonly startStreamed: (videoId: string) => Promise<void>;
    readonly view: () => Promise<MagicQueueView>;
    readonly retry: () => Promise<void>;
  };
  /** Downloads into the Library: YT Music songs and missing songs, from YouTube Music or Soulseek. */
  readonly downloads: {
    readonly view: () => Promise<DownloadsView>;
    readonly rows: (offset: number, limit: number) => Promise<Page<DownloadRow>>;
    readonly list: (list: MissingSongsList) => Promise<MissingSongsView | null>;
    readonly yt: (videoIds: readonly string[]) => Promise<void>;
    readonly missing: (trackIds: readonly number[]) => Promise<void>;
    /** Download All, Retry Failed or Cancel on every missing song, or one page's. */
    readonly missingAction: (
      action: MissingSongsDownloadAction,
      list?: MissingSongsList,
    ) => Promise<void>;
    readonly retry: (ids?: readonly string[]) => Promise<void>;
    readonly cancel: (ids: readonly string[]) => Promise<void>;
    readonly clearFailed: () => Promise<void>;
    readonly folder: () => Promise<string>;
    readonly pickFolder: () => Promise<string | null>;
    readonly bestQuality: () => Promise<boolean>;
    readonly setBestQuality: (on: boolean) => Promise<boolean>;
  };
  /** The Wave account: the session itself never reaches the window. */
  readonly account: {
    readonly view: () => Promise<AccountView>;
    readonly signIn: () => Promise<void>;
    readonly cancelSignIn: () => Promise<void>;
    readonly signOut: () => Promise<void>;
    readonly signOutEverywhere: () => Promise<void>;
    /** Delete Account, once confirmed: resolves when it ended, however it did. */
    readonly deleteAccount: () => Promise<void>;
    readonly answerInvitation: () => Promise<void>;
  };
  /** Playlists' edits, images, Graveyard and M3U import. */
  readonly collections: {
    readonly actions: (
      target: CollectionTarget,
      options?: CollectionActionOptions,
    ) => Promise<CollectionMenu>;
    readonly run: (
      target: CollectionTarget,
      action: CollectionRunAction,
      playlistId?: number,
    ) => Promise<CollectionRunResult>;
  };
  readonly playlists: PlaylistBridge;
  /** Settings › Lyrics and tags. */
  readonly lyricsAndTags: LyricsAndTagsBridge;
  /** Search over the Library, and its recent searches. */
  readonly search: {
    readonly library: (query: string) => Promise<LibrarySearchView>;
    readonly recent: () => Promise<Page<string>>;
    readonly remember: (query: string) => Promise<Page<string>>;
    readonly clearRecent: () => Promise<void>;
  };
}

export const createBridge = (invoke: Invoke): WaveBridge => ({
  system: { mediaBackend: () => invoke("system.mediaBackend") },
  playback: {
    view: () => invoke("playback.view"),
    start: (scope, index, shuffle) => invoke("playback.start", scope, index, shuffle),
    startYt: (videoIds, index) => invoke("playback.startYt", videoIds, index),
    command: (command) => invoke("playback.command", command),
    play: () => invoke("playback.play"),
    pause: () => invoke("playback.pause"),
    seek: (positionMs) => invoke("playback.seek", positionMs),
    undo: () => invoke("playback.undo"),
    dismissUndo: () => invoke("playback.dismissUndo"),
    favorite: () => invoke("playback.favorite"),
    volume: (volume, muted) => invoke("playback.volume", volume, muted),
    queue: (offset, limit) => invoke("playback.queue", offset, limit),
    setSleepTimer: (choice) => invoke("playback.setSleepTimer", choice),
  },
  lyrics: {
    song: (trackId) => invoke("lyrics.song", trackId),
    genius: (trackId, requestId, phase) => invoke("lyrics.genius", trackId, requestId, phase),
    cancelGenius: (requestId) => invoke("lyrics.cancelGenius", requestId),
    searchOnline: (query) => invoke("lyrics.searchOnline", query),
    openOnlineHit: (id) => invoke("lyrics.openOnlineHit", id),
  },
  library: {
    artwork: (hash, large) => invoke("library.artwork", hash, large),
    cover: (kind, id, large) => invoke("library.cover", kind, id, large),
    browse: (scope, offset, limit) => invoke("library.browse", scope, offset, limit),
    letter: (scope, letter) => invoke("library.letter", scope, letter),
    counts: () => invoke("library.counts"),
    scanStatus: () => invoke("library.scanStatus"),
    refresh: () => invoke("library.refresh"),
    songs: (offset, limit) => invoke("library.songs", offset, limit),
    roots: (offset, limit) => invoke("library.roots", offset, limit),
    exclusions: (offset, limit) => invoke("library.exclusions", offset, limit),
    addRoot: () => invoke("library.addRoot"),
    exclude: () => invoke("library.exclude"),
    removeRoot: (path) => invoke("library.removeRoot", path),
    include: (path) => invoke("library.include", path),
    sortBy: (kind, key) => invoke("library.sortBy", kind, key),
  },
  songs: {
    states: (ids) => invoke("songs.states", ids),
    actions: (target, surface) => invoke("songs.actions", target, surface),
    run: (target, action, playlistId) => invoke("songs.run", target, action, playlistId),
  },
  player: {
    load: (path) => invoke("player.load", path),
    play: () => invoke("player.play"),
    pause: () => invoke("player.pause"),
    seek: (positionMs) => invoke("player.seek", positionMs),
    status: () => invoke("player.status"),
  },
  tags: {
    read: (path) => invoke("tags.read", path),
  },
  settings: {
    appearance: () => invoke("settings.appearance"),
    language: () => invoke("settings.language"),
    setLanguage: (choice) => invoke("settings.setLanguage", choice),
    versionHistory: (offset, reload) => invoke("settings.versionHistory", offset, reload),
    window: () => invoke("settings.window"),
    setWindow: (change) => invoke("settings.setWindow", change),
    setAppearance: (appearance) => invoke("settings.setAppearance", appearance),
    playback: () => invoke("settings.playback"),
    setPlayback: (change) => invoke("settings.setPlayback", change),
    ytMusic: () => invoke("settings.ytMusic"),
    searchOnline: () => invoke("settings.searchOnline"),
    setSearchOnline: (value) => invoke("settings.setSearchOnline", value),
    setYtMusic: (on) => invoke("settings.setYtMusic", on),
  },
  yt: {
    search: (query) => invoke("yt.search", query),
    artwork: (url) => invoke("yt.artwork", url),
    artist: (browseId) => invoke("yt.artist", browseId),
    findArtist: (name) => invoke("yt.findArtist", name),
    album: (browseId) => invoke("yt.album", browseId),
    related: () => invoke("yt.related"),
    queue: (type, videoId) => invoke("yt.queue", type, videoId),
  },
  discover: {
    picks: () => invoke("discover.picks"),
    mixes: () => invoke("discover.mixes"),
    settings: () => invoke("discover.settings"),
    setSettings: (value) => invoke("discover.setSettings", value),
    playMix: (id, index) => invoke("discover.playMix", id, index),
  },
  magicQueue: {
    start: (target) => invoke("magicQueue.start", target),
    startStreamed: (videoId) => invoke("magicQueue.startStreamed", videoId),
    view: () => invoke("magicQueue.view"),
    retry: () => invoke("magicQueue.retry"),
  },
  downloads: {
    view: () => invoke("downloads.view"),
    rows: (offset, limit) => invoke("downloads.rows", offset, limit),
    list: (list) => invoke("downloads.list", list),
    yt: (videoIds) => invoke("downloads.yt", videoIds),
    missing: (trackIds) => invoke("downloads.missing", trackIds),
    missingAction: (action, list) => invoke("downloads.missingAction", action, list),
    retry: (ids) => invoke("downloads.retry", ids),
    cancel: (ids) => invoke("downloads.cancel", ids),
    clearFailed: () => invoke("downloads.clearFailed"),
    folder: () => invoke("downloads.folder"),
    pickFolder: () => invoke("downloads.pickFolder"),
    bestQuality: () => invoke("downloads.bestQuality"),
    setBestQuality: (on) => invoke("downloads.setBestQuality", on),
  },
  account: {
    view: () => invoke("account.view"),
    signIn: () => invoke("account.signIn"),
    cancelSignIn: () => invoke("account.cancelSignIn"),
    signOut: () => invoke("account.signOut"),
    signOutEverywhere: () => invoke("account.signOutEverywhere"),
    deleteAccount: () => invoke("account.deleteAccount"),
    answerInvitation: () => invoke("account.answerInvitation"),
  },
  collections: {
    actions: (target, options) => invoke("collections.actions", target, options),
    run: (target, action, playlistId) => invoke("collections.run", target, action, playlistId),
  },
  playlists: playlistBridge(invoke),
  lyricsAndTags: lyricsAndTagsBridge(invoke),
  search: {
    library: (query) => invoke("search.library", query),
    recent: () => invoke("search.recent"),
    remember: (query) => invoke("search.remember", query),
    clearRecent: () => invoke("search.clearRecent"),
  },
  home: {
    view: () => invoke("home.view"),
    play: (section, index) => invoke("home.play", section, index),
    follow: () => invoke("home.follow"),
    followCheck: () => invoke("home.followCheck"),
    openRelease: (key) => invoke("home.openRelease", key),
    releaseArtwork: (key) => invoke("home.releaseArtwork", key),
  },
  links: linkBridge(invoke),
  artistPage: artistPageBridge(invoke),
  streamed: streamedBridge(invoke),
  ytAccount: ytAccountBridge(invoke),
  spotifyAccount: spotifyAccountBridge(invoke),
  stats: {
    overview: (period) => invoke("stats.overview", period),
    ranking: (ranking, period) => invoke("stats.ranking", ranking, period),
    play: (period, key, full) => invoke("stats.play", period, key, full),
    open: (ranking, period, key, full) => invoke("stats.open", ranking, period, key, full),
  },
});
