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
export type Appearance = "system" | "light" | "dark";

/** One window of a list, as a list call returns it. */
export interface Page<T> {
  readonly items: readonly T[];
  readonly offset: number;
  /** Rows in the whole list. */
  readonly total: number;
}

/** Each call's arguments and result. Arguments reach main as untrusted data. */
export interface BridgeContract {
  readonly "playback.view": { readonly args: readonly []; readonly result: PlayerView };
  readonly "playback.start": {
    readonly args: readonly [scope: BrowseScope, index?: number, shuffle?: boolean];
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
}

export type BridgeCall = keyof BridgeContract;

/** A list call that skips paging fails to compile here. */
type PagedLists<T> = {
  readonly [C in keyof T]: T[C] extends { readonly result: readonly unknown[] } ? never : T[C];
};
export const BRIDGE_CALLS = [
  "playback.view",
  "playback.start",
  "playback.command",
  "playback.play",
  "playback.pause",
  "playback.seek",
  "playback.undo",
  "playback.dismissUndo",
  "playback.favorite",
  "playback.volume",
  "playback.queue",

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
    readonly command: (command: PlaybackCommand) => Promise<void>;
    readonly play: () => Promise<void>;
    readonly pause: () => Promise<void>;
    readonly seek: (positionMs: number) => Promise<void>;
    readonly undo: () => Promise<void>;
    readonly dismissUndo: () => Promise<void>;
    readonly favorite: () => Promise<void>;
    readonly volume: (volume: number, muted: boolean) => Promise<void>;
    readonly queue: (offset: number, limit: number) => Promise<Page<QueueRow>>;
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
  };
}

export const createBridge = (invoke: Invoke): WaveBridge => ({
  playback: {
    view: () => invoke("playback.view"),
    start: (scope, index, shuffle) => invoke("playback.start", scope, index, shuffle),
    command: (command) => invoke("playback.command", command),
    play: () => invoke("playback.play"),
    pause: () => invoke("playback.pause"),
    seek: (positionMs) => invoke("playback.seek", positionMs),
    undo: () => invoke("playback.undo"),
    dismissUndo: () => invoke("playback.dismissUndo"),
    favorite: () => invoke("playback.favorite"),
    volume: (volume, muted) => invoke("playback.volume", volume, muted),
    queue: (offset, limit) => invoke("playback.queue", offset, limit),
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
  },
});
