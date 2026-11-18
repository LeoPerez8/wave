/**
 * The only way from Wave's window to its services. The preload exposes `createBridge`'s
 * object as `window.wave`; main answers each call in `BridgeContract` and nothing else.
 * A call that reads a list returns a `Page`, never the whole list.
 */
import type { PlayerView, PlaybackCommand, QueueRow } from "./playerView.ts";
import type { LibraryCounts } from "@wave/client/db/counts";
import type { PlaybackStatus } from "./playback.ts";
import type { PlaybackSettings } from "./playbackSettings.ts";
import type { SongTags } from "./tags.ts";
import type { DesktopFolder, DesktopSong, ScanStatus } from "./library.ts";
import type { BrowseScope, BrowsePage } from "./browse.ts";
import type { YtSearchPage } from "./yt.ts";
import type { AccountView } from "./account.ts";
import type { SongLyrics } from "./lyrics.ts";
import type { SleepTimer, SleepTimerChoice } from "@wave/core";
import {
  PLAYLIST_CALLS,
  playlistBridge,
  type PlaylistBridge,
  type PlaylistContract,
} from "./playlists.ts";
import type { LibrarySearchView } from "./search.ts";
import type {
  ActionSurface,
  SongMenu,
  SongRunAction,
  SongRunResult,
  SongTarget,
} from "./songActions.ts";
export type Appearance = "system" | "light" | "dark";

/** One window of a list, as a list call returns it. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly offset: number;
  /** Rows in the whole list. */
  readonly total: number;
}

