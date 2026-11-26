/**
 * The network signal (Ghost wave, #1498): what Now Playing, the mini player
 * and the notification show while the network holds a playing song up. The
 * playback service's ten-minute wait (Resume on reconnect, `streamReconnect`)
 * is unchanged; this only says, from the playback state, connectivity and the
 * time, which of four looks the song has.
 */

import { en, type Catalogue } from "./catalogueEn.ts";

/**
 * - `playing`: as today, nothing to say (a song paused by hand included).
 * - `offline`: the song waits for the network, or is held up without one.
 * - `slow`: the song loads with a connection, past the grace.
 * - `back`: the wait ended with the song paused where the network cut it, and
 *   Android reports a connection again: the owner taps play to go on.
 */
export type NetworkSignal = "playing" | "offline" | "slow" | "back";

/** What the signal reads of the playing song (the app's playback store and connectivity). */
export interface NetworkSignalInput {
  /** The playback service waits for the network to resume this song. */
  readonly waitingForConnection: boolean;
  /** The player loads the song to play it (buffering with play-when-ready). */
  readonly loading: boolean;
  /** When that loading began (ms, the same clock as [nowMs]); null counts from now. */
  readonly loadingSinceMs: number | null;
  /** The song stands paused on a network failure (its stream error is the offline one). */
  readonly cutByNetwork: boolean;
  /** Android reports a connection that reaches the internet. */
  readonly online: boolean;
  readonly nowMs: number;
}

/** How long a song may load before it shows Slow (or Offline without a connection), so an ordinary start never does. */
export const NETWORK_SLOW_GRACE_MS = 1500;

const loadedMs = (input: NetworkSignalInput): number =>
  input.loadingSinceMs === null ? 0 : input.nowMs - input.loadingSinceMs;

/**
 * The song's signal. Waiting is Offline. Loading past the grace is Slow, or
 * Offline without a connection; a song loading again after the network cut it
 * (its offline error still standing) skips the grace, so the look doesn't
 * flash back to playing between the wait and the music. A song left paused on
 * the network's failure, the wait over, is Back with a connection and stays
 * Offline without one.
 */
export const networkSignal = (input: NetworkSignalInput): NetworkSignal => {
  if (input.waitingForConnection) return "offline";
  if (input.loading) {
    if (!input.cutByNetwork && loadedMs(input) < NETWORK_SLOW_GRACE_MS) return "playing";
    return input.online ? "slow" : "offline";
  }
  if (input.cutByNetwork) return input.online ? "back" : "offline";
  return "playing";
};

/** In how many ms [networkSignal] could answer differently with nothing else changing (the grace ending), or null. */
export const networkSignalRecheckMs = (input: NetworkSignalInput): number | null => {
  if (input.waitingForConnection || !input.loading || input.cutByNetwork) return null;
  const left = NETWORK_SLOW_GRACE_MS - loadedMs(input);
  return left > 0 ? left : null;
};

/** What [followNetworkSignal] remembers between two signals. */
export interface NetworkSignalTrail {
  readonly itemId: string | null;
  /** The song showed Offline since it last played. */
  readonly cut: boolean;
}

/**
 * Follows the signal from one report to the next. [backOnline] is true once,
 * when the song that showed Offline plays again within the wait: Now Playing
 * shows "Back online" for a moment. Another song playing, or the wait ending
 * paused (Back, which has its own line), forgets the cut.
 */
export const followNetworkSignal = (
  trail: NetworkSignalTrail | null,
  itemId: string | null,
  signal: NetworkSignal,
): { readonly trail: NetworkSignalTrail; readonly backOnline: boolean } => {
  const cut = trail !== null && trail.itemId === itemId && trail.cut;
  switch (signal) {
    case "offline":
      return { trail: { itemId, cut: true }, backOnline: false };
    case "slow":
      return { trail: { itemId, cut }, backOnline: false };
    case "back":
      return { trail: { itemId, cut: false }, backOnline: false };
    case "playing":
      return { trail: { itemId, cut: false }, backOnline: cut };
  }
};

/** What takes the place of the time left under Now Playing's scrubber, or null for the time itself. */
export const networkSignalLabel = (
  signal: NetworkSignal,
  catalogue: Catalogue = en,
): string | null => {
  if (signal === "offline") return catalogue.playbackText.noInternet;
  if (signal === "slow") return catalogue.library.loading;
  return null;
};

/** The catalog line under Now Playing's controls: Back's, or "Back online" while [backOnline] shows. */
export const networkSignalLine = (
  signal: NetworkSignal,
  backOnline: boolean,
  catalogue: Catalogue = en,
): string | null => {
  if (signal === "back") return catalogue.playbackText.internetsBackTapPlay;
  if (signal === "playing" && backOnline) return catalogue.playbackText.backOnline;
  return null;
};

/** What TalkBack announces as the song enters [next] from [previous], or null. */
export const networkSignalAnnouncement = (
  previous: NetworkSignal,
  next: NetworkSignal,
  catalogue: Catalogue = en,
): string | null => {
  if (previous === next) return null;
  if (next === "offline") return catalogue.playbackText.noInternetTheSongContinuesWhenItsBack;
  if (next === "slow") return catalogue.playbackText.slowConnection;
  if (next === "back") return catalogue.playbackText.internetsBackTapPlayToContinue;
  return null;
};
