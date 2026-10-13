import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { focusedVersion, startFocusedVersion } from "./index.ts";

describe("focused version", () => {
  test("while hidden, plays don't change what the screen shows (so it doesn't re-query)", () => {
    let state = focusedVersion(startFocusedVersion(0), { type: "focus", version: 0 });
    state = focusedVersion(state, { type: "blur" });
    const hidden = state;
    state = focusedVersion(state, { type: "change", version: 1 });
    state = focusedVersion(state, { type: "change", version: 2 });
    assert.equal(state, hidden);
    assert.equal(state.shown, 0);
  });

  test("a screen that mounts hidden waits for focus too", () => {
    const state = startFocusedVersion(4);
    assert.equal(state.shown, 4);
    assert.equal(focusedVersion(state, { type: "change", version: 5 }), state);
  });

  test("coming back catches up with the plays that happened while hidden", () => {
    let state = focusedVersion(startFocusedVersion(0), { type: "focus", version: 0 });
    state = focusedVersion(state, { type: "blur" });
    state = focusedVersion(state, { type: "change", version: 3 });
    state = focusedVersion(state, { type: "focus", version: 3 });
    assert.equal(state.shown, 3);
  });

  test("while focused, each play start or end shows at once", () => {
    let state = focusedVersion(startFocusedVersion(0), { type: "focus", version: 0 });
    state = focusedVersion(state, { type: "change", version: 1 });
    assert.equal(state.shown, 1);
    state = focusedVersion(state, { type: "change", version: 2 });
    assert.equal(state.shown, 2);
  });

  test("a repeated focus or change with nothing new keeps the same state (no re-render)", () => {
    const focused = focusedVersion(startFocusedVersion(2), { type: "focus", version: 2 });
    assert.equal(focusedVersion(focused, { type: "focus", version: 2 }), focused);
    assert.equal(focusedVersion(focused, { type: "change", version: 2 }), focused);
  });
});
