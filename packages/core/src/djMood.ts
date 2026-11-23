/** DJ's moods, which filter songs by cached ReccoBeats features without waiting on the network. */
import { finishSteps } from "./buildSteps.ts";
import { genreStyle } from "./genreMixes.ts";
import type { DjMood } from "./djSettings.ts";

/** The four ReccoBeats fields used by DJ. */
export interface DjAudioFeatures {
  readonly energy: number;
  readonly valence: number;
  readonly acousticness: number;
  /** 0 is minor, 1 is major. */
  readonly mode: 0 | 1;
}

const median = (values: readonly number[]): number => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[(sorted.length - 1) >> 1]!;
};

/** ReccoBeats' per-ISRC feature median; even row counts use the lower middle value. */
export const djMedianAudioFeatures = (rows: readonly DjAudioFeatures[]): DjAudioFeatures | null =>
  rows.length === 0
    ? null
    : {
        energy: median(rows.map(({ energy }) => energy)),
        valence: median(rows.map(({ valence }) => valence)),
        acousticness: median(rows.map(({ acousticness }) => acousticness)),
        mode: median(rows.map(({ mode }) => mode)) as 0 | 1,
      };

/** A stream candidate shape accepted by the mood filter. */
export interface DjMoodRankable {
  readonly score: number;
  readonly song: { readonly videoId: string } | null;
  readonly genre?: string | null;
  /** A Library song's Track id, which [djMoodFiltered]'s Library features are kept against. */
  readonly trackId?: string;
  readonly source?: "stream" | "library";
}

/**
 * Energetic's floor: a song with at least this energy (ReccoBeats, 0 to 1)
 * is intense enough. Pop's middle sits near 0.6, so this asks for the
 * louder half of it.
 */
export const DJ_MOOD_HIGH_ENERGY = 0.65;
/** Relaxing's ceiling: a song with at most this energy (ReccoBeats, 0 to 1) is calm. */
export const DJ_MOOD_LOW_ENERGY = 0.45;
/**
 * A song with at most this valence (ReccoBeats, 0 to 1) is sad. Energetic
 * and Relaxing both need a valence above it.
 */
export const DJ_MOOD_SAD_VALENCE = 0.35;

/**
 * What a mood knows of a song: it fits the mood (`matched`), it has
 * another mood (`off`), or nothing cached says (`unknown`).
 */
export type DjMoodFit = "matched" | "off" | "unknown";

/** Upbeat's formula from before moods filtered (#1484): a happy song with medium or high energy. */
const upbeatScore = ({ energy, valence }: DjAudioFeatures): number => {
  const mediumOrHighEnergy = Math.max(0, Math.min(1, (energy - 0.3) / 0.5));
  return 0.6 * (valence - 0.5) + 0.4 * (mediumOrHighEnergy - 0.5);
};

/**
 * [mood]'s verdict on a song, from its cached [features] or else its known
 * [genre]'s style (docs/spec.md, DJ):
 *
 * - Energetic: energy at least `DJ_MOOD_HIGH_ENERGY`, valence above `DJ_MOOD_SAD_VALENCE`.
 * - Relaxing: energy at most `DJ_MOOD_LOW_ENERGY`, valence above `DJ_MOOD_SAD_VALENCE`.
 * - Upbeat: happy with medium or high energy (its old score above neutral).
 *
 * A style tells intensity, not sadness, so with no features it can only
 * rule a song off: Heavy for Relaxing, Soft / acoustic for Energetic.
 */
export const djMoodFit = (
  mood: DjMood,
  features: DjAudioFeatures | null,
  genre: string | null,
): DjMoodFit => {
  if (features !== null) {
    const fits =
      mood === "energetic"
        ? features.energy >= DJ_MOOD_HIGH_ENERGY && features.valence > DJ_MOOD_SAD_VALENCE
        : mood === "relaxing"
          ? features.energy <= DJ_MOOD_LOW_ENERGY && features.valence > DJ_MOOD_SAD_VALENCE
          : upbeatScore(features) > 0;
    return fits ? "matched" : "off";
  }
  if (genre === null) return "unknown";
  const style = genreStyle(genre)?.name.toLowerCase();
  if (style === "heavy" && mood === "relaxing") return "off";
  if (style === "soft / acoustic" && mood === "energetic") return "off";
  return "unknown";
};

/** A ranking split by a mood: the songs it matches and those it can't tell, each in ranked order. */
export interface DjMoodPools<S> {
  readonly matched: readonly S[];
  readonly unknown: readonly S[];
}

/**
 * [songs] as [mood] filters them (`djMoodFit`): off songs leave, whoever
 * sings them, and the matched and unknown ones keep their ranked order, so
 * taste orders the songs inside the mood. A batch takes the matched ones
 * and fills from the unknown ones only when they fall short. A stream song
 * goes by its cached [features], else its Library match's, else its
 * genre; a Library song with no stream match by its ISRC tag's
 * [libraryFeatures] only. With no mood, every song is matched.
 */
export const djMoodFiltered = <S extends DjMoodRankable>(
  songs: readonly S[],
  mood: DjMood | null,
  features: ReadonlyMap<string, DjAudioFeatures>,
  genres: ReadonlyMap<string, string | null>,
  /** Features found by Library files' ISRC tags, by Track id. */
  libraryFeatures: ReadonlyMap<string, DjAudioFeatures> = new Map(),
): DjMoodPools<S> =>
  finishSteps(djMoodFilteredSteps(songs, mood, features, genres, libraryFeatures));

/** `djMoodFiltered`, a step per song, for a background slice (#1448). */
export function* djMoodFilteredSteps<S extends DjMoodRankable>(
  songs: readonly S[],
  mood: DjMood | null,
  features: ReadonlyMap<string, DjAudioFeatures>,
  genres: ReadonlyMap<string, string | null>,
  libraryFeatures: ReadonlyMap<string, DjAudioFeatures> = new Map(),
): Generator<void, DjMoodPools<S>> {
  if (mood === null) return { matched: [...songs], unknown: [] };
  const matched: S[] = [];
  const unknown: S[] = [];
  for (const candidate of songs) {
    yield;
    const videoId = candidate.song?.videoId;
    const library =
      candidate.source === "library" && candidate.trackId !== undefined
        ? (libraryFeatures.get(candidate.trackId) ?? null)
        : null;
    const fit =
      videoId === undefined
        ? djMoodFit(mood, library, null)
        : djMoodFit(
            mood,
            features.get(videoId) ?? library,
            genres.get(videoId) ?? candidate.genre ?? null,
          );
    if (fit === "matched") matched.push(candidate);
    else if (fit === "unknown") unknown.push(candidate);
  }
  return { matched, unknown };
}
