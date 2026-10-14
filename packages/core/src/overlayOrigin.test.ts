import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  cardShowsHeading,
  highlightedOrigin,
  originOfNewCard,
  restingRect,
  veilAround,
  visibleHighlight,
} from "./index.ts";

const songRow = "song row";

describe("originOfNewCard", () => {
  test("a card opened by a press is about what was pressed", () => {
    assert.equal(originOfNewCard({ pressed: songRow, held: undefined, cards: [] }), songRow);
  });

  test("a card opened without a press, with nothing else open, is about nothing", () => {
    assert.equal(originOfNewCard({ pressed: undefined, held: undefined, cards: [] }), undefined);
  });

  test("a follow-up card opened as the menu closes (Add to Playlist) carries the menu's origin", () => {
    assert.equal(
      originOfNewCard({
        pressed: undefined,
        held: undefined,
        cards: [{ origin: songRow, closing: true }],
      }),
      songRow,
    );
  });

  test("a card opened after async work started by a choice carries the origin it held", () => {
    assert.equal(originOfNewCard({ pressed: undefined, held: songRow, cards: [] }), songRow);
  });

  test("a card follows the topmost card, not one further down", () => {
    assert.equal(
      originOfNewCard({
        pressed: undefined,
        held: undefined,
        cards: [
          { origin: "album tile", closing: false },
          { origin: songRow, closing: false },
        ],
      }),
      songRow,
    );
  });

  test("a press wins over a held or inherited origin", () => {
    assert.equal(
      originOfNewCard({
        pressed: "playlist button",
        held: songRow,
        cards: [{ origin: songRow, closing: false }],
      }),
      "playlist button",
    );
  });
});

describe("highlightedOrigin", () => {
  test("the element a menu was opened from is highlighted while the menu is open", () => {
    assert.equal(highlightedOrigin([{ origin: songRow, closing: false }]), songRow);
  });

  test("nothing is highlighted once the last card is closing", () => {
    assert.equal(highlightedOrigin([{ origin: songRow, closing: true }]), undefined);
    assert.equal(highlightedOrigin([]), undefined);
  });

  test("the highlight stays through a follow-up card while the menu fades out", () => {
    assert.equal(
      highlightedOrigin([
        { origin: songRow, closing: true },
        { origin: songRow, closing: false },
      ]),
      songRow,
    );
  });

  test("a card opened without a press highlights nothing", () => {
    assert.equal(highlightedOrigin([{ origin: undefined, closing: false }]), undefined);
  });

  test("the topmost open card decides", () => {
    assert.equal(
      highlightedOrigin([
        { origin: "album tile", closing: false },
        { origin: songRow, closing: false },
        { origin: "sort button", closing: true },
      ]),
      songRow,
    );
  });
});

describe("veilAround", () => {
  const window = { width: 412, height: 915 };
  const full = { left: 0, top: 0, right: 412, bottom: 915 };

  test("a full-width row leaves the veil above and below it", () => {
    assert.deepEqual(veilAround(window, { left: 0, top: 200, right: 412, bottom: 256 }), [
      { left: 0, top: 0, right: 412, bottom: 200 },
      { left: 0, top: 256, right: 412, bottom: 915 },
    ]);
  });

  test("a button leaves bands above, below and on either side", () => {
    assert.deepEqual(veilAround(window, { left: 340, top: 60, right: 388, bottom: 108 }), [
      { left: 0, top: 0, right: 412, bottom: 60 },
      { left: 0, top: 108, right: 412, bottom: 915 },
      { left: 0, top: 60, right: 340, bottom: 108 },
      { left: 388, top: 60, right: 412, bottom: 108 },
    ]);
  });

  test("a tile partly off screen is cut where the screen ends", () => {
    assert.deepEqual(veilAround(window, { left: 300, top: 860, right: 480, bottom: 1000 }), [
      { left: 0, top: 0, right: 412, bottom: 860 },
      { left: 0, top: 860, right: 300, bottom: 915 },
    ]);
  });

  test("with nothing to highlight, or it is off screen, the veil covers everything", () => {
    assert.deepEqual(veilAround(window, undefined), [full]);
    assert.deepEqual(veilAround(window, { left: 0, top: 1000, right: 412, bottom: 1056 }), [full]);
  });
});

