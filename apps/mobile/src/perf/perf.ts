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

/**
 * Counts a call a gesture made to JavaScript ([name] like `scrub.move`): how
 * much the gesture asks of the JS thread. Reported with the render counts, as
 * `js:<name>`.
 */
export const perfCount: (name: string) => void =
  recorder === null ? noop : (name) => recorder.render(`js:${name}`);

/** A platform timing (long task, event timing), from the observers `PerfProbe` starts. */
export const perfTiming: (entry: PerfTiming) => void =
  recorder === null ? noop : (entry) => recorder.timing(entry);

/**
 * A controlled JavaScript stall, for checking what keeps moving while the JS
 * thread is busy: a perf build bundled with `EXPO_PUBLIC_WAVE_PERF_STALL_MS`
 * blocks the JS thread that long on every touch. 0 (no stall) otherwise.
 */
const STALL_MS = PERF_ENABLED
  ? Math.max(0, Number(process.env.EXPO_PUBLIC_WAVE_PERF_STALL_MS ?? 0) || 0)
  : 0;

const stall = (): void => {
  const until = performance.now() + STALL_MS;
  while (performance.now() < until) {
    // Busy on purpose: the stall stands in for an import's JavaScript work.
  }
};

/**
 * Records a touch with its native timestamp: the root view's `onTouchStart` in
 * a perf build. A stall build then blocks the JS thread (`STALL_MS`).
 */
export const perfTouch: (event: GestureResponderEvent) => void =
  recorder === null
    ? noop
    : (event) => {
        recorder.touch(event.nativeEvent.timestamp);
        if (STALL_MS > 0) stall();
      };

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
    stallMs: STALL_MS,
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

/** Whether the app is in front, and its changes (React Native's AppState, in the app). */
export interface PerfAppActivity {
  readonly active: () => boolean;
  /** Calls [listener] with each change; returns the stop. */
  readonly onChange: (listener: (active: boolean) => void) => () => void;
}

/**
 * Starts the perf build's flushes; returns the stop. A no-op outside perf builds.
 *
 * While the app is away (in the background, the screen off) the flush check
 * stops, so the perf build adds no wake-up of its own to a screen-off soak,
 * and renders count as `away:` (Core's `PERF_AWAY_PREFIX`). The window's flush
 * comes once the app is back and quiet. Marks `app.away` and `app.active`.
 */
export const startPerfFlushes: (app: PerfAppActivity) => () => void =
  recorder === null
    ? () => noop
    : (app) => {
        let timer: ReturnType<typeof setInterval> | null = null;
        const stopChecks = (): void => {
          if (timer !== null) clearInterval(timer);
          timer = null;
        };
        const follow = (active: boolean): void => {
          recorder.away(!active);
          if (!active) stopChecks();
          else timer ??= setInterval(() => void flushIfDue(), FLUSH_CHECK_MS);
        };
        let active = app.active();
        follow(active);
        const stopFollowing = app.onChange((now) => {
          if (now === active) return;
          active = now;
          perfMark(now ? "app.active" : "app.away");
          follow(now);
        });
        return () => {
          stopFollowing();
          stopChecks();
          recorder.away(false);
        };
      };
