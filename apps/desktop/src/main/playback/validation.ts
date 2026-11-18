import { CROSSFADE, STREAM_BUFFER_MINUTES } from "@wave/core";

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
  };
  return Object.entries(value).every(
    ([name, x]) => Object.hasOwn(checks, name) && checks[name as keyof PlaybackSettings](x),
  );
};

/** Whether [value], sent by the window, is a queue command main may run. */
export const validPlaybackCommand = (value: unknown): value is PlaybackCommand => {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const key = (x: unknown) => typeof x === "string" && /^\d{1,16}$/.test(x);
  switch (v.type) {
    case "next":
    case "previous":
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
      return Array.isArray(v.trackIds) && v.trackIds.length <= 10000 && v.trackIds.every(key);
    default:
      return false;
  }
};
