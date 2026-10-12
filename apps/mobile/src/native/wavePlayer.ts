import type { PlaySource, SleepTimer } from "@wave/core";
import { NativeModule, requireNativeModule } from "expo";

/** One track handed to the native player (`modules/wave-native`, `WavePlayerModule`). */
export interface PlayerItem {
  /** The queue entry key (unique per entry, not the track id). */
  readonly id: string;
  readonly path: string;
  readonly title: string;
  readonly artist: string;
  readonly album: string | null;
  /** Full-size artwork file for the notification and lock screen. */
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
  readonly reason: "auto" | "repeat" | "seek" | "playlist" | "sync";
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
  /** The browse root: an `AutoItem`. */
  | { readonly type: "root" }
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
   */
  | { readonly type: "command"; readonly command: "toggleShuffle" | "cycleRepeat" };

/** The answer to a `play` request: the new player list and the item to start at. */
export interface AutoPlayback {
  readonly items: readonly PlayerItem[];
  readonly startIndex: number;
}

type WavePlayerEvents = {
  onPlaybackState: (state: NativePlayerState) => void;
  onPosition: (position: PlayerPosition) => void;
  onItemTransition: (event: ItemTransitionEvent) => void;
  onSeek: (event: SeekEvent) => void;
  onPlayerError: (event: PlayerErrorEvent) => void;
  onSleepTimer: (event: SleepTimerEvent) => void;
  onAutoRequest: (event: AutoRequestEvent) => void;
};

declare class WavePlayerModule extends NativeModule<WavePlayerEvents> {
  /** Edits the item list per the plan; `items` holds only the keys new to the player. */
  applySync(steps: readonly NativeSyncStep[], items: readonly PlayerItem[]): Promise<void>;
  setRepeatMode(mode: "off" | "all" | "one"): Promise<void>;
  /** The queue's shuffle and repeat, for the toggles on Auto's player screen. */
  setModes(shuffle: boolean, repeat: "off" | "all" | "one"): Promise<void>;
  getItemIds(): Promise<NativeItemIds>;
  /** Keeps the queue (JSON) in the native process, for when JS restarts. */
  /**
   * Keeps the queue (JSON) in the native process, for when JS restarts, and on
   * disk with where it was started from, for a cold start (playback resumption).
   */
  saveQueue(json: string, source: PlaySource): void;
  savedQueue(): string | null;
  /** Where the saved queue was started from; null before any was saved. */
  savedQueueSource(): PlaySource | null;
  /**
   * Whether the player resumed the saved queue on its own after Wave's process
   * died (its plays are new, not ones on record going on). Reading it clears it.
   */
  takeResumed(): boolean;
  play(): Promise<void>;
  pause(): Promise<void>;
  seekTo(positionMs: number): Promise<void>;
  getState(): Promise<NativePlayerState>;
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
  /** Answers request `id` with JSON (see `AutoRequest`). */
  respondAuto(id: number, json: string): void;
  /** Answers request `id` with an error Auto shows as `message`. */
  failAuto(id: number, message: string): void;
}

export const WavePlayer = requireNativeModule<WavePlayerModule>("WavePlayer");
