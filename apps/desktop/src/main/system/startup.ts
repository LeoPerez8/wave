/**
 * Wave's start, between the window and the services: the window is revealed once its page is
 * painted and the services are up, so the account's theme is known before it's seen. Services
 * that take too long don't keep it hidden, and services that fail are reported, so a start never
 * ends as a process nobody can see.
 */

/** How long a painted window waits for the services before it's revealed without them. */
export const START_WAIT_MS = 5_000;

export const followStart = (port: {
  /** The window's page is painted. */
  readonly painted: Promise<void>;
  /** Wave's services are up; rejects when they fail. */
  readonly services: Promise<void>;
  /** The services are up: what they know (the theme) can reach the window. */
  readonly started: () => void;
  /** The window may be seen. Called once, and never after `failed`. */
  readonly reveal: () => void;
  /** The services failed. Called once. */
  readonly failed: (error: unknown) => void;
  readonly waitMs?: number;
  /** Runs `run` in `ms`; the system's timer by default. Returns its cancel. */
  readonly after?: (ms: number, run: () => void) => () => void;
}): void => {
  const after =
    port.after ??
    ((ms, run) => {
      const timer = setTimeout(run, ms);
      return () => clearTimeout(timer);
    });
  let revealed = false;
  let failed = false;
  let stopWaiting: (() => void) | undefined;
  const settled = () => {
    stopWaiting?.();
    stopWaiting = undefined;
  };
  const reveal = () => {
    settled();
    if (revealed || failed) return;
    revealed = true;
    port.reveal();
  };
  let up = false;
  let painted = false;
  void port.services.then(
    () => {
      up = true;
      port.started();
      if (painted) reveal();
    },
    (error: unknown) => {
      failed = true;
      settled();
      port.failed(error);
    },
  );
  void port.painted.then(() => {
    painted = true;
    if (up) reveal();
    else if (!failed) stopWaiting = after(port.waitMs ?? START_WAIT_MS, reveal);
  });
};
