/**
 * A long-press menu waits for a native anchor measurement. This gate owns
 * that request until it opens, the press leaves, or its touch ends/cancels.
 * It never claims a responder or decides when scrolling may start.
 */
export const createLongPressIntent = () => {
  let sequence = 0;
  let phase: "idle" | "touching" | "pending" | "open" = "idle";

  const cancel = (request?: number): boolean => {
    if (request !== undefined && request !== sequence) return false;
    const active = phase !== "idle";
    phase = "idle";
    return active;
  };

  return {
    /** A new physical touch invalidates every older measurement. */
    begin: (): void => {
      sequence += 1;
      phase = "touching";
    },
    /** Called only when the platform's existing long-press timer fires. */
    request: (): number | null => {
      if (phase !== "touching") return null;
      phase = "pending";
      return sequence;
    },
    /** Atomically admits this measurement's handler, at most once. */
    open: (request: number): boolean => {
      if (phase !== "pending" || request !== sequence) return false;
      phase = "open";
      return true;
    },
    /** A menu's own async read may finish after anchor measurement. */
    allows: (request: number): boolean => phase === "open" && request === sequence,
    /** A lifted finger keeps an admitted menu; an unmeasured request expires. */
    release: (): void => {
      if (phase !== "open") cancel();
    },
    /** Leaving a pending press cancels it; leaving an open menu permits slide-to-choose. */
    leave: (): boolean => (phase === "open" ? false : cancel()),
    /** Touch cancellation/release/unmount; a stale completion can cancel only its own request. */
    cancel,
  };
};
