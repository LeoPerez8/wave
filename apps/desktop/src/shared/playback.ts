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

/**
 * A move the engine made by itself: on to the song lined up, gaplessly or by a crossfade, and
 * the end of a crossfade, when the song that faded out ([key]) went silent.
 */
export interface PlaybackTransition {
  readonly key: string;
  readonly atMs: number;
  readonly kind?: "gapless" | "crossfade" | "fadeEnded" | undefined;
}

/** What the engine's meter gave for the file of measurement [id] (Normalize Volume). */
export interface LoudnessResult {
  readonly id: string;
  readonly kind: "measured" | "unmeasurable" | "unreadable" | "cancelled";
  /** Integrated loudness in LUFS, when measured. */
  readonly loudness?: number | undefined;
  /** Sample peak on a 0–1 scale, when measured. */
  readonly peak?: number | undefined;
}

export interface PlaybackEvent {
  readonly event: "playback";
  readonly status: PlaybackStatus;
  /** Each move the engine made since the last event, in the order they played. */
  readonly transitions: readonly PlaybackTransition[];
  /** The measurements finished since the last event. */
  readonly measurements?: readonly LoudnessResult[] | undefined;
}

/** An output the system has; `id` stays the same across restarts. */
export interface OutputDevice {
  readonly id: string;
  readonly name: string;
}

/** The audio files the engine plays, by extension. */
export const PLAYABLE_EXTENSIONS = ["mp3", "m4a", "mp4", "flac", "ogg", "oga", "opus", "wav"];
