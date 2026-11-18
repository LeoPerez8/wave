/**
 * Settings › Playback › Buffer on the desktop. The audio process fetches a YT Music song
 * whole, so the Buffer isn't a stretch of audio as on the phone: it's the songs after the
 * current one that are fetched before their turn. Core's `songsWithinBuffer` says which.
 */
import {
  bufferAheadMs,
  parseTrackId,
  songsWithinBuffer,
  streamBufferMs,
  type QueueState,
  type StreamBufferMinutes,
} from "@wave/core";

/**
 * The video ids to fetch ahead for a Buffer of [minutes], in playing order. Library files
 * count for the time they play and are left out, as they need no fetching.
 */
export const streamedWithinBuffer = (
  state: QueueState,
  minutes: StreamBufferMinutes,
  durationMs: (trackId: string) => number | null,
): string[] => {
  const reached = songsWithinBuffer(state, {
    bufferMs: bufferAheadMs(streamBufferMs(minutes), true),
    durationMs,
  });
  const videoIds = reached.flatMap((trackId) => {
    const ref = parseTrackId(trackId);
    return ref?.kind === "yt" ? [ref.videoId] : [];
  });
  return [...new Set(videoIds)];
};
