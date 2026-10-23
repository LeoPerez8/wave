import assert from "node:assert/strict";
import { test } from "node:test";

import { discoverRefreshAccessibility } from "./discoverRefresh.ts";

test("a Discover heading offers refresh and invokes its existing row callback", () => {
  let refreshes = 0;
  const heading = discoverRefreshAccessibility({
    label: "Get new artist mixes",
    enabled: true,
    run: () => refreshes++,
  });
  assert.deepEqual(heading.accessibilityActions, [
    { name: "refresh", label: "Get new artist mixes" },
  ]);
  heading.onAccessibilityAction({ nativeEvent: { actionName: "refresh" } });
  assert.equal(refreshes, 1);
  heading.onAccessibilityAction({ nativeEvent: { actionName: "activate" } });
  assert.equal(refreshes, 1, "reading or activating the heading must not rebuild the mixes");
});

test("a rebuilding row neither offers nor executes another accessibility refresh", () => {
  let refreshes = 0;
  const heading = discoverRefreshAccessibility({
    label: "Get other songs",
    enabled: false,
    run: () => refreshes++,
  });
  assert.deepEqual(heading.accessibilityActions, []);
  heading.onAccessibilityAction({ nativeEvent: { actionName: "refresh" } });
  assert.equal(refreshes, 0);
});

test("a loading row without refresh has no refresh action", () => {
  const heading = discoverRefreshAccessibility();
  assert.deepEqual(heading.accessibilityActions, []);
  assert.doesNotThrow(() =>
    heading.onAccessibilityAction({ nativeEvent: { actionName: "refresh" } }),
  );
});
