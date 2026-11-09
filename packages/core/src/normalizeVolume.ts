/**
 * Normalize Volume (Settings › Playback): the gain each song plays at, so
 * every song comes in at about -14 LUFS, Spotify's and YouTube's level
 * (docs/spec.md, "Normalize Volume"). The player applies it in a gain stage of
 * its own, so the crossfade keeps the player's volume.
 *
 * The playback service mirrors `songGain` for streamed songs, whose YouTube
 * value only it learns (Kotlin `NormalizeVolume.gain`); its
 * `NormalizeVolumeTest` runs these cases. Change both together.
 */

/** The switch is on unless the owner turned it off. */
export const readNormalizeVolume = (stored: string | null): boolean => stored !== "off";

/** What to store for the switch; null (nothing) is on, the default. */
export const writeNormalizeVolume = (on: boolean): string | null => (on ? null : "off");

/**
 * The gain, in dB, a song Wave knows nothing about plays at while fewer songs
 * have a value than the typical gain needs: it keeps a modern master near the
 * leveled songs around it.
 */
export const TYPICAL_GAIN_START_DB = -5;

/**
 * Where a song's gain came from, as the app log names it: YouTube's value for
 * a streamed song, the typical gain for a song with none, or the switch off.
 */
export type GainSource = "youtube" | "typical" | "off";

export interface SongGain {
  /** dB the song's samples are scaled by; 0 plays it as it is. */
  readonly gainDb: number;
  readonly source: GainSource;
}

/** What Wave knows of a song's loudness. */
export interface SongLoudness {
  /**
   * YouTube's `loudnessDb` for a streamed YT Music song: dB above YouTube's
   * -14 LUFS reference (its answer's `loudnessTargetLkfs`). Null when YouTube
   * didn't give one.
   */
  readonly youtubeLoudnessDb?: number | null;
}

/**
 * The gain [song] plays at, and its source. With the switch off every song
 * plays as it is. A streamed song louder than YouTube's reference is turned
 * down by YouTube's value and never turned up, as YouTube gives no peak to cap
 * a boost by. A song with no value plays at the typical gain.
 */
export const songGain = (on: boolean, song: SongLoudness): SongGain => {
  if (!on) return { gainDb: 0, source: "off" };
  const youtube = song.youtubeLoudnessDb;
  if (youtube != null && Number.isFinite(youtube)) {
    return { gainDb: youtube > 0 ? -youtube : 0, source: "youtube" };
  }
  return { gainDb: TYPICAL_GAIN_START_DB, source: "typical" };
};