/** Each call's arguments and result. Arguments reach main as untrusted data. */
export interface BridgeContract extends PlaylistContract {
  readonly "playback.view": { readonly args: readonly []; readonly result: PlayerView };
  readonly "playback.start": {
    readonly args: readonly [scope: BrowseScope, index?: number, shuffle?: boolean];
    readonly result: void;
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
  readonly "account.answerInvitation": { readonly args: readonly []; readonly result: void };

  readonly "settings.appearance": { readonly args: readonly []; readonly result: Appearance };
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
  readonly "settings.setYtMusic": { readonly args: readonly [on: boolean]; readonly result: void };
  /** YouTube Music's songs for a query; never fails, `status` says why there are none. */
  readonly "yt.search": { readonly args: readonly [query: string]; readonly result: YtSearchPage };
  /** A YouTube Music cover as a data URL, or null. */
  readonly "yt.artwork": { readonly args: readonly [url: string]; readonly result: string | null };
  readonly "library.artwork": {
    readonly args: readonly [hash: string, large: boolean];
    readonly result: string | null;
  };
  readonly "library.browse": {
    readonly args: readonly [scope: BrowseScope, offset: number, limit: number];
    readonly result: BrowsePage;
  };
  readonly "library.letter": {
    readonly args: readonly [scope: BrowseScope, letter: string];
    readonly result: number;
  };
  readonly "library.counts": { readonly args: readonly []; readonly result: LibraryCounts };
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
  readonly "songs.actions": {
    readonly args: readonly [target: SongTarget, surface: ActionSurface];
    readonly result: SongMenu;
  };
  /** Runs one of the entries main runs; Add to Playlist names the playlist. */
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
}

export type BridgeCall = keyof BridgeContract;

/** A list call that skips paging fails to compile here. */
type PagedLists<T> = {
  readonly [C in keyof T]: T[C] extends { readonly result: readonly unknown[] } ? never : T[C];
};
export const BRIDGE_CALLS = [
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

  "library.artwork",
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
  "songs.actions",
  "songs.run",
  "player.load",
  "player.play",
  "player.pause",
  "player.seek",
  "player.status",
  "tags.read",
  "settings.appearance",
  "settings.setAppearance",
  "settings.playback",
  "settings.setPlayback",
  "settings.ytMusic",
  "settings.setYtMusic",
  "yt.search",
  "yt.artwork",
  "account.view",
  "account.signIn",
  "account.cancelSignIn",
  "account.signOut",
  "account.signOutEverywhere",
  "account.answerInvitation",
  ...PLAYLIST_CALLS,
  "search.library",
  "search.recent",
  "search.remember",
  "search.clearRecent",
] as const satisfies readonly BridgeCall[] &
  (BridgeContract extends PagedLists<BridgeContract> ? unknown : never);

export type Invoke = <C extends BridgeCall>(
  call: C,
  ...args: BridgeContract[C]["args"]
) => Promise<BridgeContract[C]["result"]>;

/** `window.wave`. */
export interface WaveBridge {
  readonly playback: {
    readonly view: () => Promise<PlayerView>;
    readonly start: (scope: BrowseScope, index?: number, shuffle?: boolean) => Promise<void>;
    readonly startYt: (videoIds: readonly string[], index: number) => Promise<void>;
    readonly command: (command: PlaybackCommand) => Promise<void>;
    readonly play: () => Promise<void>;
    readonly pause: () => Promise<void>;
    readonly seek: (positionMs: number) => Promise<void>;
    readonly undo: () => Promise<void>;
    readonly dismissUndo: () => Promise<void>;
    readonly favorite: () => Promise<void>;
    readonly volume: (volume: number, muted: boolean) => Promise<void>;
    readonly queue: (offset: number, limit: number) => Promise<Page<QueueRow>>;
    readonly setSleepTimer: (choice: SleepTimerChoice | null) => Promise<SleepTimer | null>;
  };
  readonly lyrics: {
    readonly song: (trackId: string) => Promise<SongLyrics>;
  };
  readonly library: {
    readonly artwork: (hash: string, large: boolean) => Promise<string | null>;
    readonly browse: (scope: BrowseScope, offset: number, limit: number) => Promise<BrowsePage>;
    readonly letter: (scope: BrowseScope, letter: string) => Promise<number>;
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
  };
  readonly songs: {
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
    readonly appearance: () => Promise<Appearance>;
    readonly setAppearance: (appearance: Appearance) => Promise<void>;
    /** Settings › Playback: Crossfade, Normalize Volume and Buffer, synced with the account. */
    readonly playback: () => Promise<PlaybackSettings>;
    /** Keeps a change to Settings › Playback; it applies from the next song. */
    readonly setPlayback: (change: Partial<PlaybackSettings>) => Promise<PlaybackSettings>;
    readonly ytMusic: () => Promise<boolean>;
    readonly setYtMusic: (on: boolean) => Promise<void>;
  };
  readonly yt: {
    readonly search: (query: string) => Promise<YtSearchPage>;
    readonly artwork: (url: string) => Promise<string | null>;
  };
  /** The Wave account: the session itself never reaches the window. */
  readonly account: {
    readonly view: () => Promise<AccountView>;
    readonly signIn: () => Promise<void>;
    readonly cancelSignIn: () => Promise<void>;
    readonly signOut: () => Promise<void>;
    readonly signOutEverywhere: () => Promise<void>;
    readonly answerInvitation: () => Promise<void>;
  };
  /** Playlists' edits, images, Graveyard and M3U import. */
  readonly playlists: PlaylistBridge;
  /** Search over the Library, and its recent searches. */
  readonly search: {
    readonly library: (query: string) => Promise<LibrarySearchView>;
    readonly recent: () => Promise<Page<string>>;
    readonly remember: (query: string) => Promise<Page<string>>;
    readonly clearRecent: () => Promise<void>;
  };
}

export const createBridge = (invoke: Invoke): WaveBridge => ({
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
  },
  library: {
    artwork: (hash, large) => invoke("library.artwork", hash, large),
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
  },
  songs: {
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
    setAppearance: (appearance) => invoke("settings.setAppearance", appearance),
    playback: () => invoke("settings.playback"),
    setPlayback: (change) => invoke("settings.setPlayback", change),
    ytMusic: () => invoke("settings.ytMusic"),
    setYtMusic: (on) => invoke("settings.setYtMusic", on),
  },
  yt: {
    search: (query) => invoke("yt.search", query),
    artwork: (url) => invoke("yt.artwork", url),
  },
  account: {
    view: () => invoke("account.view"),
    signIn: () => invoke("account.signIn"),
    cancelSignIn: () => invoke("account.cancelSignIn"),
    signOut: () => invoke("account.signOut"),
    signOutEverywhere: () => invoke("account.signOutEverywhere"),
    answerInvitation: () => invoke("account.answerInvitation"),
  },
  playlists: playlistBridge(invoke),
  search: {
    library: (query) => invoke("search.library", query),
    recent: () => invoke("search.recent"),
    remember: (query) => invoke("search.remember", query),
    clearRecent: () => invoke("search.clearRecent"),
  },
});
