import { playerErrorNotice, type PositionReport } from "@wave/core";
import type { NativePlayerState, PlayerErrorEvent, PlayerPosition } from "../native/wavePlayer.ts";
import { makeExternalStore } from "../lib/externalStore.ts";

/** Playback changes only; timestamped positions are held by PositionState. */
export interface PlaybackState extends Omit<NativePlayerState, "index" | keyof PlayerPosition> {
  /** Last error for this item; cleared when it changes or plays again. */
  readonly error: string | null;
  /** Core's user-facing explanation of a playback error. */
  readonly notice: string | null;
}

/** The item key keeps car lyrics paired with the report that selected it. */
export interface PositionState extends PositionReport {
  readonly item: { readonly id: string } | null;
}

export const makePlaybackStores = (setReportingRequested: (requested: boolean) => void) => {
  const playbackState = makeExternalStore<PlaybackState>({
    status: "idle",
    isPlaying: false,
    playWhenReady: false,
    item: null,
    error: null,
    notice: null,
  });
  const positions = makeExternalStore<PositionState>({
    positionMs: 0,
    durationMs: null,
    at: 0,
    isPlaying: false,
    item: null,
  });
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
        const errorStands = previous.item?.id === state.item?.id && !state.isPlaying;
        return {
          ...playback,
          error: errorStands ? previous.error : null,
          notice: errorStands ? previous.notice : null,
        };
      });
    },
    reportPosition: (position: PlayerPosition): void =>
      positions.update((previous) => ({ ...previous, ...position })),
    reportError: (event: PlayerErrorEvent): void =>
      playbackState.update((previous) => ({
        ...previous,
        error: event.message,
        notice: playerErrorNotice(event.code),
      })),
  };
};
