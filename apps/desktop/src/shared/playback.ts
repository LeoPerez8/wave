/** What the audio engine reports after every call, as the window sees it. */
export interface PlaybackStatus {
  readonly state: "idle" | "paused" | "playing" | "ended";
  readonly positionMs: number;
  /** The song's length, when its file says. */
  readonly durationMs?: number | undefined;
  /** The output device's name; absent while the song keeps time without one. */
  readonly device?: string | undefined;
}

/** The audio files the engine plays, by extension. */
export const PLAYABLE_EXTENSIONS = ["mp3", "m4a", "mp4", "flac", "ogg", "oga", "opus", "wav"];
