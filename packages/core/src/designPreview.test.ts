import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  ANCHOR_UNMEASURED,
  designPreviewState,
  isDesignPreviewLink,
  watchAnchor,
} from "./index.ts";
import type { OverlayRect } from "./index.ts";

const STATES = [
  { name: "song-card-open", shows: "A song's card open over its row" },
  { name: "album-card-open", shows: "An album's card open over its tile" },
] as const;

describe("Design preview state from a link", () => {
  test("a link naming a state opens that state", () => {
    assert.equal(designPreviewState(STATES, "song-card-open"), STATES[0]);
    assert.equal(designPreviewState(STATES, "album-card-open"), STATES[1]);
  });

  test("a link without a state, or naming none of them, opens no state", () => {
    assert.equal(designPreviewState(STATES, undefined), undefined);
    assert.equal(designPreviewState(STATES, ""), undefined);
    assert.equal(designPreviewState(STATES, "song-card"), undefined);
    assert.equal(designPreviewState(STATES, "Song-Card-Open"), undefined);
  });

  test("a link repeating `state` opens the first one it names", () => {
    assert.equal(designPreviewState(STATES, ["album-card-open", "song-card-open"]), STATES[1]);
    assert.equal(designPreviewState(STATES, []), undefined);
  });
});

describe("A link to the Design preview", () => {
  test("opens it, with a state or without", () => {
    assert.equal(isDesignPreviewLink("wave://design-preview?state=song-card-open"), true);
    assert.equal(isDesignPreviewLink("wave://design-preview"), true);
    assert.equal(isDesignPreviewLink("wave:///design-preview?state=sort-card-open"), true);
    assert.equal(isDesignPreviewLink("wave://design-preview/?state=sort-card-open"), true);
    assert.equal(isDesignPreviewLink("wave://design-preview#top"), true);
  });

  test("a link anywhere else is not one", () => {
    assert.equal(isDesignPreviewLink("wave://library"), false);
    assert.equal(isDesignPreviewLink("wave://design-preview-old?state=x"), false);
    assert.equal(isDesignPreviewLink("wave://settings?next=design-preview"), false);
    assert.equal(isDesignPreviewLink("wave://library/design-preview"), false);
    assert.equal(isDesignPreviewLink(""), false);
  });
});

describe("When a state's card opens over what it opens from", () => {
  const row = { left: 16, top: 300, right: 380, bottom: 356 };
  const OPTIONS = { stillFor: 3, giveUpAfter: 10 };
  /** The row, a pixel up and down by turns: never still. */
  const shaky = (i: number) => ({ ...row, top: row.top + (i % 2) });

  /** Feeds [measures] in turn: the measure it opens at (1-based) and where, if it opens. */
  const run = (measures: readonly (OverlayRect | undefined)[]) => {
    let watch = ANCHOR_UNMEASURED;
    for (const [i, measured] of measures.entries()) {
      const step = watchAnchor(watch, measured, OPTIONS);
      if (step.open) return { at: i + 1, rect: step.rect };
      watch = step.watch;
    }
    return undefined;
  };

  test("a laid-out anchor that sits still opens its card there", () => {
    assert.deepEqual(run([row, row, row]), { at: 3, rect: row });
    assert.equal(run([row, row]), undefined);
  });

  test("an anchor still moving, as its screen slides in, waits until it stops", () => {
    const sliding = (dx: number) => ({ ...row, left: row.left + dx, right: row.right + dx });
    assert.deepEqual(run([sliding(120), sliding(60), sliding(10), row, row, row]), {
      at: 6,
      rect: row,
    });
    assert.equal(run([row, row, sliding(4), row]), undefined);
  });

  test("an anchor not laid out yet, or with no size, is measured again", () => {
    assert.deepEqual(run([undefined, undefined, row, row, row]), { at: 5, rect: row });
    assert.equal(run([row, row, undefined, row]), undefined);
  });

  test("it opens anyway after enough measures: where the anchor last was, or centred", () => {
    assert.deepEqual(run(Array.from({ length: 10 }, (_, i) => shaky(i))), {
      at: 10,
      rect: shaky(9),
    });
    assert.deepEqual(run(Array.from({ length: 10 }, () => undefined)), {
      at: 10,
      rect: undefined,
    });
  });
});
