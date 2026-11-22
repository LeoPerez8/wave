import * as Effect from "effect/Effect";
import { BackgroundWorkName } from "./stepped.ts";

/**
 * Tests' runners for stepped work: the app names every run (`namedWork`, #1447), so a
 * test runs its work under one name too.
 */
const named = <A, E>(effect: Effect.Effect<A, E, BackgroundWorkName>): Effect.Effect<A, E> =>
  effect.pipe(Effect.provideService(BackgroundWorkName, "test"));

/** `Effect.runSync` for stepped work. */
export const runTestSync = <A, E>(effect: Effect.Effect<A, E, BackgroundWorkName>): A =>
  Effect.runSync(named(effect));

/** `Effect.runPromise` for stepped work. */
export const runTestPromise = <A, E>(
  effect: Effect.Effect<A, E, BackgroundWorkName>,
  options?: Parameters<typeof Effect.runPromise>[1],
): Promise<A> => Effect.runPromise(named(effect), options);
