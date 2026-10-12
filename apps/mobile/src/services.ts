import * as Effect from "effect/Effect";

import { Auto, AutoError } from "@/auto/Auto";
import { startAutoResponder } from "@/auto/autoResponder";
import { appRuntime } from "@/library/runtime";
import type { AutoRequest } from "@/native/wavePlayer";
import { connectPlayer } from "@/playback/actions";

/** Who started the app services in this JS runtime. */
export interface ServicesStart {
  readonly by: "app" | "headless";
  /** Wall-clock time (ms) of the first call. */
  readonly at: number;
  /** How many times `startServices` was called; only the first one starts anything. */
  readonly calls: number;
}

let start: ServicesStart | null = null;

const COULD_NOT_LOAD = "Wave couldn't load this. Try again in a moment.";

/**
 * Answers one Auto request through the `Auto` service. Auto shows an
 * `AutoError`'s message; any other failure is logged and shown as a generic one.
 */
const answerAuto = (request: AutoRequest): Promise<unknown> =>
  appRuntime.runPromise(
    Effect.gen(function* () {
      const auto = yield* Auto;
      return yield* auto.answer(request);
    }).pipe(
      Effect.catch((error) =>
        error instanceof AutoError
          ? Effect.fail(error)
          : Effect.sync(() => console.warn(`[wave] Auto ${request.type} failed`, error)).pipe(
              Effect.andThen(Effect.fail(new AutoError({ message: COULD_NOT_LOAD }))),
            ),
      ),
    ),
  );

/**
 * Starts the app services that work without UI: the library store, the queue
 * and player sync, playback persistence and play history (one `appRuntime`),
 * and the Android Auto responder. The Activity's root layout and the headless
 * `WaveService` task (index.ts) both call it; whichever comes first starts
 * them, and later calls change nothing, so one JS runtime never initialises
 * them twice. The library scan stays with the UI.
 */
export const startServices = (by: ServicesStart["by"]): void => {
  if (start !== null) {
    start = { ...start, calls: start.calls + 1 };
    console.log(`[wave] services already started by the ${start.by}; the ${by} reuses them`);
    return;
  }
  start = { by, at: Date.now(), calls: 1 };
  console.log(`[wave] services started by the ${by}`);
  connectPlayer();
  startAutoResponder(answerAuto);
};
