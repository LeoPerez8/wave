import type { NetworkSignalInput, PlayerTrouble, PositionReport } from "@wave/core";
import type { NativePlayerState, PlayerErrorEvent, PlayerPosition } from "../native/wavePlayer.ts";
import { makeExternalStore } from "@wave/client/externalStore";

/** Playback changes only; timestamped positions are held by PositionState. */
export interface PlaybackState extends Omit<NativePlayerState, "index" | keyof PlayerPosition> {
  /** Last error for this item; cleared when it changes or plays again. */
  readonly error: string | null;
  /** The error's code, which Core's `playerErrorNotice` explains in the app's language. */
  readonly errorCode: string | null;
  /** When the song began loading to play (buffering with play-when-ready), or null while it isn't. */
  readonly loadingSince: number | null;
}

/** What Core's `playerNotice` reads of the playing song: its wait, retry and failure. */
export const playerTrouble = (state: PlaybackState): PlayerTrouble => ({
  waitingForConnection: state.waitingForConnection,
  retrying: state.status === "buffering" && state.playWhenReady,
  failed: state.error !== null,
  errorCode: state.errorCode,
});

/**
 * What Core's `networkSignal` reads of the playing song, with the phone's
 * connection and the time: the wait, the loading and since when, and whether
 * it stands paused on the network's failure (its offline error).
 */
export const networkSignalInput = (
  state: PlaybackState,
  online: boolean,
  nowMs: number,
): NetworkSignalInput => ({
  waitingForConnection: state.waitingForConnection,
  loading: state.loadingSince !== null,
  loadingSinceMs: state.loadingSince,
  cutByNetwork: state.errorCode === "ytOffline",
  online,
  nowMs,
});

/** The item key keeps car lyrics paired with the report that selected it. */
interface PositionState extends PositionReport {
  readonly item: { readonly id: string } | null;
}

type ReportedItem = NativePlayerState["item"];

/** Whether two reports show the same song alike: each report brings a new item object (#1423). */
const sameItemShown = (a: ReportedItem, b: ReportedItem): boolean =>
  a === b ||
  (a !== null &&
    b !== null &&
    a.id === b.id &&
    a.title === b.title &&
    a.artist === b.artist &&
    a.album === b.album &&
    a.artworkUri === b.artworkUri);

export const makePlaybackStores = (
  setReportingRequested: (requested: boolean) => void,
  now: () => number = Date.now,
) => {
  const playbackState = makeExternalStore<PlaybackState>({
    status: "idle",
    isPlaying: false,
    playWhenReady: false,
    waitingForConnection: false,
    item: null,
    error: null,
    errorCode: null,
    loadingSince: null,
  });
  const positions = makeExternalStore<PositionState>({
    positionMs: 0,
    durationMs: null,
    at: 0,
    isPlaying: false,
    item: null,
  });
  // Whether the player has reported before: its first report is Wave opening on it.
  let reported = false;
  // The item the last error event was for.
  let failedItemId: string | null = null;
  // The player's standing error is the item before's: it moved on without preparing yet.
  let errorLeftBehind = false;
  return {
    playbackState,
    positionState: {
      ...positions,
      subscribe: (listener: () => void): (() => void) => {
        const first = positions.listenerCount() === 0;
        // A distinct callback lets two owners subscribe the same listener safely.
        const stop = positions.subscribe(() => listener());
        if (first) setReportingRequested(true);
        let released = false;
        return () => {
          if (released) return;
          released = true;
          stop();
          if (positions.listenerCount() === 0) setReportingRequested(false);
        };
      },
    },
    reportState: (state: NativePlayerState): void => {
      const { index: _index, positionMs, durationMs, at, ...playback } = state;
      positions.set({
        positionMs,
        durationMs,
        at,
        isPlaying: state.isPlaying,
        item: state.item === null ? null : { id: state.item.id },
      });
      playbackState.update((previous) => {
        const itemId = state.item?.id ?? null;
        const sameItem = (previous.item?.id ?? null) === itemId;
        // The player keeps an item's error until it prepares again, so on a move its code
        // is the last item's unless this one failed. Wave opening on the player has only
        // this code to go by (the error event came before it).
        if (state.errorCode === null) errorLeftBehind = false;
        else if (reported && !sameItem) errorLeftBehind = failedItemId !== itemId;
        reported = true;
        const errorCode = errorLeftBehind ? null : state.errorCode;
        const errorStands = sameItem && !state.isPlaying;
        const loading = state.status === "buffering" && state.playWhenReady;
        return {
          ...playback,
          // Another song starts its own loading time.
          loadingSince: loading ? ((sameItem ? previous.loadingSince : null) ?? now()) : null,
          item: sameItemShown(previous.item, playback.item) ? previous.item : playback.item,
          error: errorStands ? previous.error : null,
          errorCode: errorStands ? (errorCode ?? previous.errorCode) : errorCode,
        };
      });
    },
    reportPosition: (position: PlayerPosition): void =>
      positions.update((previous) => ({ ...previous, ...position })),
    reportError: (event: PlayerErrorEvent): void =>
      playbackState.update((previous) => {
        failedItemId = event.itemId ?? previous.item?.id ?? null;
        errorLeftBehind = false;
        return { ...previous, error: event.message, errorCode: event.code };
      }),
  };
};
