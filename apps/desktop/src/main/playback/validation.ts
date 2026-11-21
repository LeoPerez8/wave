import {
  CROSSFADE,
  CUSTOM_SLEEP_MINUTES,
  SHUFFLE_KINDS,
  STREAM_BUFFER_MINUTES,
  type SleepTimerChoice,
  type UpNextPlace,
} from "@wave/core";

import type { PlaybackCommand } from "../../shared/playerView.ts";
import type { PlaybackSettings } from "../../shared/playbackSettings.ts";

/** Whether [value], sent by the window, is a change to Settings › Playback main may keep. */
export const validPlaybackSettings = (value: unknown): value is Partial<PlaybackSettings> => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const checks: Record<keyof PlaybackSettings, (x: unknown) => boolean> = {
    crossfadeSeconds: (x) =>
      typeof x === "number" && Number.isFinite(x) && x >= CROSSFADE.min && x <= CROSSFADE.max,
    normalizeVolume: (x) => typeof x === "boolean",
    bufferMinutes: (x) => (STREAM_BUFFER_MINUTES as readonly unknown[]).includes(x),
    shuffleKind: (x) => (SHUFFLE_KINDS as readonly unknown[]).includes(x),
    dontPlayExplicit: (x) => typeof x === "boolean",
    continueQueue: (x) => typeof x === "boolean",
  };
  return Object.entries(value).every(
    ([name, x]) => Object.hasOwn(checks, name) && checks[name as keyof PlaybackSettings](x),
  );
};

const queueKey = (x: unknown) => typeof x === "string" && /^\d{1,16}$/.test(x);

/** Whether [value], sent by the window, is a place in Up Next: two neighbours' keys, or null. */
export const validUpNextPlace = (value: unknown): value is UpNextPlace => {
  if (typeof value !== "object" || value === null) return false;
  const { after, before } = value as Record<string, unknown>;
  return (after === null || queueKey(after)) && (before === null || queueKey(before));
};

/** Whether [at] may go with [action]: only Add to Queue takes a place, and needn't. */
export const validQueuePlace = (action: unknown, at: unknown): boolean =>
  at === undefined || (action === "addToQueue" && validUpNextPlace(at));

/** Whether [value], sent by the window, is a queue command main may run. */
export const validPlaybackCommand = (value: unknown): value is PlaybackCommand => {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const key = queueKey;
  switch (v.type) {
    case "next":
    case "previous":
    case "reshuffle":
      return true;
    case "setShuffle":
      return typeof v.on === "boolean";
    case "setRepeat":
      return ["off", "one", "all"].includes(String(v.mode));
    case "jumpTo":
    case "remove":
      return key(v.key);
    case "move":
      return (
        key(v.key) && (v.before === null || key(v.before)) && (v.after === null || key(v.after))
      );
    case "playNext":
    case "addToQueue":
      return (
        Array.isArray(v.trackIds) &&
        v.trackIds.length <= 10000 &&
        v.trackIds.every(key) &&
        validQueuePlace(v.type, v.at)
      );
    default:
      return false;
  }
};

/** Whether [value], sent by the window, is a sleep timer main may start (null cancels one). */
export const validSleepTimerChoice = (value: unknown): value is SleepTimerChoice | null => {
  if (value === null) return true;
  if (typeof value !== "object") return false;
  const v = value as Record<string, unknown>;
  if (v.type === "endOfTrack" || v.type === "endOfQueue") return true;
  return (
    v.type === "minutes" &&
    Number.isSafeInteger(v.minutes) &&
    (v.minutes as number) >= CUSTOM_SLEEP_MINUTES.min &&
    (v.minutes as number) <= CUSTOM_SLEEP_MINUTES.max
  );
};
