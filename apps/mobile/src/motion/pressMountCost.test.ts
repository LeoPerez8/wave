import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import {
  animationCounts,
  loadWithStubs,
  nativeStubs,
  resetAnimationCounts,
} from "../perf/renderHarness.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const [{ CardTile, CardRow }, { Press }] = await loadWithStubs<
  [typeof import("../catalog/cards/CardParts.tsx"), typeof import("./Press.tsx")]
>([import.meta.resolve("../catalog/cards/CardParts.tsx"), import.meta.resolve("./Press.tsx")], {
  ...nativeStubs(),
});

const TILES = 150;
const noop = () => {};

const shelf = () =>
  createElement(
    "view",
    null,
    Array.from({ length: TILES }, (_, i) =>
      i % 2 === 0
        ? createElement(
            CardTile,
            {
              key: i,
              width: 120,
              label: `Album ${i}`,
              onPress: noop,
              onLongPress: noop,
            } as unknown as Parameters<typeof CardTile>[0],
            createElement("text", null, `Album ${i}`),
          )
        : createElement(CardRow, {
            key: i,
            lead: null,
            title: `Artist ${i}`,
            detail: "12 songs",
            onPress: noop,
          }),
    ),
  );

const pressables = (renderer: ReactTestRenderer) =>
  renderer.root.findAll((node) => (node.type as unknown) === "pressable");

test(`mounting ${TILES} tiles and rows makes no press animation until one is touched`, async () => {
  resetAnimationCounts();
  let renderer: ReactTestRenderer | undefined;
  const started = performance.now();
  await act(() => {
    renderer = create(shelf());
  });
  const mountMs = performance.now() - started;
  const atMount = { ...animationCounts() };
  console.log(
    `[1423] ${TILES} press targets: ${atMount.sharedValues} shared values, ${atMount.animatedStyles} animated styles, mount ${mountMs.toFixed(1)} ms`,
  );
  try {
    assert.deepEqual(atMount, { sharedValues: 0, animatedStyles: 0 });
    // The responder can grant (press in) before the touch-start handler runs.
    await act(() => pressables(renderer!)[3]!.props.onPressIn?.({ nativeEvent: {} }));
    await act(() => pressables(renderer!)[3]!.props.onTouchStart?.({ nativeEvent: {} }));
    assert.deepEqual(
      { ...animationCounts() },
      { sharedValues: 2, animatedStyles: 1 },
      "only the touched target animates",
    );
    const style = [pressables(renderer!)[3]!.props.style].flat(3).at(-1) as {
      opacity: number;
    };
    assert.ok(style.opacity < 1, "the touched target dims as it is pressed");
  } finally {
    await act(() => renderer?.unmount());
  }
});

test("a press shown highlighted animates from its first frame", async () => {
  resetAnimationCounts();
  let renderer: ReactTestRenderer | undefined;
  await act(() => {
    renderer = create(
      createElement(
        Press,
        { highlighted: true, onPress: noop } as unknown as Parameters<typeof Press>[0],
        createElement("text", null, "x"),
      ),
    );
  });
  try {
    assert.deepEqual({ ...animationCounts() }, { sharedValues: 2, animatedStyles: 1 });
    const style = [pressables(renderer!)[0]!.props.style].flat(3).at(-1) as { opacity: number };
    assert.ok(style.opacity < 1, "highlighted looks pressed");
  } finally {
    await act(() => renderer?.unmount());
  }
});
