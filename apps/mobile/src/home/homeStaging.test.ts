import assert from "node:assert/strict";
import test from "node:test";
import { homeItems, parseHomeArrangement, stagedMounts, type HomeItem } from "@wave/core";

import { homeItemEstimate } from "./homeOpening.ts";

/** A small phone: 411 dp wide, 800 dp tall, at the default text size. */
const WIDTH = 411;
const HEIGHT = 800;

const firstFrame = (items: readonly HomeItem[], fontScale = 1) =>
  stagedMounts({
    estimates: items.map((item) => homeItemEstimate(item, fontScale, WIDTH)),
    viewport: HEIGHT,
  });

const named = (items: readonly HomeItem[], count: number) =>
  items.slice(0, count).map((item) => (typeof item === "string" ? item : item.section));

test("Home's first frame mounts the sections that start on screen: Discover and In your orbit", () => {
  const items = homeItems(parseHomeArrangement(null), { nothingPlayed: false });
  const [first, ...later] = firstFrame(items);
  // New releases and Upcoming shows often draw nothing, so they are counted as no height.
  assert.deepEqual(named(items, first!), [
    "new-releases",
    "upcoming-shows",
    "discover",
    "in-your-orbit",
  ]);
  assert.equal(later.at(-1), items.length);
});

test("sections that may draw nothing count no height, so the first frame never ends short", () => {
  for (const id of ["new-releases", "upcoming-shows", "community-playlists"] as const)
    assert.equal(homeItemEstimate({ section: id }, 1, WIDTH), 0);
  assert.equal(homeItemEstimate("play-hint", 1, WIDTH), 0);
});

test("a section's estimate is no taller than its heading over its content's room", () => {
  // Erring short: the heading's margin, line and gap, then what HomeSectionSpace keeps.
  const orbit = homeItemEstimate({ section: "in-your-orbit" }, 1, WIDTH);
  assert.ok(orbit > 300 && orbit < 700, `In your orbit's estimate ${orbit}`);
  const shelf = homeItemEstimate({ section: "recently-added" }, 1, WIDTH);
  assert.ok(shelf > 200 && shelf < 400, `a shelf's estimate ${shelf}`);
});

test("at a large text size fewer sections fit, and each later frame mounts about a screen more", () => {
  const items = homeItems(parseHomeArrangement(null), { nothingPlayed: false });
  const plan = firstFrame(items, 2);
  assert.ok(plan[0]! <= 4);
  assert.ok(plan.length > 2);
});
