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
 *
 * Perf builds also mark each `useRenderCost` span as `render.span` ("<name> <ms>"), so a run
 * reads a render's span even when no long task named it (#1533).
 */
import {
  Profiler,
  useLayoutEffect,
  useRef,
  type ProfilerOnRenderCallback,
  type RefObject,
  type ReactElement,
  type ReactNode,
} from "react";

import { perfCommitCount, perfMark, PERF_ENABLED } from "@/perf/perf";
import { renderRan, shownAgain } from "./backgroundWork";
import { timingRoute } from "./timing";

/**
 * Notes [name]'s render for the JS block log: from this call, made first thing in the
 * component, to its commit's layout effects, which run after its children's. Only a commit
 * that came from a new render reports: React re-runs layout effects when a frozen or hidden
 * screen shows again without rendering, and a span from an older render (or one started
 * before the previous commit) would name the wrong work.
 */
export function useRenderCost(name: string): void {
  "use no memo";
  useCommitSpans(name, null, null);
}

/**
 * `useRenderCost` for chrome that renders in the same commit as larger work after it in the tree
 * (#1533): [name]'s span ends when its own subtree has rendered, so what React renders after it
 * (the closed Now Playing following a new song, a theme change's screens) and the commit aren't
 * put down to it. Place the returned element last in what the component returns.
 */
export function useOwnRenderCost(name: string): ReactElement {
  "use no memo";
  const endedAt = useRef<number | null>(null);
  useCommitSpans(name, null, endedAt);
  // A new element each render, so React renders it after the rest of the subtree.
  return <RenderEnd atRef={endedAt} />;
}

/** `useOwnRenderCost`'s last child: its render says the subtree before it has rendered. */
function RenderEnd({ atRef }: { atRef: RefObject<number | null> }): null {
  "use no memo";
  // oxlint-disable-next-line react/purity, react/refs -- the subtree's end is what this measures.
  atRef.current = performance.now();
  return null;
}

/**
 * `useRenderCost`'s spans; with [showStartRef], set by `ShowStart` first thing in the commit's layout
 * effects, a commit that showed a frozen or hidden screen again without rendering it reports
 * that span too (#1490): React re-runs every layout effect under it, which can hold the thread
 * longer than a render.
 */
function useCommitSpans(
  name: string,
  showStartRef: RefObject<number | null> | null,
  endRef: RefObject<number | null> | null,
): void {
  "use no memo";
  const startedAt = useRef<number | null>(null);
  const committedAt = useRef(Number.NEGATIVE_INFINITY);
  // oxlint-disable-next-line react/purity, react/refs -- the render's start is what this hook measures.
  startedAt.current = performance.now();
  useLayoutEffect(() => {
    const now = performance.now();
    const from = startedAt.current;
    const previous = committedAt.current;
    const shownFrom = showStartRef?.current ?? null;
    // An own span ends where its subtree's render did (`useOwnRenderCost`); else at this commit.
    const endedAt = endRef?.current ?? null;
    startedAt.current = null;
    committedAt.current = now;
    if (showStartRef !== null) showStartRef.current = null;
    if (endRef !== null) endRef.current = null;
    if (from !== null && from >= previous) {
      const to = endedAt !== null && endedAt >= from ? endedAt : now;
      renderRan(name, from, to - from);
      if (PERF_ENABLED) perfMark("render.span", `${name} ${round(to - from)}`);
    } else if (from === null && shownFrom !== null) shownAgain(name, shownFrom, now - shownFrom);
  });
}

/**
 * `RenderCost`'s first child: its layout effect runs before those of the rest of the screen, so
 * it says when a screen shown again began re-running them.
 */
function ShowStart({ atRef }: { atRef: RefObject<number | null> }): null {
  "use no memo";
  useLayoutEffect(() => {
    atRef.current = performance.now();
  });
  return null;
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
 * a tab switch), or when it shows again from frozen without rendering (#1490): `useRenderCost`
 * and, in perf profiler builds, `<PerfProfiler>`.
 */
export function RenderCost({ name, children }: { name: string; children: ReactNode }) {
  "use no memo";
  const showStartRef = useRef<number | null>(null);
  useCommitSpans(name, showStartRef, null);
  return (
    <PerfProfiler id={name}>
      <ShowStart atRef={showStartRef} />
      {children}
    </PerfProfiler>
  );
}

/** A stack's `screenLayout`: each screen's render cost under its route's name. */
export const screenCostLayout = ({
  route,
  children,
}: {
  route: { name: string };
  children: ReactElement;
}): ReactElement => <RenderCost name={route.name}>{children}</RenderCost>;
