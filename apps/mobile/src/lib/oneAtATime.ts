import * as Effect from "effect/Effect";

/**
 * [effect], run one at a time: asked for while a run is going, it does
 * nothing (the run going on is taken to cover it); asked for once that run
 * ended, however it ended, it runs again. Only the run that started clears
 * the way, so runs turned away never let another through.
 */
export const oneAtATime = <E, R>(effect: Effect.Effect<void, E, R>): Effect.Effect<void, E, R> => {
  let running = false;
  return Effect.suspend(() => {
    if (running) return Effect.void;
    running = true;
    return effect.pipe(
      Effect.ensuring(
        Effect.sync(() => {
          running = false;
        }),
      ),
    );
  });
};
