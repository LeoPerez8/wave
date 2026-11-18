/**
 * The audio process: loads the native engine (`apps/desktop/native`) and answers main's
 * requests with it. It runs apart from main, so a crash here costs only this process.
 */
import { createRequire } from "node:module";
import { answer, type AddonEngine, type AudioRequest } from "./protocol.ts";

interface Addon {
  readonly AudioEngine: new () => AddonEngine;
}

const load = (): { engine?: AddonEngine; problem?: string } => {
  const path = process.env["WAVE_AUDIO_ADDON"];
  if (path === undefined || path === "") return { problem: "no audio engine was given" };
  try {
    const addon = createRequire(import.meta.url)(path) as Addon;
    return { engine: new addon.AudioEngine() };
  } catch (error) {
    return { problem: `the audio engine didn't load: ${String(error)}` };
  }
};

const { engine, problem } = load();
process.parentPort.on("message", (event) =>
  process.parentPort.postMessage(answer(engine, event.data as AudioRequest, problem)),
);
