/**
 * Settles the kept play totals (#1349) in the background: after a settled
 * turn, what they owe in the scheduler's slices (`LibraryStore.keptTotalsSteps`)
 * until nothing is, and again after each Library change, which may leave songs' credits owed
 * (a scan, a download, a sync pull, an import). An upgrade's history is
 * summed this way after startup, never in an opening read. Until it settles,
 * readers sum from the history and give the same totals.
 */
export interface KeptTotalsSettlerPorts {
  /** Resolves on the next turn the settler may take (settled, the JS thread free). */
  readonly turn: () => Promise<void>;
  /** Settles what's owed, in slices; true once nothing is. */
  readonly step: () => Promise<boolean>;
  readonly onChange: (listener: () => void) => () => void;
  readonly failed: (cause: unknown) => void;
}

/** Starts the settler; returns its stop. */
export const startKeptTotalsSettler = (ports: KeptTotalsSettlerPorts): (() => void) => {
  let stopped = false;
  let running = false;
  let dirty = false;
  const run = async () => {
    dirty = true;
    if (running || stopped) return;
    running = true;
    try {
      for (;;) {
        await ports.turn();
        if (stopped) return;
        dirty = false;
        const settled = await ports.step();
        if (settled && !dirty) return;
      }
    } catch (cause) {
      ports.failed(cause);
    } finally {
      running = false;
    }
  };
  const stopChanges = ports.onChange(() => void run());
  void run();
  return () => {
    stopped = true;
    stopChanges();
  };
};
