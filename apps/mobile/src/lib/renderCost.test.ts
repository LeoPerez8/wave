import assert from "node:assert/strict";
import { test } from "node:test";
import {
  Activity,
  createElement,
  Fragment,
  type ComponentProps,
  type ComponentType,
  type ReactNode,
} from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { loadWithStubs, nativeStubs, stubModule } from "../perf/renderHarness.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const SPANS_KEY = "__waveRenderSpans";
const spans = (): string[] =>
  ((globalThis as unknown as Record<string, string[]>)[SPANS_KEY] ??= []);
const DURATIONS_KEY = "__waveRenderDurations";
/** Each reported span's name and length, as the block log gets them. */
const durations = (): [string, number][] =>
  ((globalThis as unknown as Record<string, [string, number][]>)[DURATIONS_KEY] ??= []);

const [{ RenderCost, useOwnRenderCost, useRenderCost }] = await loadWithStubs<
  [typeof import("./renderCost.tsx")]
>([import.meta.resolve("./renderCost.tsx")], {
  ...nativeStubs(),
  "./backgroundWork": stubModule(`
      export const renderRan = (name, _from, ms) => {
        (globalThis.${SPANS_KEY} ??= []).push(name);
        (globalThis.${DURATIONS_KEY} ??= []).push([name, ms]);
      };
      export const shownAgain = (name) => (globalThis.${SPANS_KEY} ??= []).push("shown again " + name);
    `),
  "@/perf/perf": stubModule(`
      export const PERF_ENABLED = false;
      export const perfCommitCount = () => {};
      export const perfMark = () => {};
    `),
  "./timing": stubModule(`export const timingRoute = () => null;`),
});

function Measured() {
  useRenderCost("Home");
  return createElement("text", null, "Home");
}

const measured = createElement(Measured);
const shell = (mode: "visible" | "hidden", children: ReactNode = measured) =>
  createElement(Activity, { mode } as ComponentProps<typeof Activity>, children);

test("a render is reported once, from its own commit", async () => {
  spans().length = 0;
  let renderer: ReactTestRenderer | undefined;
  await act(() => {
    renderer = create(shell("visible"));
  });
  try {
    assert.deepEqual(spans(), ["Home"]);
    await act(() => renderer!.update(shell("visible", createElement(Measured))));
    assert.deepEqual(spans(), ["Home", "Home"], "a new render reports again");
  } finally {
    await act(() => renderer?.unmount());
  }
});

test("a hidden screen shown again without rendering reports no span", async () => {
  spans().length = 0;
  let renderer: ReactTestRenderer | undefined;
  await act(() => {
    renderer = create(shell("visible"));
  });
  try {
    spans().length = 0;
    // The same element: React shows it again without rendering it, but re-runs its layout effects.
    await act(() => renderer!.update(shell("hidden")));
    await act(() => renderer!.update(shell("visible")));
    assert.deepEqual(spans(), []);
  } finally {
    await act(() => renderer?.unmount());
  }
});

test("a timed screen shown again without rendering reports that it showed again (#1490)", async () => {
  spans().length = 0;
  const screen = createElement(
    RenderCost as ComponentType<{ name: string }>,
    { name: "tab:playlists" },
    createElement("text", null, "Playlists"),
  );
  let renderer: ReactTestRenderer | undefined;
  await act(() => {
    renderer = create(shell("visible", screen));
  });
  try {
    assert.deepEqual(spans(), ["tab:playlists"]);
    await act(() => renderer!.update(shell("hidden", screen)));
    await act(() => renderer!.update(shell("visible", screen)));
    assert.deepEqual(spans(), ["tab:playlists", "shown again tab:playlists"]);
  } finally {
    await act(() => renderer?.unmount());
  }
});

/** A clock the test moves by hand: each component below spends what it says. */
const clock = { now: 0 };
const realNow = performance.now.bind(performance);
const spend = (ms: number) => {
  clock.now += ms;
};

function Chrome({ label }: { label: string }) {
  const renderEnd = useOwnRenderCost("MiniPlayer");
  spend(3);
  return createElement(Fragment, null, createElement("text", null, label), renderEnd);
}

/** A sibling after the chrome in the tree, rendering in the same commit (Now Playing following the song). */
function Following({ label }: { label: string }) {
  spend(200);
  return createElement("text", null, label);
}

test("an own render cost ends where its subtree's render does, not at the commit (#1533)", async () => {
  durations().length = 0;
  performance.now = () => clock.now;
  const tree = (label: string) =>
    createElement(
      "view",
      null,
      createElement(Chrome, { label }),
      createElement(Following, { label }),
    );
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(() => {
      renderer = create(tree("first"));
    });
    durations().length = 0;
    await act(() => renderer!.update(tree("second")));
    assert.deepEqual(durations(), [["MiniPlayer", 3]]);
  } finally {
    performance.now = realNow;
    await act(() => renderer?.unmount());
  }
});

function Memoized() {
  const renderEnd = useOwnRenderCost("Memoized");
  spend(2);
  return createElement(Fragment, null, createElement("text", null, "same"), renderEnd);
}

test("an own render cost reports each of its renders once, and none when it didn't render", async () => {
  durations().length = 0;
  performance.now = () => clock.now;
  const memoized = createElement(Memoized);
  let renderer: ReactTestRenderer | undefined;
  try {
    await act(() => {
      renderer = create(createElement("view", null, memoized));
    });
    assert.deepEqual(durations(), [["Memoized", 2]]);
    // The same element: React doesn't render it again, so nothing is reported.
    await act(() => renderer!.update(createElement("view", null, memoized, "more")));
    assert.deepEqual(durations(), [["Memoized", 2]]);
  } finally {
    performance.now = realNow;
    await act(() => renderer?.unmount());
  }
});
