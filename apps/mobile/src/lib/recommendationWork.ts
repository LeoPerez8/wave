/** Recommendation reads run together until a frame is due, independent of touch quietness. */
import * as Effect from "effect/Effect";
import { AppState } from "react-native";
import { WaveAppLog } from "../native/waveAppLog";
import { createRecommendationTurn } from "./recommendationTurn.ts";
import { checkRecommendationDeadlines } from "./recommendationTimeout.ts";

AppState.addEventListener("change", (state) => {
  if (state === "active") checkRecommendationDeadlines();
});

/** Shared by all recommendation jobs; a cheap page or four-ms slice need not wait. */
export const recommendationTurnEffect = createRecommendationTurn({
  now: () => performance.now(),
  intervalMs: () => {
    try {
      return WaveAppLog?.timingFrameIntervalMs?.() ?? 0;
    } catch {
      return 0;
    }
  },
  request: (run) => {
    let frame: number | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const background = () => {
      if (frame !== undefined) cancelAnimationFrame(frame);
      frame = undefined;
      // Android may stop frames in the background; keep work cancellable there too.
      timer ??= setTimeout(run, 0);
    };
    const subscription = AppState.addEventListener("change", (state) => {
      if (state !== "active") background();
    });
    if (AppState.currentState === "active") frame = requestAnimationFrame(run);
    else background();
    return () => {
      subscription.remove();
      if (frame !== undefined) cancelAnimationFrame(frame);
      if (timer !== undefined) clearTimeout(timer);
    };
  },
});

/** Promise boundary for playlist replacement work. */
export const recommendationTurn = (): Promise<void> => Effect.runPromise(recommendationTurnEffect);
