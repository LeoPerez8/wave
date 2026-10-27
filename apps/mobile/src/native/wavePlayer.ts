import type {
  AutoLyricsText,
  PlayerCoverUpdate,
  PlaySource,
  RepeatMode,
  SavedQueueParts,
  SeekSource,
  SleepTimer,
  SongChangeCause,
} from "@wave/core";
import { NativeModule, requireNativeModule } from "expo";

/** One track handed to the native player (`modules/wave-native`, `WavePlayerModule`). */
export interface PlayerItem {
  /** The queue entry key (unique per entry, not the track id). */
  readonly id: string;
  /** The audio file, or a YT Music song's track id (`yt:<videoId>`), which the player streams. */
  readonly path: string;
  readonly title: string;
  readonly artist: string;
  readonly album: string | null;
  /**
   * Full-size artwork file for the notification and lock screen; for a YT
   * Music song whose cover isn't cached, its address.
   */
  readonly artworkPath: string | null;
}

export interface PlayerPosition {
  readonly positionMs: number;
  readonly durationMs: number | null;
  /** Wall-clock time (ms) the position was read at. */
  readonly at: number;
}

export interface NativePlayerState extends PlayerPosition {
  readonly status: "idle" | "buffering" | "ready" | "ended";
  readonly isPlaying: boolean;
  readonly playWhenReady: boolean;
  readonly index: number | null;
  readonly item: {
    readonly id: string;
    readonly title: string | null;
    readonly artist: string | null;
    readonly album: string | null;
    readonly artworkUri: string | null;
  } | null;
}

export interface ItemTransitionEvent {
  readonly itemId: string | null;
  /**
   * Played through, repeated, skipped or seeked to (notification, Bluetooth),
   * the item list changed, or Wave's own queue sync moved it.
   */
  readonly reason: "auto" | "repeat" | "seek" | "playlist" | "sync" | "crossfade";
}

/**
 * The player jumped within the current item (a seek from Wave, the scrubber,
 * or "previous" after three seconds from the notification or a headset).
 */
export interface SeekEvent {
  readonly itemId: string | null;
  readonly fromMs: number;
  readonly toMs: number;
  /** Wall-clock time (ms) of the jump. */
  readonly at: number;
}

export interface PlayerErrorEvent {
  readonly itemId: string | null;
  readonly message: string;
  /** Why a YT Music song couldn't stream (Core's `PlayerErrorCode`); null for anything else. */
  readonly code: string | null;
}

/** One step of Core's `planPlayerSync`, flattened for the native module. */
export interface NativeSyncStep {
  readonly type: "clear" | "replace" | "seek" | "edit";
  readonly at?: number;
  readonly removeCount?: number;
  readonly keys?: readonly string[];
  readonly index?: number;
  readonly key?: string;
}

export interface NativeItemIds {
  readonly keys: readonly string[];
  readonly currentKey: string | null;
}

/** The running sleep timer (Core's `SleepTimer`), or null, whenever it changes. */
export interface SleepTimerEvent {
  readonly timer: SleepTimer | null;
}

/**
 * A question from Android Auto, forwarded by the media library service. Answer
 * every one with `respondAuto` or `failAuto`: the service gives up after a few
 * seconds and shows Auto a "still loading" message.
 */
export interface AutoRequestEvent {
  readonly id: number;
  readonly type: AutoRequest["type"];
  /** JSON: the request's other fields (see `AutoRequest`). */
  readonly payload: string;
}

/**
 * An Auto request with its payload. Browse requests are answered with Core's
 * `AutoItem` (or `AutoItem[]`) as JSON; `play` with an `AutoPlayback`.
 */
export type AutoRequest =
  /** One page of a node's children: an `AutoItem[]`. */
  | {
      readonly type: "children";
      readonly parentId: string;
      readonly page: number;
      readonly pageSize: number;
    }
  /** One node by media ID: an `AutoItem`. */
  | { readonly type: "item"; readonly mediaId: string }
  /** Auto played a node: start its queue and answer the items the session sets on the player. */
  | { readonly type: "play"; readonly mediaId: string }
  /**
   * Auto added nodes to the queue: add their tracks through the queue engine
   * (which puts them on the player), then answer `null`.
   */
  | { readonly type: "add"; readonly mediaIds: readonly string[] }
  /**
   * A tap on Auto's shuffle or repeat button: change the queue's mode as the
   * app's buttons do, then answer `null` (the new modes go out with `setModes`).
   * `moreFromArtist` adds the current artist's next most played songs after
   * the current track.
   */
  | {
      readonly type: "command";
      readonly command: "toggleShuffle" | "cycleRepeat" | "moreFromArtist";
    };

/** The answer to a `play` request: the new player list and the item to start at. */
export interface AutoPlayback {
  readonly items: readonly PlayerItem[];
  readonly startIndex: number;
}

/** The Lyrics toggle on Auto's player screen, and whether Auto is connected. */
export interface AutoLyricsEvent {
  readonly on: boolean;
  readonly carConnected: boolean;
}

/** The song fading out in a crossfade went silent, or was cut off by a skip. */
export interface CrossfadeEndedEvent {
  /** Wall-clock ms. */
  readonly at: number;
}

