import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement, useLayoutEffect } from "react";
import { act, create } from "react-test-renderer";

import { useStoreWhile } from "./storeWhile.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const counter = () => {
  let value = 0;
  const listeners = new Set<() => void>();
  return {
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    get: () => value,
    bump: () =>
      act(() => {
        value++;
        for (const listener of listeners) listener();
      }),
    listening: () => listeners.size,
  };
};

const mount = async (store: ReturnType<typeof counter>, following: boolean) => {
  let shown = -2;
  let renders = 0;
  function Reader(props: { following: boolean }) {
    renders++;
    const value = useStoreWhile(store, props.following, -1);
    useLayoutEffect(() => {
      shown = value;
    });
    return null;
  }
  let renderer: ReturnType<typeof create> | undefined;
  await act(async () => {
    renderer = create(createElement(Reader, { following }));
  });
  return {
    shown: () => shown,
    renders: () => renders,
    follow: (next: boolean) =>
      act(async () => renderer?.update(createElement(Reader, { following: next }))),
    unmount: () => act(() => renderer?.unmount()),
  };
};

test("while not following, the store's changes render nothing and it shows the idle value", async () => {
  const store = counter();
  const view = await mount(store, false);
  try {
    for (let i = 0; i < 3; i++) await store.bump();
    assert.equal(view.renders(), 1);
    assert.equal(view.shown(), -1);
    assert.equal(store.listening(), 0);
  } finally {
    await view.unmount();
  }
});

test("following again shows the store's latest value at once, and its changes from then on", async () => {
  const store = counter();
  const view = await mount(store, false);
  try {
    await store.bump();
    await store.bump();
    await view.follow(true);
    assert.equal(view.shown(), 2);
    await store.bump();
    assert.equal(view.shown(), 3);
    await view.follow(false);
    assert.equal(view.shown(), -1);
    assert.equal(store.listening(), 0);
  } finally {
    await view.unmount();
  }
});
