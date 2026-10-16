import { usePathname } from "expo-router";
import { useEffect } from "react";
import { Keyboard } from "react-native";

import { LibraryStore } from "@/library/LibraryStore";
import { appRuntime } from "@/library/runtime";
import { onNowPlayingShownChange } from "@/nowPlaying/sheet";

import { perfMark, perfTiming, registerPerfMeta, startPerfFlushes } from "./perf";

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
 * `nowPlaying.hidden`), platform long tasks and event timings, and the Library's
 * size with the first flush. It also starts the flushes.
 */
export function PerfProbe() {
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
