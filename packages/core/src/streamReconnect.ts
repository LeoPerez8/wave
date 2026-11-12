/** A network pause belongs to this queue entry and position, for ten minutes. */
export interface StreamReconnectWait {
  readonly key: string;
  readonly positionMs: number;
  readonly expiresAtMs: number;
}

export type StreamReconnectEvent =
  | {
      readonly type: "failure";
      readonly key: string | null;
      readonly positionMs: number;
      readonly streamed: boolean;
      readonly code: string | null;
      readonly playWhenReady: boolean;
    }
  | { readonly type: "connection"; readonly online: boolean; readonly key: string | null }
  /** An owner command (pause, play, skip, seek or replace), sleep timer or service shutdown. */
  | { readonly type: "cancel" }
  | { readonly type: "timeout" };

export interface StreamReconnectResult {
  readonly waiting: StreamReconnectWait | null;
  /** Prepare this entry at its saved position, then ask for audio focus with play. */
  readonly resume: StreamReconnectWait | null;
}

/**
 * Mirrored by Kotlin's StreamReconnectPolicy; both use elapsed time in the service.
 * Until playback starts, keep a returned resume and pass it back if preparation fails.
 */
export const streamReconnect = (
  waiting: StreamReconnectWait | null,
  event: StreamReconnectEvent,
  nowMs: number,
): StreamReconnectResult => {
  if (event.type === "failure") {
    if (
      !event.streamed ||
      event.code !== "ytOffline" ||
      !event.playWhenReady ||
      event.key === null
    ) {
      return { waiting: null, resume: null };
    }
    if (waiting?.key === event.key) {
      return { waiting: nowMs < waiting.expiresAtMs ? waiting : null, resume: null };
    }
    return {
      waiting: { key: event.key, positionMs: event.positionMs, expiresAtMs: nowMs + 600_000 },
      resume: null,
    };
  }
  if (
    event.type === "cancel" ||
    waiting === null ||
    nowMs >= waiting.expiresAtMs ||
    (event.type === "connection" && event.key !== waiting.key)
  )
    return { waiting: null, resume: null };
  if (event.type === "connection" && event.online) return { waiting: null, resume: waiting };
  return { waiting, resume: null };
};
