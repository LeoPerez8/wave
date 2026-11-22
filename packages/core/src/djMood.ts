/** DJ's sound filters, ranked from cached ReccoBeats features without waiting on the network. */
import { finishSteps, mapSteps, sortSteps } from "./buildSteps.ts";
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

/** A stream candidate shape accepted by the mood ranker. */
export interface DjMoodRankable {
  readonly score: number;
  readonly song: { readonly videoId: string } | null;
  readonly genre?: string | null;
  /** A Library song's Track id, which [djMoodRanked]'s Library features are kept against. */
  readonly trackId?: string;
  readonly source?: "stream" | "library";
}

/** Mood's score adjustment, centred on neutral and bounded to roughly +/- 2. */
export const djMoodScore = (
  mood: DjMood,
  features: DjAudioFeatures | null,
  genre: string | null,
): number => {
  if (features !== null) {
    if (mood === "energetic") return 4 * (features.energy - 0.5);
    if (mood === "relaxing")
      return 4 * (0.65 * (0.5 - features.energy) + 0.35 * (features.acousticness - 0.5));
    const mediumOrHighEnergy = Math.max(0, Math.min(1, (features.energy - 0.3) / 0.5));
    return 4 * (0.6 * (features.valence - 0.5) + 0.4 * (mediumOrHighEnergy - 0.5));
  }
  if (genre === null) return 0;
  const style = genreStyle(genre)?.name.toLowerCase();
  if (style === "heavy") return mood === "energetic" ? 1.5 : mood === "relaxing" ? -1.5 : 0;
  if (style === "soft / acoustic")
    return mood === "relaxing" ? 1.5 : mood === "energetic" ? -1.5 : 0;
  return 0;
};

/** Applies the mood adjustment to cached stream features and known genre fallback only. */
export const djMoodRanked = <S extends DjMoodRankable>(
  songs: readonly S[],
  mood: DjMood | null,
  features: ReadonlyMap<string, DjAudioFeatures>,
  genres: ReadonlyMap<string, string | null>,
  /** Features found by Library files' ISRC tags, by Track id. */
  libraryFeatures: ReadonlyMap<string, DjAudioFeatures> = new Map(),
): S[] => finishSteps(djMoodRankedSteps(songs, mood, features, genres, libraryFeatures));

/** `djMoodRanked`, a step per song, for a background slice (#1448). */
export function* djMoodRankedSteps<S extends DjMoodRankable>(
  songs: readonly S[],
  mood: DjMood | null,
  features: ReadonlyMap<string, DjAudioFeatures>,
  genres: ReadonlyMap<string, string | null>,
  libraryFeatures: ReadonlyMap<string, DjAudioFeatures> = new Map(),
): Generator<void, S[]> {
  if (mood === null) return [...songs];
  const ranked = yield* mapSteps(songs, (candidate): S => {
    const videoId = candidate.song?.videoId;
    const library =
      candidate.source === "library" && candidate.trackId !== undefined
        ? (libraryFeatures.get(candidate.trackId) ?? null)
        : null;
    // A Library song with no stream match uses only its ISRC tag's features: else neutral.
    if (videoId === undefined)
      return library === null
        ? candidate
        : { ...candidate, score: candidate.score + djMoodScore(mood, library, null) };
    const genre = genres.get(videoId) ?? candidate.genre ?? null;
    const adjustment = djMoodScore(mood, features.get(videoId) ?? library, genre);
    return adjustment === 0 ? candidate : { ...candidate, score: candidate.score + adjustment };
  });
  return yield* sortSteps(ranked, (a, b) => b.score - a.score);
}
