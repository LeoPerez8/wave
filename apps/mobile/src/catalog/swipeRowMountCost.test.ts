import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import {
  animationCounts,
  loadWithStubs,
  nativeStubs,
  resetAnimationCounts,
  stubModule,
} from "../perf/renderHarness.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const [{ SwipeableRow }] = await loadWithStubs<[typeof import("./SwipeableRow.tsx")]>(
  [import.meta.resolve("./SwipeableRow.tsx")],
  {
    ...nativeStubs(),
    "react-native-gesture-handler": stubModule(`
      export const usePanGesture = config => config;
      export const GestureDetector = ({ children }) => children;
    `),
    "react-native-worklets": stubModule(
      `export const scheduleOnRN = (fn, ...args) => fn(...args);`,
    ),
    "@/playback/actionIcons": stubModule(`
      export const ACTION_ICONS = new Proxy({}, { get: () => "ActionIcon" });
    `),
  },
);

type RowProps = Parameters<typeof SwipeableRow>[0];

const ROWS = 150;
const side = (label: string) => ({
  action: "queue" as never,
  label,
  accessibilityLabel: label,
  leaves: false,
  run: () => {},
});
const swipe = { right: side("Add to Queue"), left: side("Remove") };

const list = () =>
  createElement(
    "view",
    null,
    Array.from({ length: ROWS }, (_, i) =>
      createElement(
        SwipeableRow,
        { key: i, swipe } as unknown as RowProps,
        createElement("text", null, `Song ${i}`),
      ),
    ),
  );

const rowViews = (renderer: ReactTestRenderer) =>
  renderer.root.findAll(
    (node) => node.type === "view" && typeof node.props.onLayout === "function",
  );
const labels = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => node.type === "text" && node.props.numberOfLines === 1);

test(`mounting ${ROWS} swipeable rows leaves what a swipe uncovers until one is touched`, async () => {
  resetAnimationCounts();
  let renderer: ReactTestRenderer | undefined;
  const started = performance.now();
  await act(() => {
    renderer = create(list());
  });
  const mountMs = performance.now() - started;
  const atMount = { ...animationCounts() };
  console.log(
    `[1423] ${ROWS} swipeable rows: ${atMount.sharedValues} shared values, ${atMount.animatedStyles} animated styles, ${labels(renderer!).length} uncovered labels, mount ${mountMs.toFixed(1)} ms`,
  );
  try {
    assert.equal(labels(renderer!).length, 0, "no row draws its swipe actions before a touch");
    assert.deepEqual(atMount, { sharedValues: ROWS * 3, animatedStyles: ROWS });
    await act(() => rowViews(renderer!)[7]!.props.onTouchStart?.({ nativeEvent: {} }));
    assert.deepEqual(
      labels(renderer!).map((node) => node.props.children),
      ["Add to Queue", "Remove"],
      "the touched row is ready to swipe both ways",
    );
    assert.equal(animationCounts().animatedStyles, ROWS + 2);
  } finally {
    await act(() => renderer?.unmount());
  }
});

test("a demo swipe draws what it uncovers", async () => {
  let renderer: ReactTestRenderer | undefined;
  const row = (demo: number) =>
    createElement(
      SwipeableRow,
      { swipe, sample: true, demo } as unknown as RowProps,
      createElement("text", null, "x"),
    );
  await act(() => {
    renderer = create(row(0));
  });
  try {
    assert.equal(labels(renderer!).length, 0);
    await act(() => renderer!.update(row(1)));
    assert.equal(labels(renderer!).length, 2);
  } finally {
    await act(() => renderer?.unmount());
  }
});
