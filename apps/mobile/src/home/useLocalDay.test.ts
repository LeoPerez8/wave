import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { useLastDefined, useLocalDay } from "./useLocalDay.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

test("the Home recent-list day changes just after local midnight while mounted", (t) => {
  const midnight = new Date(2026, 10, 21).getTime();
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: midnight - 60_000 });
  const days: string[] = [];
  function Reader() {
    days.push(useLocalDay());
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  try {
    act(() => {
      renderer = create(createElement(Reader));
    });
    assert.equal(days.at(-1), new Date(midnight - 60_000).toDateString());
    act(() => t.mock.timers.tick(61_000));
    assert.equal(days.at(-1), new Date(midnight + 1_000).toDateString());
  } finally {
    act(() => renderer?.unmount());
    t.mock.timers.reset();
  }
});

test("a list read again keeps showing its last result until the new one arrives", () => {
  const seen: (string | undefined)[] = [];
  function Reader({ value }: { value: string | undefined }) {
    seen.push(useLastDefined(value));
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  try {
    act(() => {
      renderer = create(createElement(Reader, { value: undefined }));
    });
    assert.equal(seen.at(-1), undefined);
    act(() => renderer?.update(createElement(Reader, { value: "yesterday" })));
    assert.equal(seen.at(-1), "yesterday");
    act(() => renderer?.update(createElement(Reader, { value: undefined })));
    assert.equal(seen.at(-1), "yesterday");
    act(() => renderer?.update(createElement(Reader, { value: "today" })));
    assert.equal(seen.at(-1), "today");
  } finally {
    act(() => renderer?.unmount());
  }
});
