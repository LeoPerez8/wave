import { faithfulGenreMixesSteps, type DiscoverMix, type RadioRankingPage } from "@wave/core";
import * as Effect from "effect/Effect";

import { runSteps, type Turn } from "../lib/stepped.ts";

type Plan = ReturnType<typeof faithfulGenreMixesSteps>;
// The plan owns eligibility and radio order. The app performs each requested read.
export const runGenreMixBuild = <E, R, RL>(
  plan: Plan,
  publish: (
    mixes: readonly DiscoverMix[],
    phase: "local" | "top-up",
  ) => Effect.Effect<void, never, RL>,
  read: (artist: {
    readonly name: string;
    readonly browseId?: string;
  }) => Effect.Effect<RadioRankingPage | undefined, E, R>,
  between: Turn,
) =>
  Effect.gen(function* () {
    let page: RadioRankingPage | undefined;
    for (;;) {
      const next = yield* runSteps(
        (function* () {
          let step = plan.next(page);
          while (!step.done && step.value === undefined) {
            yield;
            step = plan.next();
          }
          return step;
        })(),
        between,
      );
      if (next.done) return next.value;
      const step = next.value!;
      if (step.kind === "radio") page = yield* read(step.artist);
      else yield* publish(step.mixes, step.kind);
    }
  }).pipe(
    Effect.ensuring(
      Effect.sync(() => {
        plan.return([]);
      }),
    ),
  );
