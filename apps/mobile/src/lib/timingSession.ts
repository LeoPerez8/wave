/** Platform-free collection seam. React/native adapters supply timestamps, never log text. */
import {
  TIMING_BUDGETS,
  slowTapLine,
  slowScreenLine,
  speedSummaryLine,
  type TimingKind,
  type TimingTap,
  type TimingScreen,
} from "@wave/core";

export interface TimingTransition {
  readonly id: number;
  readonly at: number;
  readonly kind: TimingKind;
  readonly from: string;
  readonly to: string;
  readonly phase: "start" | "settled" | "cancelled";
}
interface Ports {
  readonly now: () => number;
  readonly wallNow: () => number;
  readonly write: (line: string) => void;
  readonly context: () => { readonly background: readonly string[]; readonly offline: boolean };
  readonly build: () => { readonly version: string; readonly commit: string };
}
interface Pending {
  id: number;
  kind: TimingKind;
  from: string;
  to: string;
  at: number;
  tap: boolean;
  measurement: { kind: TimingKind; responseMs?: number; firstFrameMs?: number };
  screen: boolean;
  response: number | null;
  frame: number | null;
  content: number | null;
  end: number | null;
  background: Set<string>;
  offline: boolean;
  block: number;
  reads: { operation: string; durationMs: number }[];
  missedFrames: number;
}

