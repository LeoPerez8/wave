import type { MixRowId } from "@wave/core";
import * as Effect from "effect/Effect";

/** One input read per attempt; row failures don't discard the other row's mixes. */
export const buildHomeMixes = <I, A, E, R, EI, RI>(
  rows: readonly MixRowId[],
  inputs: Effect.Effect<I, EI, RI>,
  build: (id: MixRowId, input: I) => Effect.Effect<A, E, R>,
  start: Effect.Effect<void> = Effect.void,
) =>
  Effect.gen(function* () {
    yield* start;
    const input = yield* inputs;
    return yield* Effect.forEach(
      rows,
      (id) => Effect.map(Effect.result(build(id, input)), (result) => ({ id, result })),
      { concurrency: "unbounded" },
    );
  });
