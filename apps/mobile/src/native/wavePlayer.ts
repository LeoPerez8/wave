import { NativeModule, requireNativeModule } from "expo";

/** One track handed to the native player (`modules/wave-native`, `WavePlayerModule`). */
export interface PlayerItem {
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
  /** Played through, repeated, skipped or seeked to, or the item list changed. */
  readonly reason: "auto" | "repeat" | "seek" | "playlist";
}

export interface PlayerErrorEvent {
  readonly itemId: string | null;
  readonly message: string;
}

type WavePlayerEvents = {
  onPlaybackState: (state: NativePlayerState) => void;
  onPosition: (position: PlayerPosition) => void;
  onItemTransition: (event: ItemTransitionEvent) => void;
  onPlayerError: (event: PlayerErrorEvent) => void;
};

declare class WavePlayerModule extends NativeModule<WavePlayerEvents> {
  /** Replaces the item list and starts at an index and position. */
  setItems(
    items: readonly PlayerItem[],
    startIndex: number,
    startPositionMs: number,
    play: boolean,
  ): Promise<void>;
  play(): Promise<void>;
  pause(): Promise<void>;
  seekTo(positionMs: number): Promise<void>;
  getState(): Promise<NativePlayerState>;
}

export const WavePlayer = requireNativeModule<WavePlayerModule>("WavePlayer");
