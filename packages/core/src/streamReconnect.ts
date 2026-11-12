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
  | {
      readonly type: "connection";
      readonly online: boolean;
      readonly key: string | null;
      /** Another app is playing audio right now; a resume would take it over. */
      readonly otherAudio: boolean;
    }
  /** An owner command (pause, play, skip, seek or replace), sleep timer or service shutdown. */
  | { readonly type: "cancel" }
  /** The audio output went away (headphones unplugged, Bluetooth disconnected). */
  | { readonly type: "outputLost" }
  | { readonly type: "timeout" };

export interface StreamReconnectResult {
  readonly waiting: StreamReconnectWait | null;
  /** Prepare this entry at its saved position, then ask for audio focus with play. */
  readonly resume: StreamReconnectWait | null;
  /**
   * A wait ended with nobody ending it: ten minutes passed, the output went away, another
   * app was playing when the network returned, or the retry met a failure that never waits.
   * The service stops then if Wave was swiped away during the wait.
   */
  readonly gaveUp: boolean;
}

const held = (waiting: StreamReconnectWait): StreamReconnectResult => ({
  waiting,
  resume: null,
  gaveUp: false,
});
const ended = (gaveUp: boolean): StreamReconnectResult => ({
  waiting: null,
  resume: null,
  gaveUp,
});

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
    const same = waiting !== null && waiting.key === event.key;
    if (
      !event.streamed ||
      event.code !== "ytOffline" ||
      !event.playWhenReady ||
      event.key === null
    ) {
      return ended(same);
    }
    if (same) return nowMs < waiting.expiresAtMs ? held(waiting) : ended(true);
    return held({ key: event.key, positionMs: event.positionMs, expiresAtMs: nowMs + 600_000 });
  }
  if (event.type === "cancel" || waiting === null) return ended(false);
  if (event.type === "connection" && event.key !== waiting.key) return ended(false);
  if (nowMs >= waiting.expiresAtMs || event.type === "outputLost") return ended(true);
  if (event.type === "connection" && event.online) {
    return event.otherAudio ? ended(true) : { waiting: null, resume: waiting, gaveUp: false };
  }
  return held(waiting);
};
