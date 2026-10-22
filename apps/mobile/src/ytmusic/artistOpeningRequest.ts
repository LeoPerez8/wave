import * as Effect from "effect/Effect";

/** Check Android at execution, after the section's settlement gate, before any network effect. */
export const artistOpeningRequest = <A, E, R>(
  online: () => boolean,
  request: Effect.Effect<A, E, R>,
): Effect.Effect<A, E | { readonly reason: "offline" }, R> =>
  Effect.suspend((): Effect.Effect<A, E | { readonly reason: "offline" }, R> =>
    online() ? request : Effect.fail({ reason: "offline" }),
  );
