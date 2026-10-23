import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  BOUNCE_AMOUNT,
  bounceOvershoot,
  bounceScale,
  bounceSpring,
  MIX_PULL_THRESHOLD,
  mixPull,
  readBounceAmount,
  resolveRowSwipe,
  RETURN_SPRINGS,
  rowSwipeArmed,
  sliderValueAt,
  stepSlider,
  storedBounceAmount,
} from "./index.ts";

/** Every amount the slider can hold, in order. */
const AMOUNTS = Array.from(
  { length: (BOUNCE_AMOUNT.max - BOUNCE_AMOUNT.min) / BOUNCE_AMOUNT.step + 1 },
  (_, index) => BOUNCE_AMOUNT.min + index * BOUNCE_AMOUNT.step,
);

/**
 * Where a spring released at rest [distance] away from its target is over
 * time: integrates it as Reanimated does (no velocity), returning the furthest
 * it swings past the target and whether it settled.
 */
const simulate = (
  spring: { damping: number; stiffness: number; mass: number; overshootClamping: boolean },
  distance: number,
  velocity = 0,
): { readonly past: number; readonly settled: boolean } => {
  let x = distance;
  let v = velocity;
  let past = 0;
  const dt = 1 / 1000;
  for (let t = 0; t < 3; t += dt) {
    const a = (-spring.stiffness * x - spring.damping * v) / spring.mass;
    v += a * dt;
    x += v * dt;
    if (spring.overshootClamping && Math.sign(x) !== Math.sign(distance)) {
      x = 0;
      v = 0;
    }
    past = Math.max(past, -Math.sign(distance) * x);
  }
  return { past, settled: Math.abs(x) < 0.5 && Math.abs(v) < 5 };
};

describe("readBounceAmount", () => {
  test("a fresh install (nothing stored) bounces as Wave always has: 100%", () => {
    assert.equal(BOUNCE_AMOUNT.default, 100);
    assert.equal(readBounceAmount(null), 100);
  });

  test("a stored amount comes back", () => {
    assert.equal(readBounceAmount("0"), 0);
    assert.equal(readBounceAmount("55"), 55);
    assert.equal(readBounceAmount("120"), 120);
  });

  test("anything malformed is the default", () => {
    for (const stored of ["", "  ", "abc", "50%", "NaN", "Infinity", "1e2", "0x40", '"80"', "{}"]) {
      assert.equal(readBounceAmount(stored), 100, stored);
    }
  });

  test("an amount off the range is clamped to its ends", () => {
    assert.equal(readBounceAmount("-20"), 0);
    assert.equal(readBounceAmount("500"), 120);
    assert.equal(readBounceAmount("121"), 120);
  });

  test("an amount between steps lands on the nearest step", () => {
    assert.equal(readBounceAmount("57"), 55);
    assert.equal(readBounceAmount("58"), 60);
    assert.equal(readBounceAmount("99.9"), 100);
  });
});

describe("storedBounceAmount", () => {
  test("the default stores nothing, so it syncs as unset and reads back as 100%", () => {
    assert.equal(storedBounceAmount(100), null);
    assert.equal(readBounceAmount(storedBounceAmount(100)), 100);
  });

  test("every other amount round-trips", () => {
    for (const amount of AMOUNTS) {
      assert.equal(readBounceAmount(storedBounceAmount(amount)), amount);
    }
  });

  test("an amount off the range or step is stored as it reads back", () => {
    assert.equal(storedBounceAmount(-5), "0");
    assert.equal(storedBounceAmount(130), "120");
    assert.equal(storedBounceAmount(Number.NaN), null);
  });
});

describe("the Bounce amount slider", () => {
  test("runs from 0% to 120% and reaches both ends and 100%", () => {
    assert.equal(sliderValueAt(0, 300, BOUNCE_AMOUNT), 0);
    assert.equal(sliderValueAt(300, 300, BOUNCE_AMOUNT), 120);
    assert.equal(sliderValueAt(250, 300, BOUNCE_AMOUNT), 100);
  });

  test("a screen reader steps it 5% at a time and stops at the ends", () => {
    assert.equal(stepSlider(100, 1, BOUNCE_AMOUNT), 105);
    assert.equal(stepSlider(100, -1, BOUNCE_AMOUNT), 95);
    assert.equal(stepSlider(120, 1, BOUNCE_AMOUNT), 120);
    assert.equal(stepSlider(0, -1, BOUNCE_AMOUNT), 0);
  });
});

