import type { ShuffleKind } from "@wave/core";

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
  /** The kind of shuffle every shuffle uses (story 25a): Real, Smart or Even Shuffle. */
  readonly shuffleKind: ShuffleKind;
}
