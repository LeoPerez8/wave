import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { COLOUR_PICKER_REST_MS, createColourPickerPreview } from "./index.ts";

/** A picker preview on a hand-driven clock; `applied` lists every recolour. */
const picker = () => {
  let time = 0;
  let timers: { at: number; done: () => void }[] = [];
  const applied: string[] = [];
  const preview = createColourPickerPreview({
    apply: (hex) => applied.push(hex),
    now: () => time,
    wait: (ms, done) => {
      const timer = { at: time + ms, done };
      timers.push(timer);
      return () => {
        timers = timers.filter((other) => other !== timer);
      };
    },
  });
  /** Moves the clock on `ms`, firing every timer that comes due. */
  const pass = (ms: number) => {
    const end = time + ms;
    for (;;) {
      const next = timers.filter((timer) => timer.at <= end).toSorted((a, b) => a.at - b.at)[0];
      if (next === undefined) break;
      timers = timers.filter((timer) => timer !== next);
      time = next.at;
      next.done();
    }
    time = end;
  };
  return { preview, applied, pass };
};

describe("createColourPickerPreview", () => {
  test("a moving finger leaves the app alone; it recolours once the finger rests", () => {
    const { preview, applied, pass } = picker();
    preview.drag("#ff0000");
    pass(16);
    preview.drag("#ee0000");
    pass(150);
    preview.drag("#dd0000");
    pass(150);
    preview.drag("#cc0000");
    pass(199);
    assert.deepEqual(applied, []);
    pass(1);
    assert.deepEqual(applied, ["#cc0000"]);
    pass(1000);
    assert.deepEqual(applied, ["#cc0000"]);
    assert.equal(COLOUR_PICKER_REST_MS, 200);
  });

  test("lifting the finger recolours at once with the colour under it, and only once", () => {
    const { preview, applied, pass } = picker();
    preview.drag("#00ff00");
    pass(50);
    preview.drag("#00ee00");
    pass(10);
    preview.lift();
    assert.deepEqual(applied, ["#00ee00"]);
    pass(1000);
    assert.deepEqual(applied, ["#00ee00"]);
  });

  test("a finger that rested and then lifts doesn't recolour twice", () => {
    const { preview, applied, pass } = picker();
    preview.drag("#0000ff");
    pass(300);
    preview.lift();
    assert.deepEqual(applied, ["#0000ff"]);
  });

  test("a typed or stepped colour recolours at once", () => {
    const { preview, applied, pass } = picker();
    preview.pick("#123456");
    assert.deepEqual(applied, ["#123456"]);
    preview.pick("#123456");
    assert.deepEqual(applied, ["#123456"]);
    preview.pick("#654321");
    pass(1000);
    assert.deepEqual(applied, ["#123456", "#654321"]);
  });

  test("a colour picked mid-drag wins over the drag's pending one", () => {
    const { preview, applied, pass } = picker();
    preview.drag("#aa0000");
    pass(100);
    preview.pick("#00aa00");
    pass(1000);
    assert.deepEqual(applied, ["#00aa00"]);
  });

  test("a closed picker never recolours, even with a rest still pending", () => {
    const { preview, applied, pass } = picker();
    preview.drag("#abcdef");
    pass(100);
    preview.stop();
    pass(1000);
    preview.drag("#fedcba");
    preview.lift();
    preview.pick("#111111");
    pass(1000);
    assert.deepEqual(applied, []);
  });

  test("each rest in a long drag recolours once", () => {
    const { preview, applied, pass } = picker();
    preview.drag("#100000");
    pass(250);
    preview.drag("#200000");
    pass(100);
    preview.drag("#300000");
    pass(250);
    assert.deepEqual(applied, ["#100000", "#300000"]);
  });

  test("a finger moving without changing the colour, past the square's edge, counts as resting", () => {
    const { preview, applied, pass } = picker();
    preview.drag("#ffffff");
    for (let step = 0; step < 15; step += 1) {
      pass(16);
      preview.drag("#ffffff");
    }
    assert.deepEqual(applied, ["#ffffff"]);
  });
});
