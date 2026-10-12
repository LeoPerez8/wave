import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { planAlert } from "./index.ts";

describe("planAlert", () => {
  test("a message has a single OK", () => {
    const plan = planAlert({
      title: "Wave is scanning",
      message: "You can add a folder once the scan finishes.",
    });
    assert.deepEqual(plan.buttons, [{ label: "OK", tone: "accent", choice: "dismiss" }]);
  });

  test("a confirmation shows Cancel then the destructive action", () => {
    const plan = planAlert({
      title: "Delete Road Trip?",
      message: "Its songs stay in your library.",
      action: { label: "Delete", destructive: true },
    });
    assert.deepEqual(plan.buttons, [
      { label: "Cancel", tone: "accent", choice: "dismiss" },
      { label: "Delete", tone: "destructive", choice: "action" },
    ]);
  });

  test("screen readers hear the title, then the message", () => {
    assert.equal(
      planAlert({
        title: "Wave is scanning",
        message: "You can add a folder once the scan finishes.",
      }).announcement,
      "Wave is scanning. You can add a folder once the scan finishes.",
    );
    assert.equal(
      planAlert({
        title: "Delete Road Trip?",
        message: "Its songs stay in your library.",
        action: { label: "Delete", destructive: true },
      }).announcement,
      "Delete Road Trip? Its songs stay in your library.",
    );
  });
});
