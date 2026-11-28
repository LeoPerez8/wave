import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { runInThisContext } from "node:vm";

// The polyfill must be in place before React's renderer loads, as Metro puts it (#1531).
const source = readFileSync(new URL("../../reactCommitHook.js", import.meta.url), "utf8");
const scope = globalThis as unknown as Record<string, unknown>;
scope.__DEV__ = false;
scope.IS_REACT_ACT_ENVIRONMENT = true;
runInThisContext(source);

type Listeners = { committed: (() => void) | null; effectsRan: (() => void) | null };
const listeners = scope.__waveReactCommits as Listeners;
const heard: string[] = [];
listeners.committed = () => heard.push("committed");
listeners.effectsRan = () => heard.push("effects ran");

const { createElement, useEffect } = await import("react");
const { act, create } = await import("react-test-renderer");

test("React's renderer tells the block log each time it commits and runs its effects", async () => {
  function Counter({ count }: { count: number }) {
    useEffect(() => {}, [count]);
    return createElement("text", null, String(count));
  }
  let root: ReturnType<typeof create> | undefined;
  await act(async () => {
    root = create(createElement(Counter, { count: 0 }));
  });
  assert.ok(heard.includes("committed"), heard.join(", "));
  assert.ok(heard.includes("effects ran"), heard.join(", "));
  heard.length = 0;
  await act(async () => root?.update(createElement(Counter, { count: 1 })));
  assert.deepEqual(heard, ["committed", "effects ran"]);
});

test("the polyfill leaves a hook that is already there alone (React DevTools in debug builds)", () => {
  const before = scope.__REACT_DEVTOOLS_GLOBAL_HOOK__;
  const ours = scope.__waveReactCommits;
  runInThisContext(source);
  assert.equal(scope.__REACT_DEVTOOLS_GLOBAL_HOOK__, before);
  assert.equal(scope.__waveReactCommits, ours);
});

test("Metro puts the polyfill before every module of a platform bundle", async () => {
  const { createRequire } = await import("node:module");
  const config = createRequire(import.meta.url)("../../metro.config.js") as {
    serializer: { getPolyfills: (options: { platform: string | null }) => string[] };
  };
  const polyfills = config.serializer.getPolyfills({ platform: "android" });
  assert.ok(polyfills.at(-1)?.endsWith("/reactCommitHook.js"), polyfills.join("\n"));
});
