/**
 * The audio process: loads the native engine (`apps/desktop/native`) and answers main's
 * requests with it. It runs apart from main, so a crash here costs only this process.
 * `WAVE_AUDIO_CACHE` is where YT Music songs are kept; without it the engine plays files only.
 */
import { createRequire } from "node:module";
import type { OutputDevice, PlaybackStatus } from "../../shared/playback.ts";
import {
  outputsEvent,
  playbackEvent,
  stamped,
  type AudioRequest,
  type ResolveAnswer,
  type StreamingEngine,
} from "./protocol.ts";
import { streaming } from "./streaming.ts";

interface Addon {
  readonly AudioEngine: new (silent?: boolean, cacheDir?: string) => StreamingEngine;
}

const load = (): { engine?: StreamingEngine; problem?: string } => {
  const path = process.env["WAVE_AUDIO_ADDON"];
  if (path === undefined || path === "") return { problem: "no audio engine was given" };
  const cache = process.env["WAVE_AUDIO_CACHE"];
  try {
    const addon = createRequire(import.meta.url)(path) as Addon;
    return { engine: new addon.AudioEngine(false, cache === "" ? undefined : cache) };
  } catch (error) {
    return { problem: `the audio engine didn't load: ${String(error)}` };
  }
};

const { engine, problem } = load();
const streams = streaming(engine, (event) => process.parentPort.postMessage(event), problem);
process.parentPort.on("message", (event) => {
  const message = event.data as AudioRequest | ResolveAnswer;
  if ("resolved" in message) {
    streams.resolved(message);
    return;
  }
  void streams
    .handle(message)
    .then((response) => process.parentPort.postMessage(stamped(response, Date.now())));
});

// Main hears of every move to the preloaded song, and of the position, without asking, even
// while the window is hidden. The move itself happens in Rust's output callback.
let reported: PlaybackStatus | undefined;
let outputs: readonly OutputDevice[] | undefined;
if (engine !== undefined) {
  setInterval(() => {
    streams.pump();
    const listed = outputsEvent(engine, outputs);
    if (listed !== undefined) {
      outputs = listed.outputs;
      process.parentPort.postMessage(listed);
    }
    const event = playbackEvent(engine, reported, Date.now());
    if (event === undefined) return;
    reported = event.status;
    process.parentPort.postMessage(event);
  }, 25);
}
