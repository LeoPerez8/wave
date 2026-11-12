import {
  readStreamBuffer,
  STREAM_BUFFER_DEFAULT,
  STREAM_BUFFER_MINUTES,
  streamBufferMs,
  type StreamBufferMinutes,
} from "@wave/core";

import { persistedSetting } from "@/lib/persistedSetting";
import { currentLocalisation } from "@/localisation/localisation";
import { WavePlayer } from "@/native/wavePlayer";

import type { ChoiceSetting } from "./ChoiceRow";

/**
 * Tells the playback service how much streamed audio to keep loaded ahead
 * (Core's `streamBufferMs`). It applies from the player's next buffering
 * decision, without restarting playback.
 */
const send = (minutes: StreamBufferMinutes): void => {
  WavePlayer.setStreamBuffer(streamBufferMs(minutes)).catch((error: unknown) =>
    console.warn("[wave] Couldn't apply the buffer", error),
  );
};

const listeners = new Set<() => void>();
let applied = false;

/** Buffer (Settings › Playback), in minutes of streamed audio; 2 by default. */
const streamBuffer = persistedSetting<StreamBufferMinutes>({
  key: "settings.streamBufferMinutes",
  synced: true,
  read: readStreamBuffer,
  write: (minutes) => (minutes === STREAM_BUFFER_DEFAULT ? null : String(minutes)),
  onValue: (minutes) => {
    send(minutes);
    // The first value is the stored one being read, not a change.
    if (applied) for (const listener of listeners) listener();
    applied = true;
  },
});

/** The Buffer now, in ms: what a queue's time left is compared with before it continues. */
export const currentStreamBufferMs = (): number => streamBufferMs(streamBuffer.get());

/** Runs [listener] at every change of the Buffer, here or pulled from the Wave account. */
export const subscribeStreamBuffer = (listener: () => void): (() => void) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};

/** Hands the playback service the stored buffer at start (headless Auto too). */
export const applyStreamBuffer = (): void => {
  streamBuffer.get();
};

/** Buffer as Settings › Playback lists it. */
export const streamBufferChoice: ChoiceSetting<StreamBufferMinutes> = {
  get label() {
    return currentLocalisation().strings.settings.buffer;
  },
  get choices() {
    const { strings } = currentLocalisation();
    return STREAM_BUFFER_MINUTES.map((minutes) => ({
      value: minutes,
      label: strings.settings.minutes(minutes),
    }));
  },
  setting: streamBuffer,
};