type WavePlayerEvents = {
  onCrossfade: (event: CrossfadeEndedEvent) => void;
  onPlaybackState: (state: NativePlayerState) => void;
  onPosition: (position: PlayerPosition) => void;
  onItemTransition: (event: ItemTransitionEvent) => void;
  onSeek: (event: SeekEvent) => void;
  onPlayerError: (event: PlayerErrorEvent) => void;
  onSleepTimer: (event: SleepTimerEvent) => void;
  onAutoRequest: (event: AutoRequestEvent) => void;
  onAutoLyrics: (event: AutoLyricsEvent) => void;
};

declare class WavePlayerModule extends NativeModule<WavePlayerEvents> {
  /**
   * The overlap for songs ending on their own, in ms (Core's
   * `crossfadeDuration`; 0 is off). Kept natively, so the service fades while
   * JS is suspended too.
   */
  setCrossfadeDuration(durationMs: number): Promise<void>;
  /**
   * How much streamed audio to keep loaded ahead, in ms (Core's
   * `streamBufferMs`). Kept natively, so it holds without JS too; library
   * files keep the player's default.
   */
  setStreamBuffer(aheadMs: number): Promise<void>;
  /**
   * The player entry whose next song is an unsearched one still being searched (Core's
   * `searchingAfter`), or null: a crossfade from it waits for the search at full volume.
   */
  setSearchingAfter(key: string | null): Promise<void>;
  /**
   * Edits the item list per the plan; `items` holds only the keys new to the player.
   * `cause` names a song change the plan makes in the app log's crossfade lines.
   */
  applySync(
    steps: readonly NativeSyncStep[],
    items: readonly PlayerItem[],
    cause: SongChangeCause,
  ): Promise<void>;
  setRepeatMode(mode: RepeatMode): Promise<void>;
  /** The queue's shuffle and repeat, for the toggles on Auto's player screen. */
  setModes(shuffle: boolean, repeat: RepeatMode): Promise<void>;
  /**
   * The chosen primary (`#rrggbb`) in each scheme, kept on disk for the media
   * notification wherever the system colours it from the app.
   */
  setNotificationAccent(light: string, dark: string): Promise<void>;
  getItemIds(): Promise<NativeItemIds>;
  /**
   * Gives loaded items new artwork (Core's `playerCoverUpdates`: a YT Music
   * cover cached after its item was set), without touching playback. Keys
   * the player doesn't hold are skipped.
   */
  setItemArtwork(updates: readonly PlayerCoverUpdate[]): Promise<void>;
  /**
   * Keeps the queue's changed parts (Core's `queueWrite`; null parts are
   * unchanged) in the native process, for when JS restarts, and on disk with
   * where it was started from, for a cold start (playback resumption).
   */
  saveQueue(
    queue: string | null,
    metadata: string | null,
    index: number | null,
    source: PlaySource,
  ): Promise<void>;
  /** The parts saved last (Core's `savedQueueState` reads them); null before a queue was saved. */
  savedQueue(): SavedQueueParts | null;
  /** Where the saved queue was started from; null before any was saved. */
  savedQueueSource(): PlaySource | null;
  /**
   * Whether the player resumed the saved queue on its own after Wave's process
   * died (its plays are new, not ones on record going on). Reading it clears it.
   */
  takeResumed(): boolean;
  play(): Promise<void>;
  /** `forSearch`: paused while the song to play is searched, as the app log's crossfade lines say. */
  pause(forSearch: boolean): Promise<void>;
  /** `source` is where the seek came from, for the app log's crossfade lines. */
  seekTo(positionMs: number, source: SeekSource): Promise<void>;
  getState(): Promise<NativePlayerState>;
  /** Request 500 ms position reports while a JS consumer needs them. Events always report. */
  setPositionReporting(requested: boolean): Promise<void>;
  /**
   * Starts the sleep timer in the playback service, which enforces it even with
   * Wave in the background. `endsAt` (wall-clock ms) is for `deadline` only.
   */
  setSleepTimer(type: SleepTimer["type"], endsAt: number | null): Promise<void>;
  cancelSleepTimer(): Promise<void>;
  getSleepTimer(): Promise<SleepTimer | null>;
  /**
   * Starts sending `onAutoRequest`, including the requests that queued up while
   * the runtime was starting. Call it once a listener is in place.
   */
  attachAuto(): void;
  /** Answers request `id` with JSON (see `AutoRequest`); async, as the answer can be a long list. */
  respondAuto(id: number, json: string): Promise<void>;
  /** Answers request `id` with an error Auto shows as `message`. */
  failAuto(id: number, message: string): void;
  /** The Lyrics toggle and Auto's connection; `onAutoLyrics` reports changes. */
  getAutoLyrics(): Promise<AutoLyricsEvent>;
  /**
   * Shows `text` as the title and artist of item `itemId` (its queue entry
   * key) on Auto's player screen; null shows its own. The service ignores it
   * while the toggle is off or Auto isn't connected.
   */
  setAutoLyricsText(itemId: string | null, text: AutoLyricsText | null): Promise<void>;
}

export const WavePlayer = requireNativeModule<WavePlayerModule>("WavePlayer");
