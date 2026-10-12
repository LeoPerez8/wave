import { WavePlayer, type AutoRequest, type AutoRequestEvent } from "@/native/wavePlayer";

/** Answers one Auto request with a JSON-serialisable value (see `AutoRequest`). */
export type AutoAnswer = (request: AutoRequest) => Promise<unknown>;

const errorMessage = (error: unknown): string =>
  error instanceof Error && error.message !== "" ? error.message : "Wave couldn't load this.";

/** The request an event carries, with its payload read. */
const readRequest = (event: AutoRequestEvent): AutoRequest =>
  ({ ...(JSON.parse(event.payload) as object), type: event.type }) as AutoRequest;

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
  WavePlayer.addListener("onAutoRequest", (event) => {
    Promise.resolve()
      .then(() => answer(readRequest(event)))
      .then(
        (value) => WavePlayer.respondAuto(event.id, JSON.stringify(value)),
        (error: unknown) => WavePlayer.failAuto(event.id, errorMessage(error)),
      );
  });
  WavePlayer.attachAuto();
};
