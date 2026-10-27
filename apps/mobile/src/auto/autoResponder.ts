import { AutoError } from "@/auto/Auto";
import { WavePlayer, type AutoRequest, type AutoRequestEvent } from "@/native/wavePlayer";

/**
 * Answers one Auto request with a JSON-serialisable value (see `AutoRequest`).
 * It fails with an `AutoError` to tell Auto what to show.
 */
export type AutoAnswer = (request: AutoRequest) => Promise<unknown>;

const COULD_NOT_LOAD = "Wave couldn't load this. Try again in a moment.";

/**
 * What Auto shows for a failed request: an `AutoError`'s message, written for
 * the car. Anything else (a store or player failure, a defect, a request that
 * can't be read) is logged and shown as a generic message, never its own text.
 */
const failureMessage = (type: string, error: unknown): string => {
  if (error instanceof AutoError) return error.message;
  console.warn(`[wave] Auto ${type} failed`, error);
  return COULD_NOT_LOAD;
};

/** The request an event carries, with its payload read. */
const readRequest = (event: AutoRequestEvent): AutoRequest =>
  ({ ...(JSON.parse(event.payload) as object), type: event.type }) as AutoRequest;

/**
 * Answers the media library service's Auto requests with [answer], then tells
 * native to send them (including those that queued up during a cold start).
 * Every request gets an answer: a failure becomes `failAuto`, so Auto shows a
 * message instead of waiting for the timeout. Call it once per JS runtime
 * (`startServices` does).
 */
export const startAutoResponder = (answer: AutoAnswer): void => {
  WavePlayer.addListener("onAutoRequest", (event) => {
    Promise.resolve()
      .then(() => answer(readRequest(event)))
      // The answer can list a whole shelf: it crosses to native off the JS thread.
      .then((value) => WavePlayer.respondAuto(event.id, JSON.stringify(value)))
      .catch((error: unknown) => WavePlayer.failAuto(event.id, failureMessage(event.type, error)));
  });
  WavePlayer.attachAuto();
};
