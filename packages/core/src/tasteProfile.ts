/**
 * The taste profile (docs/spec.md, Taste profile): what the owner likes,
 * beyond one Magic Queue session, derived from what Wave keeps already (the
 * play history, favorites and downloads), so it needs no state of its own
 * and syncs with the history. Each signal loses half its weight every 30
 * days. It scores songs, artists and genre families.
 */

import { indexSteps } from "./buildSteps.ts";
import type { MagicSong } from "./magicQueue.ts";
import type { PlayEvent } from "./playEvents.ts";

/** A play skipped before this much of it played is a skip; later, it's neutral. */
export const MAGIC_SKIP_MS = 30_000;

/** What the owner did to a song that tells their taste, strongest last. */
export type TasteSignalKind = "skip" | "playedThrough" | "download" | "favorite";

/** What each signal adds to its song's score, when it just happened. */
const POINTS: { readonly [K in TasteSignalKind]: number } = {
  skip: -1,
  playedThrough: 1,
  download: 2,
  favorite: 3,
};

/** How long a signal takes to lose half its weight: 30 days. */
export const TASTE_HALF_LIFE_MS = 30 * 24 * 60 * 60 * 1000;

/**
 * What [signal] weighs at [now]: its points, halved for every 30 days since
 * it happened (one from later than [now] weighs as if it just happened).
 */
const weightAt = (
  signal: { readonly kind: TasteSignalKind; readonly at: number },
  now: number,
): number => POINTS[signal.kind] * 0.5 ** (Math.max(0, now - signal.at) / TASTE_HALF_LIFE_MS);

/** What the taste profile is derived from, by queue track id. */
export interface TasteHistory {
  /** Every play on record. */
  readonly plays: readonly Pick<PlayEvent, "trackId" | "startedAt" | "listenedMs" | "endReason">[];
  /** Every starred song, with when its star last changed. */
  readonly favorites: readonly { readonly trackId: string; readonly changedAt: number }[];
  /** Every downloaded song, with its file's date. */
  readonly downloads: readonly { readonly trackId: string; readonly downloadedAt: number }[];
}

/**
 * What a play tells the taste profile: played to the end is positive,
 * skipped within its first 30 s negative; anything else says nothing (null).
 */
export const tastePlaySignal = (
  play: Pick<PlayEvent, "endReason" | "listenedMs">,
): "skip" | "playedThrough" | null => {
  if (play.endReason === "completed") return "playedThrough";
  return play.endReason === "skipped" && play.listenedMs < MAGIC_SKIP_MS ? "skip" : null;
};

/** What the owner likes: a score for each song, artist and genre family, positive liked. */
export interface TasteProfile {
  /** When the scores stand (epoch ms): each signal weighs as it does at this time. */
  readonly at: number;
  /** By queue track id. */
  readonly songs: ReadonlyMap<string, number>;
  /** By `MagicArtistKey`. */
  readonly artists: ReadonlyMap<string, number>;
  /** By genre family key, lower case. */
  readonly genres: ReadonlyMap<string, number>;
}

/** A signal on record: what the owner did to the song [trackId], at [at] (epoch ms). */
interface HistorySignal {
  readonly kind: TasteSignalKind;
  readonly trackId: string;
  readonly at: number;
}

const add = (scores: Map<string, number>, key: string, points: number): void => {
  scores.set(key, (scores.get(key) ?? 0) + points);
};

/**
 * A genre family's key as the profile and a Magic Queue session score it:
 * without case or surrounding spaces; null for none.
 */
export const genreKey = (genre: string | null): string | null => {
  const key = genre?.trim().toLowerCase() ?? "";
  return key === "" ? null : key;
};

/** The scores being added up. */
interface Scores {
  readonly songs: Map<string, number>;
  readonly artists: Map<string, number>;
  readonly genres: Map<string, number>;
}

/** Adds [points] to [song]'s score, each of its artists' and its genre family's. */
const score = (scores: Scores, song: MagicSong, points: number): void => {
  add(scores.songs, song.trackId, points);
  for (const artist of new Set(song.artists)) add(scores.artists, artist, points);
  const genre = genreKey(song.genre);
  if (genre !== null) add(scores.genres, genre, points);
};

/**
 * The taste profile [history] makes at [now]: a favorite weighs most, then a
 * download, then a song played to the end; a song skipped within its first
 * 30 s weighs against it. Each signal loses half its weight every 30 days
 * from when it happened: the play's start, the star's change, the file's date.
 * An artist's score, and a genre family's, add up their songs' signals;
 * [songOf] tells each song's ([trackId]'s), and a song it doesn't know (gone
 * from the Library) scores nothing.
 */
