import {
  parseTrackId,
  tasteLearned,
  tasteLearnedSteps,
  tastePlaySignal,
  type MagicSong,
  type PlayEvent,
  type TasteHistory,
  type TasteProfile,
  type TasteSignal,
  type TasteSignalKind,
} from "@wave/core";
import * as Effect from "effect/Effect";
import * as Semaphore from "effect/Semaphore";
import { runSteps } from "../lib/stepped.ts";

/** How a live taste profile reads what it's derived from and the songs its signals are. */
export interface LiveTasteDeps<R> {
  readonly between?: Effect.Effect<void>;
  /** Derives the profile from the history, favorites and downloads (Core's `tasteProfile`). */
  readonly derive: Effect.Effect<TasteProfile, unknown, R>;
  /**
   * Derives as [derive] does, from a history read later than its start (after
   * free turns): tells [snapshotTaken] the history it read, so signals that
   * came meanwhile and are in it count once.
   */
  readonly deriveWithSnapshot?: (
    snapshotTaken: (history: TasteHistory) => void,
  ) => Effect.Effect<TasteProfile, unknown, R>;
  /** The songs [trackIds] are, as the profile weighs them; those it can't tell left out. */
  readonly songsOf: (
    trackIds: readonly string[],
  ) => Effect.Effect<readonly MagicSong[], unknown, R>;
}

/** [profile] having learned each of [signals] (`tasteLearned`). */
const learned = (profile: TasteProfile, signals: readonly TasteSignal[]): TasteProfile =>
  signals.reduce(tasteLearned, profile);

/**
 * The signals of [held] that [history] doesn't have yet. A play is on record
 * by its song and start; a star once its write landed (it's announced before);
 * a streamed song's signals are never on record.
 */
function* historyMembership(
  history: TasteHistory | null,
): Generator<void, (signal: TasteSignal) => boolean> {
  if (history === null) return () => false;
  const plays = new Set<string>(),
    favorites = new Set<string>(),
    downloads = new Set<string>();
  for (const play of history.plays) {
    plays.add(`${play.trackId}@${play.startedAt}`);
    yield;
  }
  for (const star of history.favorites) {
    favorites.add(star.trackId);
    yield;
  }
  for (const download of history.downloads) {
    downloads.add(download.trackId);
    yield;
  }
  return ({ kind, song, at }) =>
    parseTrackId(song.trackId)?.kind !== "yt" &&
    (kind === "favorite"
      ? favorites.has(song.trackId)
      : kind === "download"
        ? downloads.has(song.trackId)
        : plays.has(`${song.trackId}@${at}`));
}

/**
 * The taste profile as the app keeps it (docs/spec.md, Taste profile):
 * derived from the history once, the first time it's asked for, then kept up
 * to date as signals come, as if each were in the history. Kept free of Expo
 * so it runs under plain Node tests; the app's is `TasteProfile.ts`.
 */
