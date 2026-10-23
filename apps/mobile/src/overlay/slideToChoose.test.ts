import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import {
  cancelHeldTouch,
  heldTouchStart,
  holdTouch,
  menuTouchOwnership,
  moveHeldTouch,
  observeMenuTouchOwnership,
  onHeldTouch,
  releaseHeldTouch,
} from "../motion/heldTouchState.ts";
import { createSlideToChoose } from "./slideToChoose.ts";

// The lower option covers the Mini player; the other sits above it.
const entries = [
  { left: 24, right: 388, top: 620, bottom: 676 },
  { left: 24, right: 388, top: 676, bottom: 732 },
  undefined, // A disabled/unmeasured option has no target.
];
const start = { x: 200, y: 710 };
const upper = { x: 200, y: 640 };
const flush = () => new Promise<void>((resolve) => setImmediate(resolve));

afterEach(cancelHeldTouch);

const menu = (overrides: Partial<Parameters<typeof createSlideToChoose>[0]> = {}) => {
  const choices: number[] = [];
  const highlights: (number | undefined)[] = [];
  let ticks = 0;
  const slide = createSlideToChoose({
    start,
    slop: 8,
    measure: async () => ({ entries }),
    active: () => true,
    highlight: (index) => highlights.push(index),
    tick: () => ticks++,
    choose: (index) => choices.push(index),
    ...overrides,
  });
  return { ...slide, choices, highlights, ticks: () => ticks };
};

test("the Press held-touch stream selects upward through options without admitting player callbacks", async () => {
  const originalTouch = menuTouchOwnership.get().revision;
  const enabled: boolean[] = [];
  const stopOwner = observeMenuTouchOwnership((owner) => enabled.push(!owner.held));
  holdTouch(start);
  // This notification is synchronous, before measuring or loading the menu.
  assert.deepEqual(enabled, [true, false]);
  assert.deepEqual(heldTouchStart(), start);
  const card = menu();
  const stopTouch = onHeldTouch(card.handle);
  try {
    moveHeldTouch(upper);
    await flush();
    assert.equal(card.highlights.at(-1), 0);
    assert.equal(menuTouchOwnership.allows(originalTouch), false);
    moveHeldTouch({ x: 200, y: 690 });
    await flush();
    assert.equal(card.highlights.at(-1), 1);
    assert.equal(card.ticks(), 2);
    releaseHeldTouch({ x: 200, y: 690 });
    releaseHeldTouch({ x: 200, y: 690 });
    await flush();
    assert.deepEqual(card.choices, [1]);
    assert.equal(card.highlights.at(-1), undefined);
    assert.equal(heldTouchStart(), null);
    assert.deepEqual(enabled, [true, false, true]);
    assert.equal(menuTouchOwnership.allows(originalTouch), false);
    assert.equal(menuTouchOwnership.allows(menuTouchOwnership.get().revision), true);
  } finally {
    stopTouch();
    stopOwner();
  }
});

test("lifting without sliding or outside every option leaves the menu for a later tap", async () => {
  for (const point of [start, { x: 10, y: 640 }, { x: 200, y: 770 }]) {
    const card = menu();
    card.handle({ type: "release", point });
    await flush();
    assert.deepEqual(card.choices, []);
  }
});

test("cancel clears the held stream and invalidates moves still waiting for native measurements", async () => {
  const pending = Promise.withResolvers<{ entries: typeof entries }>();
  const card = menu({ measure: () => pending.promise });
  const stop = onHeldTouch(card.handle);
  try {
    holdTouch(start);
    moveHeldTouch(upper);
    cancelHeldTouch();
    moveHeldTouch(upper);
    releaseHeldTouch(upper);
    pending.resolve({ entries });
    await flush();
    assert.deepEqual(card.choices, []);
    assert.deepEqual(card.highlights, [undefined]);
    assert.equal(heldTouchStart(), null);
  } finally {
    stop();
  }
});

test("Back, dismissal or a follow-up card during release measurement prevents a stale action", async () => {
  const pending = Promise.withResolvers<{ entries: typeof entries }>();
  let active = true;
  const card = menu({ measure: () => pending.promise, active: () => active });
  card.handle({ type: "release", point: upper });
  active = false;
  pending.resolve({ entries });
  await flush();
  assert.deepEqual(card.choices, []);
});

test("only the latest move highlights, and a repeated release runs an action once", async () => {
  const first = Promise.withResolvers<{ entries: typeof entries }>();
  let calls = 0;
  const card = menu({
    measure: () => (++calls === 1 ? first.promise : Promise.resolve({ entries })),
  });
  card.handle({ type: "move", point: upper });
  card.handle({ type: "move", point: { x: 200, y: 690 } });
  await flush();
  first.resolve({ entries });
  await flush();
  assert.deepEqual(card.highlights, [1]);
  card.handle({ type: "release", point: upper });
  card.handle({ type: "release", point: upper });
  await flush();
  assert.deepEqual(card.choices, [0]);
});
