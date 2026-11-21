import type { OutputDevice } from "./playback.ts";

/**
 * Settings › Playback as the window shows it: the account-wide synced Crossfade, Normalize
 * Volume and Buffer (docs/spec.md, stories 22a–22c).
 */
export interface PlaybackSettings {
  /** How long a song ending on its own overlaps the next, 0 to 15 in steps of 0.5; 0 is off. */
  readonly crossfadeSeconds: number;
  readonly normalizeVolume: boolean;
  /** Minutes of streamed audio kept loaded ahead: 1, 2, 5, 10, 15 or 30. */
  readonly bufferMinutes: 1 | 2 | 5 | 10 | 15 | 30;
}

/**
 * Settings › Playback › Output: where this computer plays. Kept on the desktop, never synced.
 */
export interface OutputSettings {
  /** The outputs the system has now. */
  readonly outputs: readonly OutputDevice[];
  /**
   * The output picked, or null for the system's default. While it isn't `connected` Wave plays
   * on the system's default, and goes back to it when it returns.
   */
  readonly chosen: (OutputDevice & { readonly connected: boolean }) | null;
}
