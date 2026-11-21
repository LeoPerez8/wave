/**
 * Render cost (#1423). WaveTiming's block lines name background work; a block
 * spent rendering React components named none. Two tools close that gap:
 *
 * - `useRenderCost(name)`, in every build: a screen or section notes when its
 *   render began and when its commit's layout effects ran, so a JS block over
 *   50 ms the runtime reports meanwhile logs as "by rendering <name>". Two
 *   clock reads and a layout effect per render; nothing is written unless a
 *   long task happens.
 * - `<PerfProfiler id>`, in perf builds bundled with
 *   `EXPO_PUBLIC_WAVE_PERF_PROFILER=1` (Metro then picks React's profiling
 *   renderer, since the production one never calls `onRender`): counts each
 *   commit under [id] (`commit:<id>` with the render counts) and marks every
 *   commit over 16 ms as `render.commit`, with its phase, actual and base
 *   durations and the route shown. Elsewhere it renders its children alone.
 */
import {
  Profiler,
  useLayoutEffect,
  type ProfilerOnRenderCallback,
  type ReactElement,
  type ReactNode,
} from "react";

import { perfCommitCount, perfMark, PERF_ENABLED } from "@/perf/perf";
import { renderRan } from "./backgroundWork";
import { timingRoute } from "./timing";

/**
 * Notes [name]'s render for the JS block log: from this call, made first thing in the
 * component, to its commit's layout effects, which run after its children's.
 */
export function useRenderCost(name: string): void {
  "use no memo";
  // oxlint-disable-next-line react/purity -- the render's start is what this hook measures.
  const startedAt = performance.now();
  useLayoutEffect(() => {
    renderRan(name, startedAt, performance.now() - startedAt);
  });
}

/** Whether this bundle renders with React's profiling build (perf builds only). */
export const PERF_PROFILER = PERF_ENABLED && process.env.EXPO_PUBLIC_WAVE_PERF_PROFILER === "1";

/** A commit longer than this is marked: a frame's time at 60 Hz. */
const SLOW_COMMIT_MS = 16;

const round = (ms: number): number => Math.round(ms * 10) / 10;

const onRender: ProfilerOnRenderCallback = (id, phase, actualDuration, baseDuration) => {
  perfCommitCount(id);
  if (actualDuration > SLOW_COMMIT_MS)
    perfMark(
      "render.commit",
      `${id} ${phase} actual=${round(actualDuration)} base=${round(baseDuration)} route=${timingRoute() ?? "-"}`,
    );
};

/** Perf profiler builds: React's `<Profiler>` around [children]; elsewhere [children] alone. */
export function PerfProfiler({ id, children }: { id: string; children: ReactNode }) {
  return PERF_PROFILER ? (
    <Profiler id={id} onRender={onRender}>
      {children}
    </Profiler>
  ) : (
    children
  );
}

/**
 * A screen's or section's render cost under [name], when its parent renders it (a push, a pop,
 * a tab switch): `useRenderCost` and, in perf profiler builds, `<PerfProfiler>`.
 */
export function RenderCost({ name, children }: { name: string; children: ReactNode }) {
  useRenderCost(name);
  return <PerfProfiler id={name}>{children}</PerfProfiler>;
}

/** A stack's `screenLayout`: each screen's render cost under its route's name. */
export const screenCostLayout = ({
  route,
  children,
}: {
  route: { name: string };
  children: ReactElement;
}): ReactElement => <RenderCost name={route.name}>{children}</RenderCost>;
