/**
 * Where JS that Wave's named work didn't start comes in (#1531), for the JS block log: before
 * this, a block with no slice, work, startup step or timed render around it logged as "no
 * background work". Each way into the JS thread that JS can see reports how long it held it:
 *
 * - a timer's, an interval's or a frame callback's run ("running a timer", "running a frame
 *   callback");
 * - Effect's turns, which it takes through `setImmediate` ("running Effect work");
 * - a native event, through React Native's emitter (the network's answers, the keyboard, app
 *   state) or an Expo module's listeners ("handling native event onJobsChanged");
 * - React's commits and effect runs, as the moments they ended, from the hook
 *   `reactCommitHook.js` gives React's renderer before it loads.
 *
 * Core's block log (`createJsBlockLog`) weighs them when nothing named held the block. A block
 * still unseen is a native module's answer (a promise or callback) or garbage collection.
 *
 * `installJsEntries` wraps the globals first thing (index.ts), before modules add their
 * listeners; it times nothing until the block log listens (`sendTo`), and a run under a
 * millisecond reports nothing.
 */

/** Where the entries go: Core's block log (`lib/backgroundWork.ts`). */
export interface JsEntrySink {
  readonly entryRan: (name: string, startedAt: number, durationMs: number) => void;
  readonly committed: (at: number) => void;
  readonly effectsRan: (at: number) => void;
}

type Listener = (this: unknown, ...args: unknown[]) => unknown;

/** Expo's native module emitter class: native calls the listeners it was given straight. */
interface ExpoEmitterClass {
  readonly prototype: {
    addListener: (this: unknown, name: string, listener: Listener) => unknown;
    removeListener: (this: unknown, name: string, listener: Listener) => unknown;
  };
}

export interface JsEntryTargets {
  /** The runtime's globals: its timers, `setImmediate`, and `__waveReactCommits`. */
  readonly scope: Record<string, unknown>;
  /** React Native's `RCTDeviceEventEmitter`, which native events reach JS through. */
  readonly deviceEvents?: { emit: (name: string, ...args: unknown[]) => unknown } | null;
  readonly expoEmitter?: ExpoEmitterClass | null;
  readonly now: () => number;
}

/** A run shorter than this can't explain a 50 ms block, so it isn't reported. */
const ENTRY_MIN_MS = 1;

const TIMER = "running a timer";
const FRAME = "running a frame callback";
const EFFECT_WORK = "running Effect work";
// not UI text: the app log's block line
const nativeEvent = (name: string): string => `handling native event ${name}`;

/** What `reactCommitHook.js` puts on the global object. */
interface ReactCommitListeners {
  committed: (() => void) | null;
  effectsRan: (() => void) | null;
}

/** Wraps [targets]' ways in; returns the call that starts sending their runs to a sink. */
export const installJsEntries = ({
  scope,
  deviceEvents,
  expoEmitter,
  now,
}: JsEntryTargets): ((sink: JsEntrySink) => void) => {
  let sink: JsEntrySink | null = null;

  /** Runs [run] with [self] and [args], reporting it as [name] when the block log listens. */
  const timed = <A>(name: string, self: unknown, args: readonly unknown[], run: Listener): A => {
    const to = sink;
    if (to === null) return run.apply(self, args as unknown[]) as A;
    const startedAt = now();
    try {
      return run.apply(self, args as unknown[]) as A;
    } finally {
      const durationMs = now() - startedAt;
      if (durationMs >= ENTRY_MIN_MS) to.entryRan(name, startedAt, durationMs);
    }
  };

  /** Replaces [key]'s scheduling function so each callback it runs is timed as [name]. */
  const wrapScheduler = (key: string, name: string): void => {
    const schedule = scope[key];
    if (typeof schedule !== "function") return;
    scope[key] = function (this: unknown, run: unknown, ...rest: unknown[]) {
      const callback =
        typeof run === "function"
          ? function (this: unknown, ...args: unknown[]) {
              return timed(name, this, args, run as Listener);
            }
          : run;
      return (schedule as Listener).call(this, callback, ...rest);
    };
  };
  wrapScheduler("setTimeout", TIMER);
  wrapScheduler("setInterval", TIMER);
  wrapScheduler("requestAnimationFrame", FRAME);
  wrapScheduler("setImmediate", EFFECT_WORK);

  if (deviceEvents != null) {
    const emit = deviceEvents.emit as Listener;
    deviceEvents.emit = function (this: unknown, name: string, ...args: unknown[]) {
      return timed(nativeEvent(name), this, [name, ...args], emit);
    };
  }

  if (expoEmitter != null) {
    const proto = expoEmitter.prototype;
    const add = proto.addListener;
    const remove = proto.removeListener;
    /** Each listener's timed stand-in, by event, so removing the listener removes it. */
    const standIns = new WeakMap<Listener, Map<string, Listener>>();
    proto.addListener = function (this: unknown, name: string, listener: Listener) {
      if (typeof listener !== "function") return add.call(this, name, listener);
      let byName = standIns.get(listener);
      if (byName === undefined) standIns.set(listener, (byName = new Map()));
      let standIn = byName.get(name);
      if (standIn === undefined) {
        standIn = function (this: unknown, ...args: unknown[]) {
          return timed(nativeEvent(name), this, args, listener);
        };
        byName.set(name, standIn);
      }
      return add.call(this, name, standIn);
    };
    proto.removeListener = function (this: unknown, name: string, listener: Listener) {
      return remove.call(this, name, standIns.get(listener)?.get(name) ?? listener);
    };
  }

  return (to) => {
    sink = to;
    const commits = scope.__waveReactCommits as ReactCommitListeners | undefined;
    if (commits === undefined) return;
    commits.committed = () => to.committed(now());
    commits.effectsRan = () => to.effectsRan(now());
  };
};
