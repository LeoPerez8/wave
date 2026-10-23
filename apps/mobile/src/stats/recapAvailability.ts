import type { RecapPeriod } from "@wave/core";

export interface RecapHistoryVersion {
  readonly get: () => number;
  readonly subscribe: (changed: () => void) => () => void;
}
export interface RecapAvailability {
  readonly get: () => readonly RecapPeriod[] | undefined;
  readonly attach: (
    active: boolean,
    changed: () => void,
  ) => {
    readonly setActive: (active: boolean) => void;
    readonly detach: () => void;
  };
  /** Foreground, clock/timezone check, or explicit retry; never starts work while hidden. */
  readonly check: () => void;
}

/** Shared retained availability; only visible, settled consumers acquire refresh work. */
export const shareRecapAvailability = (options: {
  readonly version: RecapHistoryVersion;
  readonly read: (now: number, signal: AbortSignal) => Promise<readonly RecapPeriod[]>;
  readonly schedule: (ms: number, run: () => void) => () => void;
  readonly now?: () => number;
  readonly monotonic?: () => number;
  readonly zone?: () => string;
}): RecapAvailability => {
  const now = options.now ?? Date.now;
  const monotonic = options.monotonic ?? (() => performance.now());
  const zone = options.zone ?? (() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  const clients = new Set<{ active: boolean; changed: () => void }>();
  let value: readonly RecapPeriod[] | undefined;
  let cachedFor: string | undefined;
  let wanted: string;
  let clockVersion = 0;
  let wall = now();
  let mono = monotonic();
  let running: { key: string; abort: AbortController } | undefined;
  let cancelStart: (() => void) | undefined;
  let cancelClock: (() => void) | undefined;
  let stopVersion: (() => void) | undefined;
  let failedFor: string | undefined;
  const active = () => [...clients].some((client) => client.active);
  const key = (): string => {
    const at = now();
    const tick = monotonic();
    if (Math.abs(at - wall - (tick - mono)) > 2000) clockVersion++;
    wall = at;
    mono = tick;
    const date = new Date(at);
    return `${options.version.get()}/${date.getFullYear()}/${date.getMonth()}/${date.getTimezoneOffset()}/${zone()}/${clockVersion}`;
  };
  wanted = key();
  const same = (next: readonly RecapPeriod[]) =>
    value !== undefined &&
    value.length === next.length &&
    value.every(
      (period, i) =>
        period.kind === next[i]!.kind &&
        period.year === next[i]!.year &&
        (period.kind !== "month" || (next[i]!.kind === "month" && period.month === next[i]!.month)),
    );

  const update = (): void => {
    if (!active()) {
      running?.abort.abort();
      cancelStart?.();
      cancelStart = undefined;
      cancelClock?.();
      cancelClock = undefined;
      return;
    }
    wanted = key();
    if (running !== undefined && running.key !== wanted) running.abort.abort();
    if (cancelClock === undefined) {
      const date = new Date(now());
      const boundary = new Date(date.getFullYear(), date.getMonth() + 1, 1).getTime();
      cancelClock = options.schedule(Math.max(1, Math.min(30_000, boundary - now())), () => {
        cancelClock = undefined;
        failedFor = undefined;
        update();
      });
    }
    if (
      running !== undefined ||
      cancelStart !== undefined ||
      cachedFor === wanted ||
      failedFor === wanted
    )
      return;
    cancelStart = options.schedule(0, () => {
      cancelStart = undefined;
      if (!active()) return;
      const entry = { key: wanted, abort: new AbortController() };
      running = entry;
      // The reader waits for a cancellable free turn before every bounded SQL/CPU stage.
      Promise.resolve()
        .then(() => options.read(now(), entry.abort.signal))
        .then(
          (next) => {
            if (entry.abort.signal.aborted || !active()) return;
            wanted = key();
            if (entry.key !== wanted) return;
            cachedFor = entry.key;
            failedFor = undefined;
            if (!same(next)) {
              value = next;
              for (const client of clients) client.changed();
            }
          },
          () => {
            if (!entry.abort.signal.aborted) failedFor = entry.key;
          },
        )
        .finally(() => {
          if (running === entry) running = undefined;
          update();
        });
    });
  };
  return {
    get: () => value,
    check: () => {
      failedFor = undefined;
      update();
    },
    attach: (initiallyActive, changed) => {
      const client = { active: initiallyActive, changed };
      clients.add(client);
      stopVersion ??= options.version.subscribe(() => {
        failedFor = undefined;
        update();
      });
      failedFor = undefined;
      update();
      return {
        setActive: (visible) => {
          if (client.active === visible) return;
          client.active = visible;
          failedFor = undefined;
          update();
        },
        detach: () => {
          clients.delete(client);
          if (clients.size === 0) {
            stopVersion?.();
            stopVersion = undefined;
          }
          update();
        },
      };
    },
  };
};

/** Bind the real sight/settlement/activity sources synchronously, without waiting for a React commit. */
export const observeRecapAvailability = (
  cache: RecapAvailability,
  ready: { readonly get: () => boolean; readonly subscribe: (changed: () => void) => () => void },
  changed: () => void,
): (() => void) => {
  const client = cache.attach(ready.get(), changed);
  const update = () => {
    client.setActive(ready.get());
    cache.check();
  };
  const stop = ready.subscribe(update);
  update();
  return () => {
    stop();
    client.detach();
  };
};
