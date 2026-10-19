import {
  parseTrackId,
  tasteLearned,
  tastePlaySignal,
  type MagicSong,
  type PlayEvent,
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
  /** The songs [trackIds] are, as the profile weighs them; those it can't tell left out. */
  readonly songsOf: (
    trackIds: readonly string[],
  ) => Effect.Effect<readonly MagicSong[], unknown, R>;
}

/** [profile] having learned each of [signals] (`tasteLearned`). */
const learned = (profile: TasteProfile, signals: readonly TasteSignal[]): TasteProfile =>
  signals.reduce(tasteLearned, profile);

/**
 * The taste profile as the app keeps it (docs/spec.md, Taste profile):
 * derived from the history once, the first time it's asked for, then kept up
 * to date as signals come, as if each were in the history. Kept free of Expo
 * so it runs under plain Node tests; the app's is `TasteProfile.ts`.
 */
export const makeLiveTaste = <R>({ derive, songsOf }: LiveTasteDeps<R>) => {
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

  const derived = Effect.suspend(() => {
    held = [];
    const started = generation;
    return derive.pipe(
      Effect.map((profile) => {
        const kept = learned(profile, held ?? []);
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

  return {
    /**
     * The profile, derived the first time it's asked for, then as signals
     * have kept it; null when the history can't be read.
     */
    profile: Semaphore.withPermit(
      deriving,
      Effect.suspend(() => (known === null ? derived : Effect.succeed(known))),
    ).pipe(Effect.orElseSucceed((): TasteProfile | null => null)),

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
