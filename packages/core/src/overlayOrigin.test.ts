import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { cardShowsHeading, highlightedOrigin, originOfNewCard, veilAround } from "./index.ts";

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

  test("a menu opened from a highlighted row drops its heading: the row already says what it's about", () => {
    assert.equal(cardShowsHeading(window, { left: 0, top: 200, right: 412, bottom: 256 }), false);
  });

  test("a menu opened from a tile partly off screen still counts as highlighted", () => {
    assert.equal(
      cardShowsHeading(window, { left: 300, top: 860, right: 480, bottom: 1000 }),
      false,
    );
  });

  test("a menu with nothing highlighted keeps its heading", () => {
    assert.equal(cardShowsHeading(window, undefined), true);
  });

  test("a menu whose origin sits off screen keeps its heading, since no highlight shows", () => {
    assert.equal(cardShowsHeading(window, { left: 0, top: 1000, right: 412, bottom: 1056 }), true);
  });
});
