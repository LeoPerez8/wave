/** Shared bounded CPU adapter (#593/#594), in background work's slices of at most 8 ms (#1350). */
import { runStepSlice, type SliceLimits, type SliceResult } from "@wave/core";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

/** One slice of stepped work, and what comes before it. */
export interface StepPace {
  readonly between: Effect.Effect<void>;
  readonly sliceMs: number;
  /** A work cap also bounds deterministic tests and exceptionally cheap operations. */
  readonly maxSteps: number;
}

/**
 * Six ms of work, stopped before a step would overrun it, and two ms of
 * headroom for what no step foresees (a GC pause): within the scheduler's
 * 8 ms slice. 512 operations at most.
 */
export const GENTLE_STEPS = { sliceMs: 6, maxSteps: 512 };

/**
 * The background work a fiber runs, for its slices' perf stats and for the
 * app log's line on a JS block over 50 ms. Inherited by the fibers it starts.
 */
export const BackgroundWorkName = Context.Reference<string>(
  "@wave/mobile/lib/stepped/BackgroundWorkName",
  { defaultValue: () => "unnamed background work" },
);

/** Names the background work [effect] does (`BackgroundWorkName`). */
export const namedWork =
  (name: string) =>
  <A, E, R>(effect: Effect.Effect<A, E, R>): Effect.Effect<A, E, R> =>
    effect.pipe(Effect.provideService(BackgroundWorkName, name));

type SliceRunner = <A>(
  name: string,
  steps: Iterator<void, A>,
  limits: Required<SliceLimits>,
) => SliceResult<A>;

/** The app's one scheduler, once `backgroundWork.ts` has loaded; tests slice on their own clock. */
let shared: SliceRunner | null = null;
export const shareSlicesWith = (runner: SliceRunner): (() => void) => {
  shared = runner;
  return () => {
    if (shared === runner) shared = null;
  };
};

/** Runs [steps] in slices, each paced as [pace] says when it comes up. */
export const pacedSteps = <A>(
  steps: Generator<void, A>,
  pace: () => StepPace,
  now: () => number = () => performance.now(),
): Effect.Effect<A> =>
  Effect.gen(function* () {
    const name = yield* BackgroundWorkName;
    for (;;) {
      const { between, sliceMs, maxSteps } = pace();
      // A new CPU stage must not append its budget to the preceding stage's last task.
      yield* between;
      const slice =
        shared === null
          ? runStepSlice(steps, { now, sliceMs, maxSteps })
          : shared(name, steps, { sliceMs, maxSteps });
      if (slice.done) return slice.value;
    }
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        steps.return(undefined as A);
      }),
    ),
  );

export const runSteps = <A>(
  steps: Generator<void, A>,
  between: Effect.Effect<void>,
  now?: () => number,
): Effect.Effect<A> => pacedSteps(steps, () => ({ ...GENTLE_STEPS, between }), now);

/**
 * One gentle slice of [steps] for the background work [name], for work driven outside an
 * Effect (the sync's database steps, `SyncCycleInput.slice`); its caller waits a free turn
 * before each.
 */
export const sliceOf =
  (name: string) =>
  <A>(steps: Iterator<void, A>): SliceResult<A> =>
    shared === null
      ? runStepSlice(steps, { now: () => performance.now(), ...GENTLE_STEPS })
      : shared(name, steps, GENTLE_STEPS);
