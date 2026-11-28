import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { installJsEntries, type JsEntrySink } from "./jsEntries.ts";

type Callback = (...args: unknown[]) => unknown;

/** A runtime's globals and emitters, run by hand on a clock the callbacks move. */
const fakeRuntime = () => {
  let clock = 0;
  const queued: Callback[] = [];
  const queue = (run: Callback, _ms?: number, ...args: unknown[]) => {
    queued.push(() => run(...args));
    return queued.length;
  };
  const scope: Record<string, unknown> = {
    setTimeout: queue,
    setInterval: queue,
    requestAnimationFrame: queue,
    setImmediate: queue,
  };
  const deviceListeners: Record<string, Callback[]> = {};
  const deviceEvents = {
    emit(name: string, ...args: unknown[]) {
      for (const listener of deviceListeners[name] ?? []) listener(...args);
    },
  };
  /** Expo's emitter: native calls the listeners it was given straight, with no `emit`. */
  class ExpoEmitter {
    listeners = new Map<string, Callback[]>();
    addListener(name: string, listener: Callback) {
      this.listeners.set(name, [...(this.listeners.get(name) ?? []), listener]);
      return { remove: () => this.removeListener(name, listener) };
    }
    removeListener(name: string, listener: Callback) {
      this.listeners.set(
        name,
        (this.listeners.get(name) ?? []).filter((kept) => kept !== listener),
      );
    }
    nativeEmits(name: string, ...args: unknown[]) {
      for (const listener of this.listeners.get(name) ?? []) listener.call(this, ...args);
    }
  }
  const spans: string[] = [];
  const marks: string[] = [];
  const sink: JsEntrySink = {
    entryRan: (name, startedAt, durationMs) => spans.push(`${name} ${startedAt}+${durationMs}`),
    committed: (at) => marks.push(`committed ${at}`),
    effectsRan: (at) => marks.push(`effects ran ${at}`),
  };
  const sendTo = installJsEntries({
    scope,
    deviceEvents,
    expoEmitter: ExpoEmitter,
    now: () => clock,
  });
  return {
    scope,
    sink,
    sendTo,
    spans,
    marks,
    deviceEvents,
    deviceListeners,
    ExpoEmitter,
    /** Moves the clock, as work on the thread does. */
    spend: (ms: number) => {
      clock += ms;
    },
    runQueued: () => {
      for (const run of queued.splice(0)) run();
    },
  };
};

describe("JS that Wave's named work didn't start says what it was, for the block log (#1531)", () => {
  test("a timer's callback reports how long it held the thread", () => {
    const runtime = fakeRuntime();
    runtime.sendTo(runtime.sink);
    runtime.spend(100);
    (runtime.scope.setTimeout as Callback)(() => runtime.spend(80), 0);
    runtime.runQueued();
    assert.deepEqual(runtime.spans, ["running a timer 100+80"]);
  });

  test("intervals, frame callbacks and Effect's turns (setImmediate) each say theirs", () => {
    const runtime = fakeRuntime();
    runtime.sendTo(runtime.sink);
    (runtime.scope.setInterval as Callback)(() => runtime.spend(5), 100);
    (runtime.scope.requestAnimationFrame as Callback)(() => runtime.spend(6));
    (runtime.scope.setImmediate as Callback)(() => runtime.spend(7));
    runtime.runQueued();
    assert.deepEqual(runtime.spans, [
      "running a timer 0+5",
      "running a frame callback 5+6",
      "running Effect work 11+7",
    ]);
  });

  test("a callback under a millisecond reports nothing", () => {
    const runtime = fakeRuntime();
    runtime.sendTo(runtime.sink);
    (runtime.scope.setTimeout as Callback)(() => runtime.spend(0.5), 0);
    runtime.runQueued();
    assert.deepEqual(runtime.spans, []);
  });

  test("a callback still runs, with its arguments, before the block log listens", () => {
    const runtime = fakeRuntime();
    const got: unknown[] = [];
    const queue = runtime.scope.setTimeout as Callback;
    queue(
      (...args: unknown[]) => {
        got.push(...args);
        runtime.spend(80);
      },
      0,
      "a",
      "b",
    );
    runtime.runQueued();
    assert.deepEqual(got, ["a", "b"]);
    assert.deepEqual(runtime.spans, []);
  });

  test("a callback that throws still reports, and the error goes on", () => {
    const runtime = fakeRuntime();
    runtime.sendTo(runtime.sink);
    (runtime.scope.setTimeout as Callback)(() => {
      runtime.spend(60);
      throw new Error("boom");
    }, 0);
    assert.throws(() => runtime.runQueued(), /boom/);
    assert.deepEqual(runtime.spans, ["running a timer 0+60"]);
  });

  test("a native event through React Native's emitter names itself", () => {
    const runtime = fakeRuntime();
    runtime.sendTo(runtime.sink);
    runtime.deviceListeners.didReceiveNetworkData = [() => runtime.spend(70)];
    runtime.deviceEvents.emit("didReceiveNetworkData", 1, "chunk");
    assert.deepEqual(runtime.spans, ["handling native event didReceiveNetworkData 0+70"]);
  });

  test("a native event an Expo module sends its listeners names itself", () => {
    const runtime = fakeRuntime();
    runtime.sendTo(runtime.sink);
    const module = new runtime.ExpoEmitter();
    const got: unknown[] = [];
    module.addListener("onJobsChanged", function (this: unknown, event: unknown) {
      got.push(this === module, event);
      runtime.spend(90);
    });
    module.nativeEmits("onJobsChanged", { jobs: 2 });
    assert.deepEqual(got, [true, { jobs: 2 }]);
    assert.deepEqual(runtime.spans, ["handling native event onJobsChanged 0+90"]);
  });

  test("an Expo listener removed by itself, or through its subscription, stops", () => {
    const runtime = fakeRuntime();
    const module = new runtime.ExpoEmitter();
    let heard = 0;
    const listener = () => heard++;
    module.addListener("onSessionChanged", listener);
    module.removeListener("onSessionChanged", listener);
    module.addListener("onSessionChanged", listener).remove();
    module.nativeEmits("onSessionChanged");
    assert.equal(heard, 0);
  });

  test("React's commits and effect runs reach the block log as moments", () => {
    const runtime = fakeRuntime();
    const commits = { committed: null, effectsRan: null } as {
      committed: (() => void) | null;
      effectsRan: (() => void) | null;
    };
    runtime.scope.__waveReactCommits = commits;
    runtime.sendTo(runtime.sink);
    runtime.spend(40);
    commits.committed?.();
    runtime.spend(10);
    commits.effectsRan?.();
    assert.deepEqual(runtime.marks, ["committed 40", "effects ran 50"]);
  });
});
