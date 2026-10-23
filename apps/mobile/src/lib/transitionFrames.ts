/** Clock/frame ports keep lifecycle behavior testable without a device or a resting loop. */
import { lateFrame, type TimingFrames } from "@wave/core";
import type { TimingTransition } from "./timingSession";

interface Ports {
  readonly now: () => number;
  readonly request: (callback: () => void) => number;
  readonly cancel: (id: number) => void;
  readonly intervalMs: () => number;
  readonly uiStart: (id: number, ageMs: number) => void;
  readonly uiStop: (id: number) => Promise<TimingFrames | null>;
  readonly report: (event: TimingTransition, lane: "JS" | "UI", frames: TimingFrames) => void;
  readonly observe?: () => () => void;
}

export const createTransitionFrames = (ports: Ports) => {
  let active: {
    event: TimingTransition;
    last: number;
    count: number;
    longestGapMs: number;
    frame: number;
    unobserve?: () => void;
  } | null = null;
  let disposed = false;
  const waiting = new Set<Promise<void>>();
  const sample = (at: number) => {
    if (active === null) return;
    const gap = at - active.last;
    if (lateFrame(gap, ports.intervalMs())) {
      active.count++;
    }
    active.longestGapMs = Math.max(active.longestGapMs, gap);
    active.last = at;
  };
  const tick = (expected: number) => {
    if (active?.event.id !== expected) return;
    sample(ports.now());
    active.frame = ports.request(() => tick(expected));
  };
  const stop = (event: TimingTransition) => {
    if (active?.event.id !== event.id) return;
    const settled = event.phase === "settled";
    if (settled) sample(ports.now());
    const result = active;
    active = null;
    ports.cancel(result.frame);
    result.unobserve?.();
    if (settled) ports.report(event, "JS", result);
    const task = ports
      .uiStop(event.id)
      .then((frames) => {
        if (!disposed && settled && frames !== null) ports.report(event, "UI", frames);
      })
      .catch(() => {
        // Unsupported/tearing-down native collection is unmeasured, never a fabricated zero.
      });
    waiting.add(task);
    void task.finally(() => waiting.delete(task));
  };
  return {
    transition: (event: TimingTransition) => {
      if (disposed) return;
      if (event.phase !== "start") {
        stop(event);
        return;
      }
      if (active !== null) stop({ ...active.event, phase: "cancelled" });
      ports.uiStart(event.id, Math.max(0, ports.now() - event.at));
      active = {
        event,
        last: event.at,
        count: 0,
        longestGapMs: 0,
        frame: ports.request(() => tick(event.id)),
        unobserve: ports.observe?.(),
      };
    },
    flush: async () => {
      await Promise.all(waiting);
    },
    dispose: () => {
      if (active !== null) stop({ ...active.event, phase: "cancelled" });
      disposed = true;
    },
  };
};
