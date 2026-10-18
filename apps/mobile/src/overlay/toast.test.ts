/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { currentToast, dismissToast, removeToast, runToastAction, showToast } from "./toast.ts";

/** Whether [promise] has settled, after pending callbacks run. */
const settled = async (promise: Promise<unknown>): Promise<boolean> => {
  let done = false;
  void promise.then(() => (done = true));
  await new Promise((resolve) => setImmediate(resolve));
  return done;
};

/** The toast showing, which the test expects there to be. */
const shown = () => {
  const toast = currentToast.get();
  assert.ok(toast !== null);
  return toast;
};

describe("showToast", () => {
  test("shows the line until the toast has left", async () => {
    const left = showToast("Fixed 3 songs · 1 not found");
    const toast = shown();
    assert.equal(toast.text, "Fixed 3 songs · 1 not found");
    assert.equal(toast.leaving, false);
    assert.equal(await settled(left), false);

    dismissToast(toast.id);
    assert.equal(shown().leaving, true);
    assert.equal(await settled(left), false);

    removeToast(toast.id);
    assert.equal(currentToast.get(), null);
    assert.equal(await settled(left), true);
  });

  test("puts a newer line in place of the one showing, which counts as gone", async () => {
    const first = showToast("Fixed “Airbag”");
    const firstId = shown().id;
    const second = showToast("Nothing to fix");
    assert.equal(shown().text, "Nothing to fix");
    assert.equal(await settled(first), true);

    // The first toast's exit, still under way, doesn't take the second away.
    removeToast(firstId);
    assert.equal(shown().text, "Nothing to fix");
    removeToast(shown().id);
    assert.equal(await settled(second), true);
  });

  test("runs the toast's action once, and the toast leaves", () => {
    let runs = 0;
    void showToast("New queue playing", { label: "Undo", run: () => (runs += 1) });
    const toast = shown();
    assert.equal(toast.action?.label, "Undo");

    runToastAction(toast.id);
    assert.equal(runs, 1);
    assert.equal(shown().leaving, true);

    runToastAction(toast.id);
    assert.equal(runs, 1);
    removeToast(toast.id);
  });

  test("doesn't run an action once the toast is leaving or another took its place", () => {
    let runs = 0;
    void showToast("New queue playing", { label: "Undo", run: () => (runs += 1) });
    const first = shown().id;
    dismissToast(first);
    runToastAction(first);

    void showToast("Saved Mix");
    assert.equal(shown().action, null);
    runToastAction(first);
    assert.equal(runs, 0);
    removeToast(shown().id);
  });
});
