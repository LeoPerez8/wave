/**
 * The update policy (docs/spec.md, Build and CI): given where Wave stands, the one thing to do
 * next about an update, or nothing. The app carries the step out and asks again.
 */

/** Checks are at least this far apart. */
export const UPDATE_CHECK_INTERVAL_MS = 15 * 60_000;

/** What the phone is on. A bundle downloads on anything but `none`. */
export type UpdateNetwork = "none" | "metered" | "unmetered";

export interface UpdateState {
  readonly now: number;
  /** When a check last started, whatever came of it; null when none has. */
  readonly lastCheckAt: number | null;
  readonly network: UpdateNetwork;
  /** Music is playing or about to (`playerKeepsPlaying`). */
  readonly playing: boolean;
  /** Wave is in the foreground. */
  readonly visible: boolean;
  /** A step is still running. */
  readonly working: boolean;
  /** A check found a bundle that isn't downloaded yet. */
  readonly bundleAvailable: boolean;
  /** A downloaded bundle waits to run. */
  readonly bundleDownloaded: boolean;
}

export type UpdateStep = "check" | "downloadBundle" | "applyBundle" | "wait";

const checkIsDue = ({ now, lastCheckAt }: UpdateState): boolean =>
  lastCheckAt === null ||
  // A clock set back would otherwise hold checks off until it caught up.
  now < lastCheckAt ||
  now - lastCheckAt >= UPDATE_CHECK_INTERVAL_MS;

/** What to do now. Nothing here ticks: the app asks when something it follows changes. */
export const nextUpdateStep = (state: UpdateState): UpdateStep => {
  if (state.working) return "wait";
  const online = state.network !== "none";
  if (state.bundleAvailable && online) return "downloadBundle";
  if (state.bundleDownloaded && !state.visible && !state.playing) return "applyBundle";
  // A failed check or download retries here, once the 15 minutes are up and Wave is back in front.
  if (state.visible && online && checkIsDue(state)) return "check";
  return "wait";
};

/** Whether the player is playing, or means to as soon as it has buffered. */
export const playerKeepsPlaying = (player: {
  readonly status: "idle" | "buffering" | "ready" | "ended";
  readonly isPlaying: boolean;
  readonly playWhenReady: boolean;
}): boolean =>
  player.isPlaying ||
  (player.playWhenReady && (player.status === "buffering" || player.status === "ready"));