export const createTimingSession = (ports: Ports) => {
  let nextId = 0;
  let route = "/";
  let pending: Pending | null = null;
  let settled = false;
  let since = ports.wallNow();
  let lastSummary: number | null = null;
  let taps: TimingTap[] = [];
  let measurements: Pending["measurement"][] = [];
  let screens: TimingScreen[] = [];
  let hitches: number[] = [];
  let lostTaps = 0;
  const completedScreens = new Map<number, { missedFrames: number }>();
  const transitions = new Set<(event: TimingTransition) => void>();
  const listeners = new Set<() => void>();
  const notify = () => {
    for (const listener of listeners) listener();
  };
  const emit = (p: Pending, phase: TimingTransition["phase"]) => {
    if (!p.tap) return;
    for (const listener of transitions)
      listener({ id: p.id, at: p.at, kind: p.kind, from: p.from, to: p.to, phase });
  };
  const write = (line: string | null) => {
    if (line !== null) ports.write(line);
  };
  const context = (p: Pending) => {
    const current = ports.context();
    for (const name of current.background) p.background.add(name);
    p.offline ||= current.offline;
  };
  const finish = () => {
    const p = pending;
    if (
      p === null ||
      p.response === null ||
      p.frame === null ||
      p.content === null ||
      p.end === null
    )
      return;
    context(p);
    if (p.tap) {
      const sample: TimingTap = {
        kind: p.kind,
        from: p.from,
        to: p.to,
        responseMs: p.response - p.at,
        firstFrameMs: p.frame - p.at,
        settledMs: Math.max(p.content, p.end, p.frame) - p.at,
        background: [...p.background],
        offline: p.offline,
        longestJsBlockMs: p.block,
      };
      taps.push(sample);
      write(slowTapLine(sample));
    }
    if (p.screen) {
      const screen = {
        route: p.to,
        firstFrameMs: p.frame - p.at,
        contentMs: p.content - p.at,
        reads: p.reads,
        missedFrames: p.missedFrames,
      };
      screens.push(screen);
      completedScreens.set(p.id, screen);
      write(slowScreenLine(screen));
    }
    pending = null;
    settled = true;
    // Finalize before callbacks: a listener may navigate, or return late UI-thread frame totals.
    emit(p, "settled");
    notify();
  };
  const cancel = () => {
    if (pending !== null) emit(pending, "cancelled");
    pending = null;
    settled = false;
    notify();
  };
  const begin = (
    kind: TimingKind,
    to: string,
    at = ports.now(),
    tap = true,
    from = route,
  ): number => {
    cancel();
    const current = ports.context();
    const measurement = { kind };
    if (tap) measurements.push(measurement);
    pending = {
      id: ++nextId,
      kind,
      from,
      to,
      at,
      tap,
      measurement,
      screen: ["tab", "push", "pop", "artistLink", "albumLink", "goToArtist"].includes(kind),
      response: null,
      frame: null,
      content: null,
      end: null,
      background: new Set(current.background),
      offline: current.offline,
      block: 0,
      reads: [],
      missedFrames: 0,
    };
    emit(pending, "start");
    return pending.id;
  };
  const update = (id: number | undefined, set: (p: Pending) => void) => {
    if (pending === null || (id !== undefined && pending.id !== id)) return;
    set(pending);
    finish();
  };
  const session = {
    begin,
    cancel,
    /** [id]'s tap opened nothing: it ends unmeasured, and the screen it was made on is settled. */
    dismiss: (_id: number): void => {},
    reclassify: (kind: TimingKind, to: string): number | null => {
      if (pending === null) return null;
      pending.measurement.kind = kind;
      pending.kind = kind;
      pending.to = to;
      pending.screen = kind !== "choiceCard";
      return pending.id;
    },
    active: () =>
      pending === null ? null : { id: pending.id, kind: pending.kind, to: pending.to },
    route: () => route,
    routeCommitted: (path: string): number | null => {
      route = path;
      if (pending === null) begin("push", path, ports.now(), false);
      const p = pending!;
      if (!p.screen) return null;
      if (p.kind === "tab") {
        const target =
          p.to
            .split("?")[0]!
            .replace(/\/\([^/]+\)/g, "")
            .replace(/\/$/, "") || "/";
        if (path !== target && !(target !== "/" && path.startsWith(`${target}/`))) return null;
      }
      p.to = path;
      p.response ??= ports.now();
      p.measurement.responseMs = p.response - p.at;
      return p.id;
    },
    response: (id?: number) =>
      update(id, (p) => {
        p.response ??= ports.now();
        p.measurement.responseMs = p.response - p.at;
      }),
    frame: (id?: number) =>
      update(id, (p) => {
        p.frame ??= ports.now();
        p.measurement.firstFrameMs = p.frame - p.at;
      }),
    content: (id?: number) =>
      update(id, (p) => {
        p.content ??= ports.now();
      }),
    end: (id?: number) =>
      update(id, (p) => {
        p.end ??= ports.now();
      }),
    isSettled: () => settled,
    onSettled: (listener: () => void): (() => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    onTransition: (listener: (event: TimingTransition) => void): (() => void) => {
      transitions.add(listener);
      return () => {
        transitions.delete(listener);
      };
    },
    read: (operation: string, durationMs: number) => {
      if (pending?.screen && pending.reads.length < 50)
        pending.reads.push({ operation, durationMs });
    },
    jsBlock: (startTime: number, durationMs: number) => {
      if (pending !== null && startTime + durationMs >= pending.at)
        pending.block = Math.max(pending.block, durationMs);
    },
    backgroundChanged: () => {
      if (pending !== null) context(pending);
    },
    frames: (id: number, missed: number) => {
      if (pending?.id === id) pending.missedFrames += missed;
      else {
        const screen = completedScreens.get(id);
        if (screen !== undefined) screen.missedFrames += missed;
      }
    },
    hitch: (durationMs: number) => {
      hitches.push(durationMs);
    },
    lost: () => {
      lostTaps++;
    },
    /** A short return doesn't discard samples. Only an actual summary advances the window. */
    leave: () => {
      const now = ports.wallNow();
      if (
        measurements.length === 0 ||
        (lastSummary !== null && now - lastSummary < TIMING_BUDGETS.summaryIntervalMs)
      )
        return;
      write(
        speedSummaryLine({
          since,
          ...ports.build(),
          taps,
          measurements,
          screens,
          hitches,
          lostTaps,
        }),
      );
      lastSummary = now;
      since = now;
      taps = [];
      measurements = [];
      screens = [];
      completedScreens.clear();
      hitches = [];
      lostTaps = 0;
    },
  };
  return session;
};
