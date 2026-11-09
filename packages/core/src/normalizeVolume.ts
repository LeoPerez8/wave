/**
 * Normalize Volume (Settings › Playback): the gain each song plays at, so
 * every song comes in at about -14 LUFS, Spotify's and YouTube's level
 * (docs/spec.md, "Normalize Volume"). The player applies it in a gain stage of
 * its own, so the crossfade keeps the player's volume.
 *
 * The playback service mirrors `songGain` (Kotlin `NormalizeVolume.gain`)
 * for streamed songs, whose YouTube value only it learns, and for the typical
 * gain; a Library song's `knownGain` reaches it with the queue. Its
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

/** How many Library songs need a value before the typical gain is their median. */
export const TYPICAL_GAIN_MIN_SONGS = 20;

/**
 * Where a song's gain came from, as the app log names it: its file's
 * ReplayGain or R128 tags, YouTube's value for a streamed song, the typical
 * gain for a song with none, or the switch off.
 */
export type GainSource = "tag" | "youtube" | "typical" | "off";

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
  /** A Library song's gain at -14 LUFS from its file's track tags (`gainTags`); null without one. */
  readonly trackGainDb?: number | null;
  /** The song's sample peak from its tags, on a 0–1 full-scale range; null when unknown. */
  readonly trackPeak?: number | null;
}

/**
 * The loudness tags of a file as the scanner read them, raw:
 * `REPLAYGAIN_TRACK_GAIN`/`_PEAK` and `REPLAYGAIN_ALBUM_GAIN`/`_PEAK` (MP3,
 * FLAC, Ogg, M4A), and an Opus file's `R128_TRACK_GAIN`/`R128_ALBUM_GAIN`.
 */
export interface GainTagText {
  readonly replayGainTrackGain?: string | null;
  readonly replayGainTrackPeak?: string | null;
  readonly replayGainAlbumGain?: string | null;
  readonly replayGainAlbumPeak?: string | null;
  readonly r128TrackGain?: string | null;
  readonly r128AlbumGain?: string | null;
}

/**
 * What a file's loudness tags say, as the Library keeps it: gains at -14
 * LUFS, peaks on a 0–1 full-scale range; null where the file says nothing.
 */
export interface TagGains {
  readonly trackGainDb: number | null;
  readonly trackPeak: number | null;
  readonly albumGainDb: number | null;
  readonly albumPeak: number | null;
}

/** ReplayGain's reference is -18 LUFS (ReplayGain 1's 89 dB counts the same): 4 dB under -14. */
const REPLAYGAIN_TO_TARGET_DB = 4;

/** R128 gains are relative to -23 LUFS: 9 dB under -14. */
const R128_TO_TARGET_DB = 9;

const DECIMAL = /^[+-]?(?:\d+(?:\.\d*)?|\.\d+)$/;

/** A decimal as taggers write it: a comma or a point, with or without "dB". */
const parseDecimal = (text: string | null | undefined, unit: boolean): number | null => {
  if (text == null) return null;
  let value = text.trim().replace(",", ".");
  if (unit) value = value.replace(/\s*db$/i, "");
  if (!DECIMAL.test(value)) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

/** A ReplayGain gain tag ("-6.54 dB") as the gain at -14 LUFS. */
const replayGain = (text: string | null | undefined): number | null => {
  const gain = parseDecimal(text, true);
  return gain === null ? null : gain + REPLAYGAIN_TO_TARGET_DB;
};

/** A ReplayGain peak tag ("0.988553"); a peak of zero or less says nothing. */
const replayGainPeak = (text: string | null | undefined): number | null => {
  const peak = parseDecimal(text, false);
  return peak === null || peak <= 0 ? null : peak;
};

/**
 * An R128 gain tag (Q7.8, a whole number in 256ths of a dB) as the gain at
 * -14 LUFS. It's on top of the Opus header's output gain, which Android's
 * decoder already applies to the samples, so nothing else is added.
 */
const r128Gain = (text: string | null | undefined): number | null => {
  const value = text?.trim() ?? "";
  if (!/^[+-]?\d+$/.test(value)) return null;
  const q78 = Number(value);
  if (q78 < -32768 || q78 > 32767) return null;
  return q78 / 256 + R128_TO_TARGET_DB;
};

/**
 * What a file's loudness tags say (`GainTagText`). An Opus file's R128 tags
 * win over ReplayGain ones and give no peak; a gain without a peak is a known
 * gain with an unknown peak.
 */
export const gainTags = (tags: GainTagText): TagGains => {
  const r128Track = r128Gain(tags.r128TrackGain);
  const r128Album = r128Gain(tags.r128AlbumGain);
  return {
    trackGainDb: r128Track ?? replayGain(tags.replayGainTrackGain),
    trackPeak: r128Track === null ? replayGainPeak(tags.replayGainTrackPeak) : null,
    albumGainDb: r128Album ?? replayGain(tags.replayGainAlbumGain),
    albumPeak: r128Album === null ? replayGainPeak(tags.replayGainAlbumPeak) : null,
  };
};

/**
 * [gainDb] capped by [peak]: never more than the peak allows
 * (`-20·log10(peak)`), and never above 0 dB without a known peak.
 */
const capped = (gainDb: number, peak: number | null | undefined): number => {
  const headroom = peak != null && Number.isFinite(peak) && peak > 0 ? -20 * Math.log10(peak) : 0;
  return Math.min(gainDb, headroom);
};

/**
 * The gain [song] plays at from what's known of it, or null when nothing is
 * (it plays at the typical gain). A tagged song plays at its tag's gain,
 * boosted only as far as its peak allows, and only turned down without a
 * peak. A streamed song louder than YouTube's reference is turned down by
 * YouTube's value and never turned up, as YouTube gives no peak.
 */
export const knownGain = (song: SongLoudness): SongGain | null => {
  const tag = song.trackGainDb;
  if (tag != null && Number.isFinite(tag)) {
    return { gainDb: capped(tag, song.trackPeak), source: "tag" };
  }
  const youtube = song.youtubeLoudnessDb;
  if (youtube != null && Number.isFinite(youtube)) {
    return { gainDb: youtube > 0 ? -youtube : 0, source: "youtube" };
  }
  return null;
};

/**
 * The gain a song with no value plays at: the median of the Library songs'
 * gains ([gains], each `knownGain`'s), or -5 dB while fewer than 20 songs
 * have one. Never above 0 dB, as such a song has no known peak.
 */
export const typicalGain = (gains: readonly number[]): number => {
  const known = gains.filter(Number.isFinite).sort((a, b) => a - b);
  if (known.length < TYPICAL_GAIN_MIN_SONGS) return TYPICAL_GAIN_START_DB;
  const middle = known.length >> 1;
  const median =
    known.length % 2 === 1 ? known[middle]! : (known[middle - 1]! + known[middle]!) / 2;
  return Math.min(median, 0);
};

/**
 * The gain [song] plays at, and its source. With the switch off every song
 * plays as it is; otherwise at its `knownGain`, or at the Library's typical
 * gain ([typicalGainDb], `typicalGain`) when nothing is known of it.
 */
export const songGain = (
  on: boolean,
  song: SongLoudness,
  typicalGainDb: number = TYPICAL_GAIN_START_DB,
): SongGain => {
  if (!on) return { gainDb: 0, source: "off" };
  return knownGain(song) ?? { gainDb: typicalGainDb, source: "typical" };
};
