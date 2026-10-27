import { extrapolatePosition, type PositionReport } from "@wave/core";
import { useEffect, useSyncExternalStore } from "react";
import { AppState } from "react-native";
import { makeMutable, useFrameCallback } from "react-native-reanimated";
import { scheduleOnUI } from "react-native-worklets";

import { makeExternalStore } from "@/lib/externalStore";
import { playbackState, sleepTimerState } from "@/playback/Player";
import { observePlayhead } from "./playheadSource";
import { isNowPlayingShown, onNowPlayingShownChange } from "./sheet";

/** One UI-thread source. Reading these in worklets never subscribes React to frames. */
export const playhead = {
  positionMs: makeMutable(0),
  durationMs: makeMutable<number | null>(null),
  now: makeMutable(0),
  live: makeMutable(false),
};
const report = makeMutable<PositionReport>({
  positionMs: 0,
  durationMs: null,
  at: 0,
  isPlaying: false,
});
const duration = makeExternalStore<number | null>(null);
/** Lets one-shot lyric scroll work cancel itself when screen work stops. */
export const playheadVisibility = makeExternalStore(false);

/** For layout and enabled state only; position reports with the same duration don't render. */
export const usePlayheadDuration = (): number | null =>
  useSyncExternalStore(duration.subscribe, duration.get);

/** Also guards callbacks already queued from the UI when the app was hidden. */
export const isPlayheadLive = (): boolean =>
  isNowPlayingShown() && AppState.currentState === "active";

const resetReport = (next: PositionReport, now: number): void => {
  "worklet";
  report.set(next);
  playhead.durationMs.set(next.durationMs);
  playhead.now.set(now);
  playhead.positionMs.set(extrapolatePosition(next, now));
};
const setLive = (live: boolean): void => {
  "worklet";
  playhead.live.set(live);
};

/** Mount exactly once in NowPlayingSheet, including while the sheet is closed. */
export const usePlayheadSource = (): void => {
  const frame = useFrameCallback(() => {
    if (!playhead.live.get()) return;
    const now = Date.now();
    playhead.now.set(now);
    playhead.positionMs.set(extrapolatePosition(report.get(), now));
  }, false);

  useEffect(
    () =>
      observePlayhead(
        {
          reports: playbackState,
          timer: sleepTimerState,
          shown: { get: isNowPlayingShown, subscribe: onNowPlayingShownChange },
          active: {
            get: () => AppState.currentState === "active",
            subscribe: (listener) => {
              const subscription = AppState.addEventListener("change", listener);
              return () => subscription.remove();
            },
          },
        },
        {
          report: (value, now) => {
            const { positionMs, durationMs, at, isPlaying } = value;
            scheduleOnUI(resetReport, { positionMs, durationMs, at, isPlaying }, now);
            duration.set(durationMs);
          },
          live: (live) => {
            playheadVisibility.set(live);
            scheduleOnUI(setLive, live);
          },
          ticking: frame.setActive,
        },
      ),
    [frame],
  );
};
