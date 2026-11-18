/** What the audio engine reports after every call, as the window sees it. */
export interface PlaybackStatus {
  readonly state: "idle" | "paused" | "playing" | "ended";
  readonly positionMs: number;
  /** The song's length, when its file says. */
  readonly durationMs?: number | undefined;
  /** The output device's name; absent while the song keeps time without one. */
  readonly device?: string | undefined;
  /** The queue entry the song plays; absent for a file loaded on its own. */
  readonly key?: string | undefined;
  /** When the audio process took this status, in wall-clock ms. */
  readonly observedAtMs?: number | undefined;
}

export interface PlaybackEvent {
  readonly event: "playback";
  readonly status: PlaybackStatus;
  /** Each move to the preloaded song since the last event, in the order they played. */
  readonly transitions: readonly { readonly key: string; readonly atMs: number }[];
}

/** The audio files the engine plays, by extension. */
export const PLAYABLE_EXTENSIONS = ["mp3", "m4a", "mp4", "flac", "ogg", "oga", "opus", "wav"];
