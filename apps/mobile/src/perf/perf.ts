import { createPerfRecorder, type PerfMeta, type PerfTiming } from "@wave/core";
import { useEffect } from "react";
import type { GestureResponderEvent } from "react-native";

/**
 * Performance instrumentation for the release runner (docs/performance/README.md).
 *
 * Off unless the bundle was built with `EXPO_PUBLIC_WAVE_PERF=1`: then every
 * export below is a no-op chosen once, at module load, so instrumented code
 * costs a call to an empty function. On, marks and render counts are kept in
 * memory (Core's `createPerfRecorder`) and written to logcat only once the app
 * has had no touch for `PERF_FLUSH_QUIET_MS`, after the runner's measured window.
 *
 * The API later tickets use:
 * - `perfMark(name, detail?)`: a timing mark, at `performance.now()`.
 * - `useRenderCount(component)`: counts the component's renders; call it first thing in the body.
 * - `usePerfVisible(name)`: marks `visible` with [name] on the first frame after mount.
 * - `registerPerfMeta(name, source, once?)`: values reported with the flushes.
 */

/** Whether this bundle is a perf build. Inlined by Expo at bundle time. */
export const PERF_ENABLED = process.env.EXPO_PUBLIC_WAVE_PERF === "1";

/** The app commit a perf build was made from, when the build said (`EXPO_PUBLIC_WAVE_COMMIT`). */
const COMMIT = process.env.EXPO_PUBLIC_WAVE_COMMIT ?? null;

type MetaSource = () => PerfMeta | Promise<PerfMeta>;

const recorder = PERF_ENABLED ? createPerfRecorder({ now: () => performance.now() }) : null;
const metaSources = new Map<string, { source: MetaSource; once: boolean }>();

const noop = (): void => {};

/** A timing mark named [name] (dot-separated, `area.event`), with an optional [detail]. */
export const perfMark: (name: string, detail?: string) => void =
  recorder === null ? noop : (name, detail) => recorder.mark(name, detail);

/** Counts a render of [component]. Call it unconditionally, at the top of the component. */
export const useRenderCount: (component: string) => void =
  recorder === null ? noop : (component) => recorder.render(component);

/** A platform timing (long task, event timing), from the observers `PerfProbe` starts. */
export const perfTiming: (entry: PerfTiming) => void =
  recorder === null ? noop : (entry) => recorder.timing(entry);

/** Records a touch with its native timestamp: the root view's `onTouchStart` in a perf build. */
export const perfTouch: (event: GestureResponderEvent) => void =
  recorder === null ? noop : (event) => recorder.touch(event.nativeEvent.timestamp);

const useVisibleMark = (name: string): void => {
  useEffect(() => {
    requestAnimationFrame(() => perfMark("visible", name));
  }, [name]);
};

/** Marks `visible` with [name] on the first frame after the component mounts. */
export const usePerfVisible: (name: string) => void = recorder === null ? noop : useVisibleMark;

/**
 * Adds [source]'s values, prefixed with [name], to each flush's metadata (an
 * import's progress), or, with [once], to the first flush only (the Library's
 * size, read once per launch). Read at flush time, outside measured windows.
 */
export const registerPerfMeta: (name: string, source: MetaSource, once?: boolean) => void =
  recorder === null
    ? noop
    : (name, source, once = false) => void metaSources.set(name, { source, once });

/** Startup timings React Native keeps (`performance.rnStartupTiming`), when it has them. */
const startupMeta = (): PerfMeta => {
  const timing = (performance as { rnStartupTiming?: Record<string, unknown> }).rnStartupTiming;
  if (timing === undefined) return {};
  const meta: Record<string, number> = {};
  for (const key of [
    "startTime",
    "initializeRuntimeStart",
    "executeJavaScriptBundleEntryPointStart",
    "endTime",
  ]) {
    const value = timing[key];
    if (typeof value === "number") meta[`startup.${key}`] = Math.round(value * 100) / 100;
  }
  return meta;
};

const heapMeta = (): PerfMeta => {
  const used = (performance as { memory?: { usedJSHeapSize?: unknown } }).memory?.usedJSHeapSize;
  return typeof used === "number" ? { "js.heapUsed": used } : {};
};

let flushed = false;

const collectMeta = async (): Promise<PerfMeta> => {
  const meta: Record<string, string | number | boolean | null> = {
    perfBuild: true,
    commit: COMMIT,
    ...startupMeta(),
    ...heapMeta(),
  };
  for (const [name, { source, once }] of metaSources) {
    if (once && flushed) continue;
    try {
      for (const [key, value] of Object.entries(await source())) meta[`${name}.${key}`] = value;
    } catch (error) {
      meta[`${name}.error`] = String(error);
    }
  }
  return meta;
};

let flushing = false;

const flushIfDue = async (): Promise<void> => {
  if (recorder === null || flushing || !recorder.dueForFlush()) return;
  flushing = true;
  try {
    const meta = await collectMeta();
    // A touch while the metadata was read opened a window: wait for the next quiet time.
    if (!recorder.dueForFlush()) return;
    flushed = true;
    // console.log reaches logcat (tag ReactNativeJS) in release builds too.
    for (const line of recorder.drain(meta)) console.log(line);
  } finally {
    flushing = false;
  }
};

/** How often a perf build checks whether it's due to flush. */
const FLUSH_CHECK_MS = 500;

/** Starts the perf build's flushes; returns the stop. A no-op outside perf builds. */
export const startPerfFlushes: () => () => void =
  recorder === null
    ? () => noop
    : () => {
        const timer = setInterval(() => void flushIfDue(), FLUSH_CHECK_MS);
        return () => clearInterval(timer);
      };
