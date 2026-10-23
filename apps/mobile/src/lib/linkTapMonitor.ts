import { lostTapLine, type LostLinkTap, type LostTapReason } from "@wave/core";

/** One deadline per tap: superseding timing measurements must not swallow lost links. */
export const createLinkTapMonitor = <Timer>(ports: {
  readonly later: (callback: () => void, ms: number) => Timer;
  readonly cancel: (timer: Timer) => void;
  readonly lost: (line: string) => void;
}) => {
  const pending = new Map<number, { tap: LostLinkTap; timer: Timer }>();
  return {
    begin: (id: number, tap: Omit<LostLinkTap, "reason">): void => {
      const timer = ports.later(() => {
        const entry = pending.get(id);
        if (entry === undefined) return;
        pending.delete(id);
        ports.lost(lostTapLine(entry.tap));
      }, 1000);
      pending.set(id, { tap: { ...tap, reason: "unknown" }, timer });
    },
    navigated: (id: number): void => {
      const entry = pending.get(id);
      if (entry === undefined) return;
      ports.cancel(entry.timer);
      pending.delete(id);
    },
    reason: (id: number, reason: LostTapReason): void => {
      const entry = pending.get(id);
      if (entry !== undefined) entry.tap = { ...entry.tap, reason };
    },
    closeTakenOver: (source: "Back" | "chevron" | "card"): void => {
      for (const entry of pending.values())
        if (entry.tap.reason === "unknown")
          entry.tap = { ...entry.tap, reason: `close taken over by ${source}` };
    },
  };
};
