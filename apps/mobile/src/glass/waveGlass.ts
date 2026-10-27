import { NativeModule, requireNativeModule, requireNativeView } from "expo";
import type { ComponentType } from "react";
import type { ColorValue, ViewProps } from "react-native";

/**
 * Native bindings from `modules/wave-glass`: the glass view, the cover under Now
 * Playing and the frame-time meter.
 */

export interface FrameStats {
  /** Frames rendered per second over the last 500 ms window. */
  readonly fps: number;
  readonly frames: number;
  readonly avgFrameMs: number;
  readonly p95FrameMs: number;
  readonly maxFrameMs: number;
  /** Frames that finished after their deadline (dropped or late). */
  readonly missedDeadlines: number;
  readonly refreshRate: number;
}

type WaveGlassEvents = { onFrameStats: (stats: FrameStats) => void };

declare class WaveGlassModule extends NativeModule<WaveGlassEvents> {
  startFrameStats(): void;
  stopFrameStats(): void;
  /** The launch intent's glass probe (Core `GLASS_PROBE_EXTRA`); null without one. Perf builds only. */
  perfGlassProbe(): string | null;
}

export const WaveGlass = requireNativeModule<WaveGlassModule>("WaveGlass");

export interface NativeGlassViewProps extends ViewProps {
  /** `nativeID` of the view whose content shows through the glass; null draws the tint and rim alone. */
  readonly backdropNativeId: string | null;
  /** Gaussian blur radius, in dp. */
  readonly blurRadius: number;
  /** Edge refraction displacement in dp; 0 turns the AGSL shader off (blur + tint + rim fallback). */
  readonly refraction: number;
  readonly cornerRadius: number;
  readonly tintColor: ColorValue;
  readonly rim: boolean;
  /**
   * Share one backdrop recording with the other glass views over the same
   * backdrop, re-recorded only when the backdrop changed (the glass probe's
   * `coalesced`, #316). Off by default: unmeasured on a phone yet.
   */
  readonly coalesce?: boolean;
}

export const NativeGlassView: ComponentType<NativeGlassViewProps> =
  requireNativeView<NativeGlassViewProps>("WaveGlass");

export interface NativeCoverProps extends ViewProps {
  /** `nativeID` of the screen under Now Playing. */
  readonly coveredNativeId: string;
  /** Now Playing settled open: the screen goes undrawn while the sheet lies over all of it. */
  readonly settled: boolean;
}

/**
 * Fills Now Playing and hides the screen under it from drawing, glass included,
 * while the sheet rests settled over it (#721, see WaveCoverView.kt). Draws nothing.
 */
export const NativeCover: ComponentType<NativeCoverProps> = requireNativeView<NativeCoverProps>(
  "WaveGlass",
  "WaveCover",
);

export interface NativeWaveUnderlineProps extends ViewProps {
  readonly color: ColorValue;
  /** Slides the wave along (on the RenderThread) while true; lies still otherwise. */
  readonly animating: boolean;
}

/** The playing song's wavy underline, animated on the RenderThread (see WaveUnderlineView.kt). */
export const NativeWaveUnderline: ComponentType<NativeWaveUnderlineProps> =
  requireNativeView<NativeWaveUnderlineProps>("WaveGlass", "WaveUnderline");
