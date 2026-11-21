import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useStagedCount } from "./stagedCount.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const frames = () => {
  let waiting: FrameRequestCallback[] = [];
  const original = globalThis.requestAnimationFrame;
  const originalCancel = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = (callback) => waiting.push(callback);
  globalThis.cancelAnimationFrame = (id: number | null | undefined) => {
    if (id == null) return;
    waiting[id - 1] = () => {};
  };
  return {
    next: () => {
      const due = waiting;
      waiting = [];
      act(() => due.forEach((callback) => callback(0)));
    },
    pending: () => waiting.length,
    restore: () => {
      globalThis.requestAnimationFrame = original;
      globalThis.cancelAnimationFrame = originalCancel;
    },
  };
};

test("a staged page mounts its first viewport, then one stage a frame until it's whole", () => {
  const clock = frames();
  const seen: number[] = [];
  function Page({ plan }: { plan: readonly number[] }) {
    seen.push(useStagedCount(plan));
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  try {
    act(() => {
      renderer = create(createElement(Page, { plan: [3, 6, 8] }));
    });
    assert.equal(seen.at(-1), 3);
    clock.next();
    assert.equal(seen.at(-1), 6);
    clock.next();
    assert.equal(seen.at(-1), 8);
    clock.next();
    assert.equal(seen.at(-1), 8);
    assert.equal(clock.pending(), 0);
  } finally {
    act(() => renderer?.unmount());
    clock.restore();
  }
});

test("a page that grows mounts its new sections in the next frame, and never takes back what it showed", () => {
  const clock = frames();
  const seen: number[] = [];
  function Page({ plan }: { plan: readonly number[] }) {
    seen.push(useStagedCount(plan));
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  try {
    act(() => {
      renderer = create(createElement(Page, { plan: [2] }));
    });
    assert.equal(seen.at(-1), 2);
    act(() => renderer?.update(createElement(Page, { plan: [2, 5] })));
    assert.equal(seen.at(-1), 2);
    clock.next();
    assert.equal(seen.at(-1), 5);
    act(() => renderer?.update(createElement(Page, { plan: [1, 4] })));
    assert.equal(seen.at(-1), 4);
  } finally {
    act(() => renderer?.unmount());
    clock.restore();
  }
});
