/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { HARVEST_MOBILE_BYTES, type HarvestWant } from "@wave/core";
import * as Effect from "effect/Effect";

import { harvestRun } from "./mixHarvestRun.ts";

const NOW = 1_000_000_000_000;
const MB = 1024 * 1024;

const want = (id: string, candidates: number) => ({
  id,
  candidates,
  readAt: null,
  seed: { id, name: id },
});

/** A run over [wants] where every read uses [bytes]; what it read, in order, and the mobile bytes it noted. */
const run = (
  wants: readonly (HarvestWant & { readonly seed: { readonly id: string; readonly name: string } })[],
  { onMobileData, bytes, usedToday = 0 }: { onMobileData: boolean; bytes: number; usedToday?: number },
) => {
  const read: string[] = [];
  let mobile = 0;
  const tried = new Map<string, number>();
  const count = Effect.runSync(
    harvestRun({
      wants,
      onMobileData,
      usedToday,
      now: () => NOW,
      tried,
      read: (seed) =>
        Effect.sync(() => {
          read.push(seed.id);
          return bytes;
        }),
      usedOnMobile: (used) => {
        mobile += used;
      },
    }),
  );
  return { count, read, mobile, tried };
};

describe("A harvest run", () => {
  test("on Wi-Fi reads every seed running low, the emptiest first, and counts no mobile data", () => {
    const { count, read, mobile, tried } = run(
      [want("full", 80), want("low", 20), want("empty", 0)],
      { onMobileData: false, bytes: MB },
    );
    assert.deepEqual(read, ["empty", "low"]);
    assert.equal(count, 2);
    assert.equal(mobile, 0);
    assert.deepEqual([...tried.keys()].sort(), ["empty", "low"]);
  });

  test("on mobile data reads only empty seeds, and stops once the day's ~5 MB are used", () => {
    const wants = [want("low", 20), want("a", 0), want("b", 0), want("c", 0)];
    const { read, mobile } = run(wants, { onMobileData: true, bytes: 3 * MB });
    assert.deepEqual(read, ["a", "b"]);
    assert.equal(mobile, 6 * MB);
    const spent = run(wants, { onMobileData: true, bytes: MB, usedToday: HARVEST_MOBILE_BYTES });
    assert.deepEqual(spent.read, []);
  });
});
