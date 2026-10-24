import type { MixRowId } from "@wave/core";
import * as Effect from "effect/Effect";
import { withRecommendationDeadline } from "../lib/recommendationTimeout.ts";

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
  }).pipe(withRecommendationDeadline);

/**
 * A recommendation snapshot with the owner's taste, which a cold profile
 * derives from the snapshot's own Library rather than reading the songs and
 * artists again (docs/spec.md, "Recommendation snapshot").
 */
export const withSnapshotTaste = <S extends { readonly library: L }, L, T, E, R, ET, RT>(
  snapshot: Effect.Effect<S, E, R>,
  taste: (library: L) => Effect.Effect<T, ET, RT>,
) =>
  Effect.gen(function* () {
    const read = yield* snapshot;
    return { ...read, taste: yield* taste(read.library) };
  });
