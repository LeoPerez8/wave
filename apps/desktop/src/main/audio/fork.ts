/** Starts the audio process as an Electron utility process, apart from main and the window. */
import { utilityProcess } from "electron";
import type { PlaybackEvent } from "../../shared/playback.ts";
import type {
  AudioRequest,
  AudioResponse,
  OutputsEvent,
  ResolveAnswer,
  ResolveEvent,
} from "./protocol.ts";
import type { AudioEvents, AudioProcess } from "./supervisor.ts";

/** The name `app.getAppMetrics()` gives the audio process. */
export const AUDIO_SERVICE_NAME = "Wave audio";

/** Forks `entry` (the built `audio.js`), which loads the addon at `addon` and keeps YT Music
 * songs in `cache`. */
export const forkAudio =
  (entry: string, addon: string, cache?: string) =>
  (events: AudioEvents): AudioProcess => {
    const child = utilityProcess.fork(entry, [], {
      serviceName: AUDIO_SERVICE_NAME,
      env: { ...process.env, WAVE_AUDIO_ADDON: addon, WAVE_AUDIO_CACHE: cache ?? "" },
    });
    // Requests sent before the process is up wait for it.
    let queued: (AudioRequest | ResolveAnswer)[] | undefined = [];
    child.once("spawn", () => {
      for (const request of queued ?? []) child.postMessage(request);
      queued = undefined;
    });
    child.on("message", (response: AudioResponse | PlaybackEvent | ResolveEvent | OutputsEvent) =>
      events.message(response),
    );
    child.once("exit", () => {
      queued = undefined;
      events.exit();
    });
    return {
      send: (request) => (queued === undefined ? child.postMessage(request) : queued.push(request)),
      kill: () => void child.kill(),
    };
  };