export const tasteProfile = (
  history: TasteHistory,
  songOf: (trackId: string) => MagicSong | undefined,
  now: number,
): TasteProfile => {
  const signals: HistorySignal[] = [];
  for (const play of history.plays) {
    const kind = tastePlaySignal(play);
    if (kind !== null) signals.push({ kind, trackId: play.trackId, at: play.startedAt });
  }
  for (const { trackId, changedAt } of history.favorites)
    signals.push({ kind: "favorite", trackId, at: changedAt });
  for (const { trackId, downloadedAt } of history.downloads)
    signals.push({ kind: "download", trackId, at: downloadedAt });
  const scores: Scores = { songs: new Map(), artists: new Map(), genres: new Map() };
  for (const signal of signals) {
    const song = songOf(signal.trackId);
    if (song !== undefined) score(scores, song, weightAt(signal, now));
  }
  return { at: now, ...scores };
};

/** Resumable derivation, one history item per step, in ti's exact signal order. */
export function* tasteProfileSteps(
  history: TasteHistory,
  songOf: (trackId: string) => MagicSong | undefined,
  now: number,
): Generator<void, TasteProfile> {
  const scores: Scores = { songs: new Map(), artists: new Map(), genres: new Map() };
  const apply = (signal: HistorySignal): void => {
    const song = songOf(signal.trackId);
    if (song !== undefined) score(scores, song, weightAt(signal, now));
  };
  for (const play of history.plays) {
    const kind = tastePlaySignal(play);
    if (kind !== null) apply({ kind, trackId: play.trackId, at: play.startedAt });
    yield;
  }
  for (const { trackId, changedAt } of history.favorites) {
    apply({ kind: "favorite", trackId, at: changedAt });
    yield;
  }
  for (const { trackId, downloadedAt } of history.downloads) {
    apply({ kind: "download", trackId, at: downloadedAt });
    yield;
  }
  return { at: now, ...scores };
}

/** A signal as it comes: what the owner did ([kind]) to [song], at [at] (epoch ms). */
export interface TasteSignal {
  readonly kind: TasteSignalKind;
  readonly song: MagicSong;
  readonly at: number;
}

/**
 * [profile] having learned [signal] as it came, as if it were in the
 * history: the app derives the profile once, then keeps it up to date.
 */
export const tasteLearned = (
  profile: TasteProfile,
  { kind, song, at }: TasteSignal,
): TasteProfile => {
  const scores: Scores = {
    songs: new Map(profile.songs),
    artists: new Map(profile.artists),
    genres: new Map(profile.genres),
  };
  score(scores, song, weightAt({ kind, at }, profile.at));
  return { at: profile.at, ...scores };
};

/** Same additions as tasteLearned, with yielding copies of the existing maps.
 * Undefined signals still expose a step, so filtering held signals is bounded too.
 */
export function* tasteLearnedSteps(
  profile: TasteProfile,
  signals: Iterable<TasteSignal | undefined>,
): Generator<void, TasteProfile> {
  const scores: Scores = {
    songs: yield* indexSteps(profile.songs, (entry) => entry),
    artists: yield* indexSteps(profile.artists, (entry) => entry),
    genres: yield* indexSteps(profile.genres, (entry) => entry),
  };
  for (const signal of signals) {
    if (signal !== undefined) score(scores, signal.song, weightAt(signal, profile.at));
    yield;
  }
  return { at: profile.at, ...scores };
}

/**
 * How far each score moves a song's weight, and how big a score it takes:
 * the weight is multiplied by 2^(range × tanh(score / scale)), so a song's
 * own score moves it between a quarter and 4 times (a favorite starred today
 * nearly triples it), and its artists' and its genre family's, which add up
 * many songs, between half and twice each. A score of 0 leaves it as it is.
 */
const SONG = { range: 2, scale: 3 } as const;
const ARTIST = { range: 1, scale: 10 } as const;
const GENRE = { range: 1, scale: 30 } as const;

const factor = (
  points: number,
  { range, scale }: { readonly range: number; readonly scale: number },
): number => 2 ** (range * Math.tanh(points / scale));

/**
 * What [profile] multiplies [song]'s weight by in a pick: more for a song
 * the owner likes, one by artists they like and one of a genre family they
 * like, less for those they skip; 1 for a song the profile knows nothing
 * about.
 */
export const tasteWeight = (profile: TasteProfile, song: MagicSong): number => {
  let artists = 0;
  for (const artist of new Set(song.artists)) artists += profile.artists.get(artist) ?? 0;
  const genre = genreKey(song.genre);
  return (
    factor(profile.songs.get(song.trackId) ?? 0, SONG) *
    factor(artists, ARTIST) *
    factor(genre === null ? 0 : (profile.genres.get(genre) ?? 0), GENRE)
  );
};
