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

import { currentEntry, upNext, type QueueEntry, type QueueState } from "./queue.ts";
import { libraryTrackIds } from "./ytQueue.ts";

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

/** The loudness every song aims at, in LUFS: a song's gain is this minus its loudness. */
const TARGET_LUFS = -14;

/** How many Up Next songs after the current one Wave measures right away. */
export const MEASURE_AHEAD = 5;

/**
 * Where a song's gain came from, as the app log names it: track gain from its
 * file's ReplayGain or R128 tags (`tag`) or from Wave's own measurement of a
 * file without them (`measured`); album gain from tags (`albumTag`), from
 * measurements (`albumMeasured`) or from songs with tags and songs Wave
 * measured (`albumTagAndMeasured`); YouTube's value for a streamed song; the
 * typical gain for a song with none; or the switch off. The player's log line
 * names both parts ("measured, album").
 */
export type GainSource =
  | "tag"
  | "measured"
  | "albumTag"
  | "albumMeasured"
  | "albumTagAndMeasured"
  | "youtube"
  | "typical"
  | "off";

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
  /**
   * Wave's measurement of a Library file without tags: its integrated
   * loudness (ITU-R BS.1770), in LUFS. Null without one, or when the file
   * couldn't be measured.
   */
  readonly measuredLoudness?: number | null;
  /** The measured file's sample peak, on a 0–1 full-scale range. */
  readonly measuredPeak?: number | null;
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
 * peak. A song without tags that Wave measured plays at -14 LUFS minus its
 * loudness, capped by its peak the same way. A streamed song louder than YouTube's reference is turned down by
 * YouTube's value and never turned up, as YouTube gives no peak.
 */
