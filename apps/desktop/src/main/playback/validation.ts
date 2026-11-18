import type { PlaybackCommand } from "../../shared/playerView.ts";

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
