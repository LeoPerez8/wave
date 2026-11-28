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

/** A kept feature row, by the id its candidates name it with; a miss has no energy. */
export interface DjMoodFeatureRow {
  readonly id: string;
  readonly energy: number | null;
  readonly valence: number | null;
  readonly acousticness: number | null;
  readonly mode: number | null;
}

/**
 * Kept feature rows as the mood filter reads them, by id: a row reads only with its four
 * fields and a mode of 0 or 1, and a later row for an id replaces an earlier one that read
 * (a stream's features replace an ISRC tag's). A step per row, so a read of thousands gives
 * way between them (#1532).
 */
export function* djMoodFeaturesSteps(
  rows: Iterable<DjMoodFeatureRow>,
): Generator<void, ReadonlyMap<string, DjAudioFeatures>> {
  const found = new Map<string, DjAudioFeatures>();
  for (const { id, energy, valence, acousticness, mode } of rows) {
    if (energy != null && valence != null && acousticness != null && (mode === 0 || mode === 1))
      found.set(id, { energy, valence, acousticness, mode });
    yield;
  }
  return found;
}

/** A stream candidate shape accepted by the mood filter. */
export interface DjMoodRankable {
  readonly score: number;
  readonly song: { readonly videoId: string } | null;
  readonly genre?: string | null;
  /** A Library song's Track id, which [djMoodFiltered]'s Library features are kept against. */
  readonly trackId?: string;
  /** A Library song's style key (`songStyle`), read when its stream genre gives none. */
  readonly style?: string | null;
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

/** The style keys (`GenreStyle.key`) a mood rules off with no features. */
const OFF_STYLE: { readonly [K in DjMood]: string | null } = {
  energetic: "softacoustic",
  relaxing: "heavy",
  upbeat: null,
};

/**
 * [mood]'s verdict on a song, from its cached [features] or else its known
 * [genre]'s style, or else its own [style] key (`songStyle`) (docs/spec.md, DJ):
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
  style: string | null = null,
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
  const known = (genre === null ? null : genreStyle(genre)?.key) ?? style;
  return known !== null && known === OFF_STYLE[mood] ? "off" : "unknown";
};

/** The moods a filter is asked for: none (null or an empty list), one, or several in the order picked. */
export type DjMoods = readonly DjMood[] | DjMood | null;

const moodList = (moods: DjMoods): readonly DjMood[] =>
  moods === null ? [] : typeof moods === "string" ? [moods] : moods;

/**
 * What several [moods] know of a song together: the ones it fits, and
 * `djMoodFit`'s verdict for all of them. It's matched when it fits any,
 * off when every one rules it off, and unknown otherwise.
 */
export const djMoodsFit = (
  moods: DjMoods,
  features: DjAudioFeatures | null,
  genre: string | null,
  style: string | null = null,
): { readonly fits: readonly DjMood[]; readonly fit: DjMoodFit } => {
  const verdicts = moodList(moods).map(
    (mood) => [mood, djMoodFit(mood, features, genre, style)] as const,
  );
  const fits = verdicts.flatMap(([mood, fit]) => (fit === "matched" ? [mood] : []));
  return {
    fits,
    fit:
      fits.length > 0 ? "matched" : verdicts.every(([, fit]) => fit === "off") ? "off" : "unknown",
  };
};

/**
 * Which songs may start a session of [moods]: the ones known to fit the
 * first mood picked are matched; a song every mood rules off is off; any
 * other, a known fit of a later mood included, is unknown. With no mood,
 * every song is matched; with one, this is that mood's `djMoodFit`.
 */
export const djFirstMoodFit = (
  moods: DjMoods,
  features: DjAudioFeatures | null,
  genre: string | null,
  style: string | null = null,
): DjMoodFit => {
  const [first] = moodList(moods);
  if (first === undefined) return "matched";
  if (djMoodFit(first, features, genre, style) === "matched") return "matched";
  return djMoodsFit(moods, features, genre, style).fit === "off" ? "off" : "unknown";
};

/** One [group]'s songs taking turns among [moods] (`djMoodTurnsSteps`). */
function* takeTurns<S>(
  group: readonly S[],
  moods: readonly DjMood[],
  fitsOf: (song: S) => readonly DjMood[] | undefined,
): Generator<void, S[]> {
  const queues: S[][] = moods.map(() => []);
  for (const song of group) {
    const fits = fitsOf(song) ?? [];
    for (const [at, mood] of moods.entries()) if (fits.includes(mood)) queues[at]!.push(song);
    yield;
  }
  const next = moods.map(() => 0);
  const taken = new Set<S>();
  const turned: S[] = [];
  let turns = moods.map((_, at) => at);
  while (turns.length > 0) {
    const kept: number[] = [];
    for (const at of turns) {
      const queue = queues[at]!;
      while (next[at]! < queue.length && taken.has(queue[next[at]!]!)) {
        next[at]!++;
        yield;
      }
      // A mood with no song left drops out of the turn.
      if (next[at]! >= queue.length) continue;
      const song = queue[next[at]!++]!;
      taken.add(song);
      turned.push(song);
      kept.push(at);
      yield;
    }
    turns = kept;
  }
  return turned;
}

/**
 * [songs] with the ones that fit [moods] (`fitsOf`) taking turns among
 * them, in the order the moods were picked: a song of the first mood, then
 * one of the second, and so on, each the next in [songs]' order that its
 * mood hasn't had yet. A mood with no song left drops out of the turn, and
 * a song that fits two of them plays once, in whichever turn takes it
 * first. Songs take turns within their [groupOf] group only, each group
 * keeping the places it held, so a batch that takes a share of each
 * (streams and Library songs, `radioRankingBatch`) gets every mood in each.
 * A song that fits none keeps its place. With fewer than two moods,
 * [songs] stay as they are.
 */
export function* djMoodTurnsSteps<S>(
  songs: readonly S[],
  moods: readonly DjMood[],
  fitsOf: (song: S) => readonly DjMood[] | undefined,
  groupOf: (song: S) => unknown,
): Generator<void, S[]> {
  if (moods.length < 2) return [...songs];
  const groups = new Map<unknown, S[]>();
  /** Each place's group, or `KEPT` for a song that keeps its place. */
  const places: unknown[] = [];
  for (const song of songs) {
    yield;
    if ((fitsOf(song)?.length ?? 0) === 0) {
      places.push(KEPT);
      continue;
    }
    const key = groupOf(song);
    places.push(key);
    const group = groups.get(key);
    if (group === undefined) groups.set(key, [song]);
    else group.push(song);
  }
  const turned = new Map<unknown, { readonly songs: S[]; at: number }>();
  for (const [key, group] of groups)
    turned.set(key, { songs: yield* takeTurns(group, moods, fitsOf), at: 0 });
  const result: S[] = [];
  for (const [at, key] of places.entries()) {
    yield;
    if (key === KEPT) result.push(songs[at]!);
    else {
      const group = turned.get(key)!;
      result.push(group.songs[group.at++]!);
    }
  }
  return result;
}

const KEPT = Symbol("kept");

/**
 * A ranking split by its moods: the songs they match, taking turns among
 * the moods (`djMoodTurnsSteps`), and those they can't tell, in ranked order.
 */
export interface DjMoodPools<S> {
  readonly matched: readonly S[];
  readonly unknown: readonly S[];
  /** The moods each matched song fits, which `djVarietyMoodPools` keeps the turns by. */
  readonly fits: ReadonlyMap<S, readonly DjMood[]>;
}

/**
 * [songs] as [mood] filters them (`djMoodsFit`): songs every chosen mood
 * rules off leave, whoever sings them, and the unknown ones keep their
 * ranked order. The matched ones keep it too with one mood, so taste orders
 * the songs inside the mood; with several, they take turns among the moods
 * in the order they were picked, streams and Library songs each apart
 * (`djMoodTurnsSteps`), and each mood's songs keep their taste order. A
 * batch takes the matched ones and fills from the unknown ones only when
 * they fall short. A stream song goes by its cached [features], else its
 * Library match's, else its genre; a Library song with no stream match by
 * its [libraryFeatures] (its own video's stream features, else its ISRC
 * tag's). Either falls back on its own style when it has one. With no mood,
 * every song is matched.
 */
export const djMoodFiltered = <S extends DjMoodRankable>(
  songs: readonly S[],
  mood: DjMoods,
  features: ReadonlyMap<string, DjAudioFeatures>,
  genres: ReadonlyMap<string, string | null>,
  /** Features found by Library files' ISRC tags, by Track id. */
  libraryFeatures: ReadonlyMap<string, DjAudioFeatures> = new Map(),
): DjMoodPools<S> =>
  finishSteps(djMoodFilteredSteps(songs, mood, features, genres, libraryFeatures));

/** `djMoodFiltered`, a step per song, for a background slice (#1448). */
export function* djMoodFilteredSteps<S extends DjMoodRankable>(
  songs: readonly S[],
  mood: DjMoods,
  features: ReadonlyMap<string, DjAudioFeatures>,
  genres: ReadonlyMap<string, string | null>,
  libraryFeatures: ReadonlyMap<string, DjAudioFeatures> = new Map(),
): Generator<void, DjMoodPools<S>> {
  const moods = moodList(mood);
  if (moods.length === 0) return { matched: [...songs], unknown: [], fits: new Map() };
  const matched: S[] = [];
  const unknown: S[] = [];
  const fits = new Map<S, readonly DjMood[]>();
  for (const candidate of songs) {
    yield;
    const videoId = candidate.song?.videoId;
    const library =
      candidate.source === "library" && candidate.trackId !== undefined
        ? (libraryFeatures.get(candidate.trackId) ?? null)
        : null;
    const style = candidate.style ?? null;
    const verdict =
      videoId === undefined
        ? djMoodsFit(moods, library, null, style)
        : djMoodsFit(
            moods,
            features.get(videoId) ?? library,
            genres.get(videoId) ?? candidate.genre ?? null,
            style,
          );
    if (verdict.fit === "matched") {
      matched.push(candidate);
      fits.set(candidate, verdict.fits);
    } else if (verdict.fit === "unknown") unknown.push(candidate);
  }
  const turned = yield* djMoodTurnsSteps(
    matched,
    moods,
    (song) => fits.get(song),
    (song) => song.source,
  );
  return { matched: turned, unknown, fits };
}
