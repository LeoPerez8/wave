import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { designPreviewState } from "./index.ts";

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