export const knownGain = (song: SongLoudness): SongGain | null => {
  const tag = song.trackGainDb;
  if (tag != null && Number.isFinite(tag)) {
    return { gainDb: capped(tag, song.trackPeak), source: "tag" };
  }
  const measured = song.measuredLoudness;
  if (measured != null && Number.isFinite(measured)) {
    return { gainDb: capped(TARGET_LUFS - measured, song.measuredPeak), source: "measured" };
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

/**
 * The Library songs Wave measures right away while Normalize Volume is on, in
 * the order it measures them: the current song; then, when album gain could
 * apply (the queue plays [album] with shuffle off), the album's songs; then the
 * rest of the next `MEASURE_AHEAD` Up Next songs to measure. [needsMeasuring]
 * says which Library songs are files without a value, which is the Library's
 * to know (the queue's runner counts the songs it measured too, so the five
 * move on with the queue, not as songs get measured); only those are given,
 * each once, so a streamed song or one with a value takes no place among the
 * five.
 */
export const songsToMeasure = (
  state: QueueState,
  needsMeasuring: (id: number) => boolean,
  album?: AlbumLoudness | null,
): number[] => {
  const current = currentEntry(state);
  if (current === null) return [];
  const first = libraryTrackIds([current.trackId]).filter(needsMeasuring);
  const ahead: number[] = [];
  for (const entry of upNext(state)) {
    if (ahead.length === MEASURE_AHEAD) break;
    const [id] = libraryTrackIds([entry.trackId]);
    if (id !== undefined && !first.includes(id) && !ahead.includes(id) && needsMeasuring(id)) {
      ahead.push(id);
    }
  }
  const albumIds = albumGainApplies(state, album)
    ? album.songs.map((song) => song.id).filter(needsMeasuring)
    : [];
  return [...new Set([...first, ...albumIds, ...ahead])];
};

/**
 * Every Library song `songsToMeasure` may give for [state] and [album], in
 * its order: the ones the Library is asked about (which need measuring).
 */
export const measureCandidates = (state: QueueState, album?: AlbumLoudness | null): number[] => {
  const current = currentEntry(state);
  if (current === null) return [];
  const albumIds = albumGainApplies(state, album) ? album.songs.map((song) => song.id) : [];
  return [
    ...new Set([
      ...libraryTrackIds([current.trackId]),
      ...albumIds,
      ...libraryTrackIds(upNext(state).map((entry) => entry.trackId)),
    ]),
  ];
};

/** One Library song of an album, including songs with no file or value yet. */
export interface AlbumSongLoudness extends SongLoudness {
  readonly id: number;
  readonly durationMs: number;
  /** Album tag gain already converted to the -14 LUFS target by `gainTags`. */
  readonly albumGainDb?: number | null;
  readonly albumPeak?: number | null;
  /** The song has no file: it's left out of the album's loudness and peak, and doesn't hold album gain back. */
  readonly missing?: boolean;
  /**
   * Wave couldn't measure the song's file (it has no tags): left out like a
   * missing song, and it plays at the album gain capped at 0 dB, as its peak
   * is unknown.
   */
  readonly unmeasurable?: boolean;
}

/** The complete Library membership of the queue's local album identity. */
export interface AlbumLoudness {
  readonly id: string;
  readonly songs: readonly AlbumSongLoudness[];
}

/**
 * One gain for a complete album: every song with a file Wave could measure
 * has a value (a missing or unmeasurable song neither counts nor holds it
 * back), else null. A tag shared by those songs wins; otherwise combine their
 * uncapped track loudness by duration (not the average of track gains).
 * Stored tag gains are already at -14, so loudness is -14 minus that gain.
 * The highest of their peaks caps it, and a missing peak on any of them rules
 * out a boost. Its source says what the gain was made of.
 */
export const albumGain = (songs: readonly AlbumSongLoudness[]): SongGain | null => {
  const counted = songs.filter((song) => song.missing !== true && song.unmeasurable !== true);
  if (counted.length === 0) return null;
  const tag = counted[0]!.albumGainDb;
  const sharedTag =
    tag != null && Number.isFinite(tag) && counted.every((song) => song.albumGainDb === tag);
  let gainDb: number;
  let source: GainSource;
  if (sharedTag) {
    gainDb = tag;
    source = "albumTag";
  } else {
    let energy = 0;
    let duration = 0;
    let tagged = 0;
    for (const song of counted) {
      const fromTag = song.trackGainDb != null && Number.isFinite(song.trackGainDb);
      const loudness = fromTag ? TARGET_LUFS - song.trackGainDb! : song.measuredLoudness;
      if (
        loudness == null ||
        !Number.isFinite(loudness) ||
        !Number.isFinite(song.durationMs) ||
        song.durationMs <= 0
      )
        return null;
      if (fromTag) tagged++;
      energy += song.durationMs * 10 ** (loudness / 10);
      duration += song.durationMs;
    }
    gainDb = TARGET_LUFS - 10 * Math.log10(energy / duration);
    source =
      tagged === counted.length
        ? "albumTag"
        : tagged === 0
          ? "albumMeasured"
          : "albumTagAndMeasured";
  }
  const peaks = counted.map((song) => {
    const track = song.trackGainDb != null ? song.trackPeak : song.measuredPeak;
    if (!sharedTag) return track;
    // An album peak describes the whole album, but a higher known track peak
    // must still prevent clipping if those tags disagree.
    const known = [song.albumPeak, track].filter(
      (peak): peak is number => peak != null && Number.isFinite(peak) && peak > 0,
    );
    return known.length === 0 ? null : Math.max(...known);
  });
  const peak = peaks.every((p) => p != null && Number.isFinite(p) && p > 0)
    ? Math.max(...(peaks as number[]))
    : null;
  return { gainDb: capped(gainDb, peak), source };
};

/** Whether album gain could apply to [state]: it plays [album] (the Library's), shuffle off. */
const albumGainApplies = (
  state: QueueState,
  album: AlbumLoudness | null | undefined,
): album is AlbumLoudness =>
  album != null &&
  !state.shuffle &&
  state.context?.kind === "album" &&
  state.context.id === album.id;

/**
 * A queue entry's known gain for its next start, or null for typical gain.
 * Album gain goes to the album's own songs in its queue, shuffle off; an
 * unmeasurable one plays at it capped at 0 dB. Hand-lined entries always use
 * track gain, even for a song of this album. The native gain stage freezes
 * this decision at the first sample of a song.
 */
export const entryGain = (
  state: QueueState,
  entry: Pick<QueueEntry, "trackId" | "contextIndex">,
  song: SongLoudness,
  album?: AlbumLoudness | null,
): SongGain | null => {
  if (entry.contextIndex !== null && albumGainApplies(state, album)) {
    const own = album.songs.find((albumSong) => String(albumSong.id) === entry.trackId);
    const gain = own === undefined || own.missing === true ? null : albumGain(album.songs);
    if (gain !== null) {
      return own?.unmeasurable === true ? { ...gain, gainDb: Math.min(gain.gainDb, 0) } : gain;
    }
  }
  return knownGain(song);
};