export const makeLiveTaste = <R>({
  derive,
  deriveWithSnapshot,
  songsOf,
  between = Effect.void,
}: LiveTasteDeps<R>) => {
  let known: TasteProfile | null = null;
  /**
   * While a derivation runs, the signals that came since it started: not in
   * the history it read (that read starts it), so learned once it's done.
   */
  let held: TasteSignal[] | null = null;
  // Streamed signals have no SQLite source; replay them after invalidation too.
  let streamed: TasteSignal[] = [];
  /** Only one derivation at a time: a second ask waits for the first's profile. */
  const deriving = Semaphore.makeUnsafe(1);

  /** Teaches the profile [kind] about each of [trackIds], at [at]. */
  const learn = (kind: TasteSignalKind, trackIds: readonly string[], at: number) =>
    Effect.gen(function* () {
      // Before the first ask, the history the profile will be derived from has it.
      if (
        trackIds.length === 0 ||
        (known === null && held === null && trackIds.every((id) => parseTrackId(id)?.kind !== "yt"))
      )
        return;
      const songs = yield* songsOf(trackIds);
      const signals = songs.map((song) => ({ kind, song, at }));
      for (const signal of signals) {
        if (parseTrackId(signal.song.trackId)?.kind === "yt") streamed.push(signal);
        else held?.push(signal);
      }
      if (known !== null) known = learned(known, signals);
    }).pipe(Effect.ignore);

  /** Bumped when the profile is forgotten: a derivation started before it isn't kept. */
  let generation = 0;

  const derived = (read = deriveWithSnapshot ?? (() => derive)) =>
    Effect.gen(function* () {
      // Keep signals on failure/interruption: streamed signals cannot be recovered
      // from SQLite on the next ask. Only a successful publication consumes them.
      held ??= [];
      for (;;) {
        let snapshot: TasteHistory | null = null;
        const started = generation;
        const profile = yield* read((history) => {
          snapshot = history;
        });
        if (started !== generation) continue;
        let kept = profile;
        if (held.length > 0 || streamed.length > 0) {
          const includes = yield* runSteps(historyMembership(snapshot), between);
          const pending = held;
          kept = yield* runSteps(
            tasteLearnedSteps(
              profile,
              (function* () {
                // Drain both live arrays, including signals arriving while map copies yield.
                let libraryAt = 0,
                  streamedAt = 0;
                while (libraryAt < pending.length || streamedAt < streamed.length) {
                  const signal =
                    libraryAt < pending.length ? pending[libraryAt++]! : streamed[streamedAt++]!;
                  yield includes(signal) ? undefined : signal;
                }
              })(),
            ),
            between,
          );
        }
        if (started !== generation) continue;
        known = kept;
        held = null;
        return kept;
      }
    });

  const profileUsing = (read = deriveWithSnapshot ?? (() => derive)) =>
    Semaphore.withPermit(
      deriving,
      Effect.suspend(() => (known === null ? derived(read) : Effect.succeed(known))),
    ).pipe(Effect.orElseSucceed((): TasteProfile | null => null));

  return {
    /** Same cache and derivation lock, with a caller-supplied shared Library input. */
    profileUsing,
    /**
     * The profile, derived the first time it's asked for, then as signals
     * have kept it; null when the history can't be read.
     */
    profile: profileUsing(),

    /**
     * A play ended: one played to the end, or skipped within its first 30 s
     * (`tastePlaySignal`), moves the profile. A streamed YT Music song's
     * says nothing: it's never in the history, so it would count only until
     * the next launch.
     */
    played: (play: Pick<PlayEvent, "trackId" | "startedAt" | "listenedMs" | "endReason">) => {
      const kind = tastePlaySignal(play);
      return kind === null || parseTrackId(play.trackId)?.kind === "yt"
        ? Effect.void
        : learn(kind, [play.trackId], play.startedAt);
    },

    /** The owner starred or downloaded [trackIds] (a YT Music song's too) at [at]. */
    marked: (kind: "favorite" | "download", trackIds: readonly string[], at: number) =>
      learn(kind, trackIds, at),

    /**
     * The owner unstarred songs: the profile is forgotten, so the next ask
     * derives it again without their favorites (when a star was given isn't
     * known here, so what it added can't be taken back alone). A derivation
     * going on isn't kept.
     */
    unstarred: (trackIds?: readonly string[]): void => {
      generation += 1;
      known = null;
      streamed = streamed.filter(
        (signal) =>
          signal.kind !== "favorite" ||
          (trackIds !== undefined && !trackIds.includes(signal.song.trackId)),
      );
      if (held !== null)
        held = held.filter(
          (signal) =>
            signal.kind !== "favorite" ||
            (trackIds !== undefined && !trackIds.includes(signal.song.trackId)),
        );
    },
    /** Metadata changed: an in-flight snapshot must not become the shared answer. */
    invalidate: (): void => {
      generation += 1;
      known = null;
    },
  };
};
