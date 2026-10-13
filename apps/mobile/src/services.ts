import * as Effect from "effect/Effect";

import { Auto } from "@/auto/Auto";
import { startAutoLyrics } from "@/auto/autoLyrics";
import { startAutoResponder } from "@/auto/autoResponder";
import { appRuntime } from "@/library/runtime";
import type { AutoRequest } from "@/native/wavePlayer";
import { connectPlayer } from "@/playback/actions";
import { startDownloads } from "@/ytmusic/YtDownloads";

/** What starts the app services: the Activity's root layout or the headless `WaveService` task. */
export type ServicesStarter = "app" | "headless";

/** Who started the app services in this JS runtime, once they are. */
let startedBy: ServicesStarter | null = null;

/**
 * Answers one Auto request through the `Auto` service. What Auto shows when it
 * fails is the responder's call (`startAutoResponder`).
 */
const answerAuto = (request: AutoRequest): Promise<unknown> =>
  appRuntime.runPromise(
    Effect.gen(function* () {
      const auto = yield* Auto;
      return yield* auto.answer(request);
    }),
  );

/**
 * Starts the app services that work without UI: the library store, the queue
 * and player sync, playback persistence and play history (one `appRuntime`),
 * the Android Auto responder and Auto's lyric line. The Activity's root
 * layout and the headless `WaveService` task (index.ts) both call it;
 * whichever comes first starts them, and later calls change nothing, so one
 * JS runtime never initialises them twice. The library scan stays with the UI.
 */
export const startServices = (by: ServicesStarter): void => {
  startDownloads(by === "app");
  if (startedBy !== null) {
    console.log(`[wave] services already started by the ${startedBy}; the ${by} reuses them`);
    return;
  }
  startedBy = by;
  console.log(`[wave] services started by the ${by}`);
  connectPlayer();
  startAutoResponder(answerAuto);
  startAutoLyrics();
};
