/**
 * A clock that a test moves by hand. Timers fire only when the test says time passed, so a busy
 * machine can't change the order of what a test sees.
 *
 * `setImmediate` stays real: it is how `pass` waits for promises, and with node's fake one a
 * timer set from an immediate fired at once, whatever its delay (node 24.19). So a fake process
 * in a test reports with `queueMicrotask`, never `setImmediate`, or `pass` would return before
 * it did.
 */
import { afterEach, beforeEach, mock } from "node:test";

/** Ends once no promise can go on: microtasks all run before the next immediate. */
const promisesSettle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Puts every test of the file calling it on the fake clock. */
export const withFakeClock = () => {
  beforeEach(() => mock.timers.enable({ apis: ["setTimeout", "setInterval"] }));
  afterEach(() => mock.timers.reset());
};

/**
 * Moves the clock on by `ms`, one millisecond at a time. Before each step, and after the last,
 * every promise that can settle does. With no `ms`, only what was due at once runs.
 */
export const pass = async (ms = 0) => {
  await promisesSettle();
  mock.timers.tick(0);
  await promisesSettle();
  for (let passed = 0; passed < ms; passed += 1) {
    mock.timers.tick(1);
    await promisesSettle();
  }
};
