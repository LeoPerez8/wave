/**
 * The audio process's side of YT Music songs (docs/spec-desktop.md, Audio engine). A `yt:` path
 * needs an address first: the process asks main, which asks the JVM, hands the address to the
 * engine, and loads the song once its first bytes are here. The bytes never leave the engine.
 *
 * Calls about the song run one after another, so a call sent after a load acts on the song it
 * loaded. A newer load ends the ones before it, and the calls sent for their songs, with
 * `superseded`. `status`, the volume, the settings and the measurements answer at once.
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
  /** How long main has to answer with a song's address. */
  readonly resolveTimeoutMs?: number;
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

/** Calls that don't depend on which song is loaded, so they never wait for one. */
const AT_ONCE: ReadonlySet<AudioRequest["call"]> = new Set([
  "status",
  "setVolume",
  "setCrossfade",
  "setNormalize",
  "measure",
  "cancelMeasurements",
]);

const superseded = () =>
  new StreamFailure({ code: "superseded", message: "another song was loaded since" });

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
  const resolveTimeoutMs = options.resolveTimeoutMs ?? 20_000;
  const pollMs = options.pollMs ?? 25;
  let nextAsk = 1;
  const asking = new Map<
    number,
    { resolve: (address: ResolvedStream) => void; reject: (error: StreamFailure) => void }
  >();
  /** Bumped by every load and preload, so a preload that finishes late doesn't line up a song. */
  let generation = 0;
  /** The number of loads received; a call carries the one it was sent after. */
  let loads = 0;
  /** Ends the wait of the load being fetched, when a newer one comes. */
  let endLoad: (() => void) | undefined;
  let chain: Promise<unknown> = Promise.resolve();

  /** Main's address for the song; an answer later than `resolveTimeoutMs` is dropped. */
  const ask = (videoId: string, fresh: boolean) =>
    new Promise<ResolvedStream>((resolve, reject) => {
      const id = nextAsk++;
      const timer = setTimeout(() => {
        asking.delete(id);
        reject(new StreamFailure({ code: "stream-timeout", message: "no address came" }));
      }, resolveTimeoutMs);
      asking.set(id, {
        resolve: (address) => {
          clearTimeout(timer);
          resolve(address);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
      });
      post({ event: "resolve", id, videoId, fresh });
    });

  /**
   * Waits until the song can start, asking main for its address when the engine has none.
   * `stale` ends the wait once nothing wants the song any more.
   */
  const ensure = async (live: StreamingEngine, videoId: string, stale: () => boolean) => {
    let state = live.streamState(videoId);
    if (state === "missing" || state === "failed") {
      const address = await ask(videoId, state === "failed");
      if (stale()) throw superseded();
      live.openStream(videoId, address);
    }
    const deadline = Date.now() + readyTimeoutMs;
    for (;;) {
      if (stale()) throw superseded();
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

  const step = async (request: AudioRequest, sentAfter: number): Promise<AudioResponse> => {
    // Sent for a song a newer load has replaced since.
    if (sentAfter !== loads) return failed(request, superseded());
    const lining = request.call === "load" || request.call === "preload";
    if (lining) generation += 1;
    const videoId = lining ? streamedVideoId(request.args[0]) : undefined;
    if (engine === undefined || videoId === undefined) return answer(engine, request, unavailable);
    if (request.call === "load") {
      try {
        await Promise.race([
          ensure(engine, videoId, () => sentAfter !== loads),
          new Promise<never>((_, reject) => (endLoad = () => reject(superseded()))),
        ]);
      } catch (error) {
        return failed(request, error);
      } finally {
        endLoad = undefined;
      }
      return answer(engine, request);
    }
    // A song lined up next is fetched in the background; until it's here nothing is lined up,
    // so the engine never moves on to the song lined up before.
    const mine = generation;
    const cleared = answer(engine, { ...request, args: [undefined, undefined] });
    void ensure(engine, videoId, () => generation !== mine)
      .then(() => {
        if (generation === mine) answer(engine, request);
      })
      .catch(() => undefined);
    return cleared;
  };

  return {
    handle: (request) => {
      if (AT_ONCE.has(request.call)) return Promise.resolve(answer(engine, request, unavailable));
      if (request.call === "load") {
        loads += 1;
        endLoad?.();
      }
      const sentAfter = loads;
      const run = chain.then(() => step(request, sentAfter));
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
