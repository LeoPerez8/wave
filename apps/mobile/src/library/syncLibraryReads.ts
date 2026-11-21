import * as Context from "effect/Context";
import * as Effect from "effect/Effect";

/**
 * Library reads run off the JS thread and finish a turn later (#1348). An
 * effect that must finish in the task it started in (run with `runSyncExit`,
 * so that nothing else on this thread lands meanwhile) reads on the main
 * connection instead, on the JS thread, as every read once did.
 */
export const SyncLibraryReads = Context.Reference<boolean>(
  "@wave/mobile/library/SyncLibraryReads",
  { defaultValue: () => false },
);

/** [effect] with its Library reads on the JS thread, finished in its own task. */
export const withSyncLibraryReads = <A, E, R>(
  effect: Effect.Effect<A, E, R>,
): Effect.Effect<A, E, R> => Effect.provideService(effect, SyncLibraryReads, true);
