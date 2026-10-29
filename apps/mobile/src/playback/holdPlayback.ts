import * as Effect from "effect/Effect";

import { appRuntime } from "@/library/runtime";

import { Player, playbackState } from "./Player";

/** Runs a player command; a failure shows as playback's error, as playback actions' do. */
const command = (effect: Effect.Effect<void, unknown, Player>): Promise<void> =>
  appRuntime.runPromise(effect).catch((error: unknown) =>
    playbackState.update((state) => ({
      ...state,
      error: error instanceof Error ? error.message : String(error),
    })),
  );

/**
 * Pauses Wave's playback if it's playing (or about to); the release plays it again,
 * and does nothing when nothing was playing. Recognize holds it while the
 * microphone listens, so the microphone doesn't hear Wave.
 */
export const holdPlayback = async (): Promise<() => void> => {
  if (!playbackState.get().playWhenReady) return () => undefined;
  await command(
    Effect.gen(function* () {
      yield* (yield* Player).pause;
    }),
  );
  return () =>
    void command(
      Effect.gen(function* () {
        yield* (yield* Player).play;
      }),
    );
};
