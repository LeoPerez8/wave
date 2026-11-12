import type { PlayerTrouble, PositionReport } from "@wave/core";
import type { NativePlayerState, PlayerErrorEvent, PlayerPosition } from "../native/wavePlayer.ts";
import { makeExternalStore } from "../lib/externalStore.ts";

/** Playback changes only; timestamped positions are held by PositionState. */
export interface PlaybackState extends Omit<NativePlayerState, "index" | keyof PlayerPosition> {
  /** Last error for this item; cleared when it changes or plays again. */
  readonly error: string | null;
  /** The error's code, which Core's `playerErrorNotice` explains in the app's language. */
  readonly errorCode: string | null;
}

/** What Core's `playerNotice` reads of the playing song: its wait, retry and failure. */
export const playerTrouble = (state: PlaybackState): PlayerTrouble => ({
  waitingForConnection: state.waitingForConnection,
  retrying: state.status === "buffering" && state.playWhenReady,
  failed: state.error !== null,
  errorCode: state.errorCode,
});

/** The item key keeps car lyrics paired with the report that selected it. */
interface PositionState extends PositionReport {
  readonly item: { readonly id: string } | null;
}

export const makePlaybackStores = (setReportingRequested: (requested: boolean) => void) => {
  const playbackState = makeExternalStore<PlaybackState>({
    status: "idle",
    isPlaying: false,
    playWhenReady: false,
    waitingForConnection: false,
    item: null,
    error: null,
    errorCode: null,
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
        return {
          ...playback,
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
