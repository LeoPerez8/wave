import {
  parseTrackId,
  tasteLearned,
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

/** How a live taste profile reads what it's derived from and the songs its signals are. */
export interface LiveTasteDeps<R> {
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
const notIn = (held: readonly TasteSignal[], history: TasteHistory | null): TasteSignal[] => {
  if (history === null) return [...held];
  const plays = new Set(history.plays.map((play) => `${play.trackId}@${play.startedAt}`));
  const favorites = new Set(history.favorites.map((star) => star.trackId));
  const downloads = new Set(history.downloads.map((download) => download.trackId));
  return held.filter(({ kind, song, at }) =>
    parseTrackId(song.trackId)?.kind === "yt"
      ? true
      : kind === "favorite"
        ? !favorites.has(song.trackId)
        : kind === "download"
          ? !downloads.has(song.trackId)
          : !plays.has(`${song.trackId}@${at}`),
  );
};

/**
 * The taste profile as the app keeps it (docs/spec.md, Taste profile):
 * derived from the history once, the first time it's asked for, then kept up
 * to date as signals come, as if each were in the history. Kept free of Expo
 * so it runs under plain Node tests; the app's is `TasteProfile.ts`.
 */
export const makeLiveTaste = <R>({ derive, deriveWithSnapshot, songsOf }: LiveTasteDeps<R>) => {
  let known: TasteProfile | null = null;
  /**
   * While a derivation runs, the signals that came since it started: not in
   * the history it read (that read starts it), so learned once it's done.
   */
  let held: TasteSignal[] | null = null;
  /** Only one derivation at a time: a second ask waits for the first's profile. */
  const deriving = Semaphore.makeUnsafe(1);

  /** Teaches the profile [kind] about each of [trackIds], at [at]. */
  const learn = (kind: TasteSignalKind, trackIds: readonly string[], at: number) =>
    Effect.gen(function* () {
      // Before the first ask, the history the profile will be derived from has it.
      if (trackIds.length === 0 || (known === null && held === null)) return;
      const songs = yield* songsOf(trackIds);
      const signals = songs.map((song) => ({ kind, song, at }));
      if (known !== null) known = learned(known, signals);
      else held?.push(...signals);
    }).pipe(Effect.ignore);

  /** Bumped when the profile is forgotten: a derivation started before it isn't kept. */
  let generation = 0;

  const derived = (read = deriveWithSnapshot ?? (() => derive)) =>
    Effect.suspend(() => {
      held = [];
      let snapshot: TasteHistory | null = null;
      const started = generation;
      return read((history) => {
        snapshot = history;
      }).pipe(
        Effect.map((profile) => {
          const kept = learned(profile, notIn(held ?? [], snapshot));
          if (started === generation) known = kept;
          return kept;
        }),
        Effect.ensuring(
          Effect.sync(() => {
            held = null;
          }),
        ),
      );
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
    unstarred: (): void => {
      generation += 1;
      known = null;
    },
  };
};
