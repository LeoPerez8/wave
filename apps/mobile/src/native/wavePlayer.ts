import type { SleepTimer } from "@wave/core";
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

type WavePlayerEvents = {
  onPlaybackState: (state: NativePlayerState) => void;
  onPosition: (position: PlayerPosition) => void;
  onItemTransition: (event: ItemTransitionEvent) => void;
  onPlayerError: (event: PlayerErrorEvent) => void;
  onSleepTimer: (event: SleepTimerEvent) => void;
};

declare class WavePlayerModule extends NativeModule<WavePlayerEvents> {
  /** Edits the item list per the plan; `items` holds only the keys new to the player. */
  applySync(steps: readonly NativeSyncStep[], items: readonly PlayerItem[]): Promise<void>;
  setRepeatMode(mode: "off" | "all" | "one"): Promise<void>;
  getItemIds(): Promise<NativeItemIds>;
  /** Keeps the queue (JSON) in the native process, for when JS restarts. */
  saveQueue(json: string): void;
  savedQueue(): string | null;
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
}

export const WavePlayer = requireNativeModule<WavePlayerModule>("WavePlayer");
