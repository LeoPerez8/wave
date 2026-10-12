import { startAutoResponder } from "@/auto/autoResponder";
import { placeholderAnswer } from "@/auto/placeholder";
import { connectPlayer } from "@/playback/actions";

/** Who started the app services in this JS runtime, for the Auto spike's checks. */
export interface ServicesStart {
  readonly by: "app" | "headless";
  /** Wall-clock time (ms) of the first call. */
  readonly at: number;
  /** How many times `startServices` was called; only the first one starts anything. */
  readonly calls: number;
}

let start: ServicesStart | null = null;

export const servicesStart = (): ServicesStart | null => start;

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
  startAutoResponder(placeholderAnswer(servicesStart));
};