describe("bounceScale", () => {
  test("is the amount as a multiple of Wave's own elasticity", () => {
    assert.equal(bounceScale(100, false), 1);
    assert.equal(bounceScale(0, false), 0);
    assert.equal(bounceScale(120, false), 1.2);
    assert.equal(bounceScale(50, false), 0.5);
  });

  test("Android's reduce motion takes the bounce away at every amount", () => {
    for (const amount of AMOUNTS) assert.equal(bounceScale(amount, true), 0);
  });

  test("stays within the range for anything it's handed", () => {
    assert.equal(bounceScale(-40, false), 0);
    assert.equal(bounceScale(400, false), 1.2);
    assert.equal(bounceScale(Number.NaN, false), 1);
  });
});

describe("bounceSpring", () => {
  test("at 100% every spring is Wave's own, unchanged", () => {
    for (const [name, spring] of Object.entries(RETURN_SPRINGS)) {
      assert.deepEqual(bounceSpring(spring, 1), { ...spring, overshootClamping: false }, name);
    }
  });

  test("Wave's own springs swing a little past rest", () => {
    for (const [name, spring] of Object.entries(RETURN_SPRINGS)) {
      const overshoot = bounceOvershoot(spring);
      assert.ok(overshoot > 0.01 && overshoot < 0.1, `${name}: ${overshoot}`);
    }
  });

  test("at 0% it arrives without passing rest, even when flung, at the same stiffness", () => {
    for (const [name, spring] of Object.entries(RETURN_SPRINGS)) {
      const still = bounceSpring(spring, 0);
      assert.equal(still.overshootClamping, true, name);
      assert.equal(still.stiffness, spring.stiffness, name);
      assert.equal(bounceOvershoot(still), 0, name);
      assert.equal(simulate(still, 100).past, 0, name);
      assert.equal(simulate(still, 100, -3000).past, 0, name);
      assert.ok(simulate(still, 100).settled, name);
    }
  });

  test("the overshoot grows steadily with the amount, across the whole range", () => {
    for (const spring of Object.values(RETURN_SPRINGS)) {
      const overshoots = AMOUNTS.map((amount) =>
        bounceOvershoot(bounceSpring(spring, bounceScale(amount, false))),
      );
      for (let index = 1; index < overshoots.length; index++) {
        assert.ok(
          overshoots[index]! > overshoots[index - 1]!,
          `${AMOUNTS[index]}% overshoots more than ${AMOUNTS[index - 1]}%`,
        );
      }
    }
  });

  test("the overshoot is the amount's share of Wave's own", () => {
    const base = RETURN_SPRINGS.pullRow;
    const own = bounceOvershoot(base);
    for (const scale of [0.25, 0.5, 0.75, 1.2]) {
      assert.ok(
        Math.abs(bounceOvershoot(bounceSpring(base, scale)) - own * scale) < 1e-9,
        `${scale}`,
      );
    }
  });

  test("120% adds only a little: under 2 dp more on a 100 dp return, and it still settles", () => {
    for (const [name, spring] of Object.entries(RETURN_SPRINGS)) {
      const now = simulate(bounceSpring(spring, 1), 100);
      const more = simulate(bounceSpring(spring, 1.2), 100);
      assert.ok(more.past > now.past, name);
      assert.ok(more.past - now.past < 2, `${name}: ${more.past - now.past}`);
      assert.ok(more.settled, name);
    }
  });

  test("a spring that never overshoots is left alone", () => {
    const stiff = { damping: 40, stiffness: 240, mass: 1 };
    assert.equal(bounceSpring(stiff, 1.2).damping, 40);
    assert.equal(bounceSpring(stiff, 0.5).damping, 40);
    assert.equal(bounceSpring(stiff, 0).overshootClamping, true);
  });
});