describe("cardShowsHeading", () => {
  const window = { width: 412, height: 915 };
  const insets = { bottom: 24 };
  const heading = (
    rect: { left: number; top: number; right: number; bottom: number } | undefined,
  ) => cardShowsHeading({ window, insets, chromeBottom: 136, rect });

  test("a menu opened from a highlighted row drops its heading: the row already says what it's about", () => {
    assert.equal(heading({ left: 0, top: 200, right: 412, bottom: 256 }), false);
  });

  test("a menu opened from a tile partly under the mini player still counts as highlighted", () => {
    assert.equal(heading({ left: 16, top: 640, right: 200, bottom: 860 }), false);
  });

  test("a menu with nothing highlighted keeps its heading", () => {
    assert.equal(heading(undefined), true);
  });

  test("a menu whose origin sits off screen keeps its heading, since no highlight shows", () => {
    assert.equal(heading({ left: 0, top: 1000, right: 412, bottom: 1056 }), true);
  });

  test("a menu whose origin is entirely under the floating chrome keeps its heading", () => {
    assert.equal(heading({ left: 0, top: 780, right: 412, bottom: 836 }), true);
  });
});

describe("restingRect", () => {
  test("a row measured while sunk by its press feedback gets back its full size", () => {
    // A 400 x 64 row centred at (206, 232), sunk to 98.5% (depth 0.015).
    assert.deepEqual(restingRect({ left: 9, top: 200.48, right: 403, bottom: 263.52 }, 0.985), {
      left: 6,
      top: 200,
      right: 406,
      bottom: 264,
    });
  });

  test("a row at rest is left as measured", () => {
    const row = { left: 0, top: 200, right: 412, bottom: 256 };
    assert.deepEqual(restingRect(row, 1), row);
  });
});

describe("visibleHighlight", () => {
  const window = { width: 412, height: 915 };
  const insets = { bottom: 24 };
  // Tab bar and mini player with their gaps: 8 + 64 + 8 + 56 above the inset, so they start at 755.
  const chromeBottom = 136;

  test("a tile partly under the mini player is highlighted only above it", () => {
    assert.deepEqual(
      visibleHighlight({
        window,
        insets,
        chromeBottom,
        rect: { left: 16, top: 640, right: 200, bottom: 860 },
      }),
      { left: 16, top: 640, right: 200, bottom: 755 },
    );
  });

  test("a row entirely under the floating chrome shows no highlight", () => {
    assert.equal(
      visibleHighlight({
        window,
        insets,
        chromeBottom,
        rect: { left: 0, top: 780, right: 412, bottom: 836 },
      }),
      undefined,
    );
  });

  test("a button on the floating chrome itself (the selection bar's More) is highlighted in full", () => {
    const more = { left: 340, top: 819, right: 388, bottom: 883 };
    assert.deepEqual(
      visibleHighlight({ window, insets, chromeBottom, rect: more, onChrome: true }),
      more,
    );
  });

  test("on a screen without floating chrome, a row behind the navigation bar is cut only by the window", () => {
    assert.deepEqual(
      visibleHighlight({
        window,
        insets,
        chromeBottom: 0,
        rect: { left: 0, top: 880, right: 412, bottom: 936 },
      }),
      { left: 0, top: 880, right: 412, bottom: 915 },
    );
  });

  test("a row off screen shows no highlight", () => {
    assert.equal(
      visibleHighlight({
        window,
        insets,
        chromeBottom: 0,
        rect: { left: 0, top: -80, right: 412, bottom: -24 },
      }),
      undefined,
    );
  });

  test("nothing pressed shows no highlight", () => {
    assert.equal(visibleHighlight({ window, insets, chromeBottom, rect: undefined }), undefined);
  });
});
