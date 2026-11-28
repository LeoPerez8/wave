import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useStagedRows } from "./stagedRows.ts";

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

const rows = (count: number): number[] => Array.from({ length: count }, (_, index) => index);

/** Renders a list's rows as the hook gives them, recording each render's count. */
const mount = (staged: boolean, data: readonly number[], windowHeight = 800) => {
  const seen: number[] = [];
  const given: (readonly number[])[] = [];
  function List({ data }: { data: readonly number[] }) {
    const shown = useStagedRows(data, staged, windowHeight);
    seen.push(shown.length);
    given.push(shown);
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(createElement(List, { data }));
  });
  return {
    seen,
    given,
    update: (next: readonly number[]) =>
      act(() => renderer!.update(createElement(List, { data: next }))),
    unmount: () => act(() => renderer!.unmount()),
  };
};

test("a pushed screen's list gets four rows in its first frame, four more a frame until a screen is there, then the rest", () => {
  const clock = frames();
  try {
    const data = rows(40);
    // 800 dp tall: 19 rows of 56 dp fill the screen and Legend List's 250 dp draw distance.
    const list = mount(true, data);
    assert.deepEqual(list.seen, [4]);
    for (let frame = 0; frame < 6; frame++) clock.next();
    assert.deepEqual(list.seen, [4, 8, 12, 16, 40]);
    assert.equal(list.given.at(-1), data, "the whole list is the data itself");
    assert.equal(clock.pending(), 0);
    list.unmount();
  } finally {
    clock.restore();
  }
});

test("a short list is whole in its first frame", () => {
  const clock = frames();
  try {
    const list = mount(true, rows(3));
    assert.deepEqual(list.seen, [3]);
    assert.equal(clock.pending(), 0);
    list.unmount();
  } finally {
    clock.restore();
  }
});

test("a list that isn't staged gets every row at once", () => {
  const clock = frames();
  try {
    const data = rows(40);
    const list = mount(false, data);
    assert.deepEqual(list.seen, [40]);
    assert.equal(list.given[0], data);
    assert.equal(clock.pending(), 0);
    list.unmount();
  } finally {
    clock.restore();
  }
});

test("rows read after the header are staged too, and a list that grows never takes a row back", () => {
  const clock = frames();
  try {
    // Opened from a list that knows the album: the header first, the tracks once read.
    const list = mount(true, []);
    assert.deepEqual(list.seen, [0]);
    list.update(rows(30));
    assert.equal(list.seen.at(-1), 4);
    for (let frame = 0; frame < 6; frame++) clock.next();
    assert.equal(list.seen.at(-1), 30);
    // YouTube Music's songs join the album: every row shown stays, the new ones follow.
    list.update(rows(45));
    assert.ok(list.seen.at(-1)! >= 30, `still ${list.seen.at(-1)} rows`);
    for (let frame = 0; frame < 6; frame++) clock.next();
    assert.equal(list.seen.at(-1), 45);
    // A song removed: the list shrinks with it.
    list.update(rows(44));
    assert.equal(list.seen.at(-1), 44);
    list.unmount();
  } finally {
    clock.restore();
  }
});
