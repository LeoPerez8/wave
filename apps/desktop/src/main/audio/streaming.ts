/**
 * The audio process's side of YT Music songs (docs/spec-desktop.md, Audio engine). A `yt:` path
 * needs an address first: the process asks main, which asks the JVM, hands the address to the
 * engine, and loads the song once its first bytes are here. The bytes never leave the engine.
 *
 * Requests run one after another, so a call sent after a load acts on the song it loaded;
 * `status` answers at once.
 */
import {
  answer,
  failure,
  streamedVideoId,
  type AudioFailure,
  type AudioRequest,
  type AudioResponse,
  type ResolveAnswer,
  type ResolveEvent,
  type ResolvedStream,
  type StreamingEngine,
} from "./protocol.ts";

export interface StreamingOptions {
  /** How long a load waits for a song's first bytes. */
  readonly readyTimeoutMs?: number;
  /** How often the engine is asked how far a song is. */
  readonly pollMs?: number;
}

class StreamFailure extends Error {
  readonly failure: AudioFailure;
  constructor(failure: AudioFailure) {
    super(failure.message);
    this.failure = failure;
  }
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export interface Streaming {
  /** Runs `request`, fetching a YT Music song first when it names one. Never rejects. */
  readonly handle: (request: AudioRequest) => Promise<AudioResponse>;
  /** Main's answer to a `ResolveEvent`. */
  readonly resolved: (answer: ResolveAnswer) => void;
  /** Passes the engine's own requests for a fresh address on to main; call it often. */
  readonly pump: () => void;
}

export const streaming = (
  engine: StreamingEngine | undefined,
  post: (event: ResolveEvent) => void,
  unavailable: string | undefined,
  options: StreamingOptions = {},
): Streaming => {
  const readyTimeoutMs = options.readyTimeoutMs ?? 20_000;
  const pollMs = options.pollMs ?? 25;
  let nextAsk = 1;
  const asking = new Map<
    number,
    { resolve: (address: ResolvedStream) => void; reject: (error: StreamFailure) => void }
  >();
  /** Bumped by every load and preload, so a preload that finishes late doesn't line up a song. */
  let generation = 0;
  let chain: Promise<unknown> = Promise.resolve();

  const ask = (videoId: string, fresh: boolean) =>
    new Promise<ResolvedStream>((resolve, reject) => {
      const id = nextAsk++;
      asking.set(id, { resolve, reject });
      post({ event: "resolve", id, videoId, fresh });
    });

  /** Waits until the song can start, asking main for its address when the engine has none. */
  const ensure = async (live: StreamingEngine, videoId: string) => {
    let state = live.streamState(videoId);
    if (state === "missing" || state === "failed") {
      live.openStream(videoId, await ask(videoId, state === "failed"));
    }
    const deadline = Date.now() + readyTimeoutMs;
    for (;;) {
      state = live.streamState(videoId);
      if (state === "cached" || state === "ready") return;
      if (state === "failed" || state === "missing") {
        throw new StreamFailure({ code: "stream", message: "the song couldn't be fetched" });
      }
      if (Date.now() >= deadline) {
        throw new StreamFailure({ code: "stream-timeout", message: "the song didn't arrive" });
      }
      await sleep(pollMs);
    }
  };

  const failed = (request: AudioRequest, error: unknown): AudioResponse => ({
    id: request.id,
    ok: false,
    error: error instanceof StreamFailure ? error.failure : failure(error),
  });

  const step = async (request: AudioRequest): Promise<AudioResponse> => {
    const lining = request.call === "load" || request.call === "preload";
    if (lining) generation += 1;
    const videoId = lining ? streamedVideoId(request.args[0]) : undefined;
    if (engine === undefined || videoId === undefined) return answer(engine, request, unavailable);
    if (request.call === "load") {
      try {
        await ensure(engine, videoId);
      } catch (error) {
        return failed(request, error);
      }
      return answer(engine, request);
    }
    // A song lined up next is fetched in the background; until it's here nothing is lined up,
    // so the engine never moves on to the song lined up before.
    const mine = generation;
    const cleared = answer(engine, { ...request, args: [undefined, undefined] });
    void ensure(engine, videoId)
      .then(() => {
        if (generation === mine) answer(engine, request);
      })
      .catch(() => undefined);
    return cleared;
  };

  return {
    handle: (request) => {
      if (request.call === "status") return Promise.resolve(answer(engine, request, unavailable));
      const run = chain.then(() => step(request));
      chain = run.catch(() => undefined);
      return run.catch((error: unknown) => failed(request, error));
    },
    resolved: (reply) => {
      const waiting = asking.get(reply.resolved);
      if (waiting === undefined) return;
      asking.delete(reply.resolved);
      if ("address" in reply) waiting.resolve(reply.address);
      else waiting.reject(new StreamFailure(reply.error));
    },
    pump: () => {
      if (engine === undefined) return;
      for (const request of engine.streamRequests()) {
        ask(request.videoId, true).then(
          (address) => engine.answerStream(request.id, address),
          (error: unknown) => engine.answerStream(request.id, undefined, String(error)),
        );
      }
    },
  };
};
