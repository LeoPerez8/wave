/** Two indexed table walks, preserving historical song/radio order without N+1 reads. */
import type { CatalogRadio } from "@wave/core";
import * as Effect from "effect/Effect";
import type { GraphPage } from "../library/db/artistGraph.ts";
import { runSteps } from "../lib/stepped.ts";
export const readCatalogInputs = <A, E>(
  songsPage: (after: number) => Effect.Effect<GraphPage<A, number>, E>,
  radiosPage: (
    after: number,
  ) => Effect.Effect<GraphPage<CatalogRadio & { readonly videoId: string }, number>, E>,
  between: Effect.Effect<void>,
  videoId: (entry: A) => string,
) =>
  Effect.gen(function* () {
    const songs: A[] = [];
    let after = 0;
    for (;;) {
      yield* between;
      const page = yield* songsPage(after);
      for (const entry of page.rows) songs.push(entry);
      if (page.next === null) break;
      after = page.next;
    }
    const radios = new Map<string, CatalogRadio[]>();
    after = 0;
    for (;;) {
      yield* between;
      const page = yield* radiosPage(after);
      yield* runSteps(
        (function* () {
          for (const row of page.rows) {
            const of = radios.get(row.videoId) ?? [];
            of.push({ seed: row.seed, seedName: row.seedName, lastSeenAt: row.lastSeenAt });
            radios.set(row.videoId, of);
            yield;
          }
        })(),
        between,
      );
      if (page.next === null) break;
      after = page.next;
    }
    return yield* runSteps(
      (function* () {
        const result: (A & { readonly radios: readonly CatalogRadio[] })[] = [];
        for (const entry of songs) {
          result.push({ ...entry, radios: radios.get(videoId(entry)) ?? [] });
          yield;
        }
        return result;
      })(),
      between,
    );
  });
