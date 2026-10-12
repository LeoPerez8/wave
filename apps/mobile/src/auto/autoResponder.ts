import { WavePlayer, type AutoRequestEvent } from "@/native/wavePlayer";

/** Answers one Auto request with a JSON-serialisable value (see `AutoNode`). */
export type AutoAnswer = (request: AutoRequestEvent) => Promise<unknown>;

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message !== "" ? error.message : "Wave couldn't load this.";

let started = false;

/**
 * Answers the media library service's Auto requests with [answer], then tells
 * native to send them (including those that queued up during a cold start).
 * Every request gets an answer: a failure becomes `failAuto`, so Auto shows a
 * message instead of waiting for the timeout. Only the first call subscribes.
 */
export const startAutoResponder = (answer: AutoAnswer): void => {
  if (started) return;
  started = true;
  WavePlayer.addListener("onAutoRequest", (request) => {
    answer(request).then(
      (value) => WavePlayer.respondAuto(request.id, JSON.stringify(value)),
      (error: unknown) => WavePlayer.failAuto(request.id, errorMessage(error)),
    );
  });
  WavePlayer.attachAuto();
};