/** A pull row's give at [amount] percent, reduce motion off. */
const give = (amount: number) => bounceScale(amount, false);

describe("pull to refresh at every bounce amount", () => {
  test("at 100% the row gives as it always did", () => {
    for (const drag of [0, 30, 72, 150, 400]) {
      assert.deepEqual(mixPull(drag, 1), mixPull(drag));
    }
  });

  test("at 0% the row holds still, yet the pull still arms and refreshes", () => {
    for (const drag of [10, 72, 200]) assert.equal(mixPull(drag, give(0)).offset, 0);
    assert.equal(mixPull(MIX_PULL_THRESHOLD - 1, give(0)).armed, false);
    assert.equal(mixPull(MIX_PULL_THRESHOLD, give(0)).armed, true);
    assert.equal(mixPull(MIX_PULL_THRESHOLD / 2, give(0)).progress, 0.5);
  });

  test("under reduce motion the row holds still and the pull still refreshes", () => {
    const still = bounceScale(120, true);
    assert.equal(mixPull(200, still).offset, 0);
    assert.equal(mixPull(MIX_PULL_THRESHOLD, still).armed, true);
  });

  test("the threshold and the arrow's progress don't move with the amount", () => {
    for (const drag of [0, 20, MIX_PULL_THRESHOLD - 1, MIX_PULL_THRESHOLD, 300]) {
      const atDefault = mixPull(drag, 1);
      for (const amount of AMOUNTS) {
        const pull = mixPull(drag, give(amount));
        assert.equal(pull.armed, atDefault.armed, `${amount}% at ${drag} dp`);
        assert.equal(pull.progress, atDefault.progress, `${amount}% at ${drag} dp`);
      }
    }
  });

  test("the give grows with the amount at every pull", () => {
    for (const drag of [5, 20, MIX_PULL_THRESHOLD, 300]) {
      const offsets = AMOUNTS.map((amount) => mixPull(drag, give(amount)).offset);
      for (let index = 1; index < offsets.length; index++) {
        assert.ok(offsets[index]! >= offsets[index - 1]!, `${AMOUNTS[index]}% at ${drag} dp`);
      }
    }
    // Past the first few dp, where the most give already follows the finger, it grows strictly.
    for (const drag of [MIX_PULL_THRESHOLD, 300]) {
      const offsets = AMOUNTS.map((amount) => mixPull(drag, give(amount)).offset);
      for (let index = 1; index < offsets.length; index++) {
        assert.ok(offsets[index]! > offsets[index - 1]!, `${AMOUNTS[index]}% at ${drag} dp`);
      }
    }
  });

  test("120% gives a fifth more and never runs ahead of the finger", () => {
    for (const drag of [MIX_PULL_THRESHOLD, 300, 2000]) {
      const more = mixPull(drag, give(120)).offset;
      assert.ok(Math.abs(more - mixPull(drag).offset * 1.2) < 1e-9, `${drag} dp`);
    }
    for (const drag of [1, 5, 20, 24, 30, MIX_PULL_THRESHOLD, 300]) {
      assert.ok(mixPull(drag, give(120)).offset <= drag, `${drag} dp`);
    }
    // However far the finger goes, the gap at the edge stays under 144 dp.
    assert.ok(mixPull(100_000, give(120)).offset < 144);
  });
});

describe("swipe thresholds at every bounce amount", () => {
  test("the bounce amount isn't an input: a row arms a third of the way, as always", () => {
    // `rowSwipeArmed` and `resolveRowSwipe` take only the finger's travel and
    // the row's width, so the amount can't move where a swipe arms or runs.
    assert.equal(rowSwipeArmed.length, 1);
    assert.equal(rowSwipeArmed({ translationX: 122, width: 364 }), "right");
    assert.equal(
      resolveRowSwipe(
        { translationX: -122, velocityX: 0, width: 364 },
        { left: true, right: true },
      ),
      "left",
    );
  });
});
