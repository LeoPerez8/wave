import { usePathname } from "expo-router";
import { useEffect } from "react";
import { Keyboard } from "react-native";
import { useAnimatedReaction } from "react-native-reanimated";
import { scheduleOnRN } from "react-native-worklets";

import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import {
  nowPlayingListenerCount,
  onNowPlayingShownChange,
  sheetHeight,
  sheetOffset,
} from "@/nowPlaying/sheet";
import { playbackState } from "@/playback/Player";
import { queueState } from "@/playback/Queue";
import { queueTracks } from "@/playback/queueTracks";

import { perfMark, perfTiming, registerPerfMeta, startPerfFlushes } from "./perf";

/** Subscribers to the stores Now Playing and its Queue follow, for each flush's metadata. */
const listenerCounts = () => ({
  playback: playbackState.listenerCount(),
  queue: queueState.listenerCount(),
  queueTracks: queueTracks.listenerCount(),
  nowPlaying: nowPlayingListenerCount(),
});

/**
 * Marks `nowPlaying.motion` when the sheet leaves a resting place (open or
 * gone). The UI thread sees the move; the mark lands when JavaScript gets
 * to it, and its detail says how much later that was, in ms (`Date.now`
 * on both threads).
 */
const markMotion = (movedAt: number): void =>
  perfMark("nowPlaying.motion", String(Math.max(0, Date.now() - movedAt)));

const useSheetMotionMark = (): void => {
  useAnimatedReaction(
    () => sheetOffset.get(),
    (now, before) => {
      if (before === null || now === before) return;
      const leftBottom = before >= sheetHeight.get() - 0.5 && now < before;
      const leftTop = before <= 0.5 && now > before;
      if (leftBottom || leftTop) scheduleOnRN(markMotion, Date.now());
    },
  );
};

/** The Library's size, for each flush's metadata. */
// oxlint-disable-next-line react/rules-of-hooks -- Effect Service.use resolves a service; it is not a React Hook.
const measureLibrary = LibraryStore.use((store) => store.measureScale);

type ObservedEntry = {
  entryType: string;
  name: string;
  startTime: number;
  duration: number;
  processingStart?: number;
  processingEnd?: number;
};

type Observer = {
  observe(options: { type: string; buffered?: boolean }): void;
  disconnect(): void;
};
type ObserverClass = {
  new (callback: (list: { getEntries(): ObservedEntry[] }) => void): Observer;
  supportedEntryTypes?: readonly string[];
};

/** Long tasks and event timings, when this React Native reports them. */
const observeTimings = (): (() => void) => {
  const Observer = (globalThis as { PerformanceObserver?: ObserverClass }).PerformanceObserver;
  const supported = Observer?.supportedEntryTypes ?? [];
  if (Observer === undefined) return () => {};
  const observers = (["longtask", "event"] as const)
    .filter((type) => supported.includes(type))
    .map((type) => {
      const observer = new Observer((list) => {
        for (const entry of list.getEntries()) {
          const at = Math.round(entry.startTime * 100) / 100;
          const duration = Math.round(entry.duration * 100) / 100;
          if (entry.entryType === "longtask") perfTiming({ kind: "longtask", at, duration });
          else
            perfTiming({
              kind: "event",
              name: entry.name,
              at,
              duration,
              processingStart: entry.processingStart ?? at,
              processingEnd: entry.processingEnd ?? at,
            });
        }
      });
      try {
        observer.observe({ type });
      } catch {
        // An entry type listed but not observable on this build: go without it.
      }
      return observer;
    });
  return () => observers.forEach((observer) => observer.disconnect());
};

/**
 * What a perf build marks for the whole app, mounted once by the root layout
 * (only in perf builds): each route on the first frame it shows (`route`), the
 * keyboard (`keyboard.show`, `keyboard.hide`), Now Playing (`nowPlaying.shown`,
 * `nowPlaying.hidden`, `nowPlaying.motion`; `sheet.ts` marks its steps),
 * platform long tasks and event timings, the Library's size with the first
 * flush and the playback stores' listener counts with each. It also starts the
 * flushes.
 */
export function PerfProbe() {
  useSheetMotionMark();
  const pathname = usePathname();
  useEffect(() => {
    requestAnimationFrame(() => perfMark("route", pathname));
  }, [pathname]);

  useEffect(() => {
    registerPerfMeta(
      "library",
      async () => ({ ...(await appRuntime.runPromise(measureLibrary)) }),
      true,
    );
    registerPerfMeta("listeners", listenerCounts);
    const show = Keyboard.addListener("keyboardDidShow", () => perfMark("keyboard.show"));
    const hide = Keyboard.addListener("keyboardDidHide", () => perfMark("keyboard.hide"));
    let shown: boolean | null = null;
    const stopNowPlaying = onNowPlayingShownChange((now) => {
      if (now === shown) return;
      shown = now;
      perfMark(now ? "nowPlaying.shown" : "nowPlaying.hidden");
    });
    const stopTimings = observeTimings();
    const stopFlushes = startPerfFlushes();
    return () => {
      stopFlushes();
      show.remove();
      hide.remove();
      stopNowPlaying();
      stopTimings();
    };
  }, []);

  return null;
}
