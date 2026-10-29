import assert from "node:assert/strict";
import { test } from "node:test";

import { createRecognizeEntry, followRecognizeRequests } from "./recognizeEntry.ts";

test("tile, shortcut and Search share one card until it closes", () => {
  const cards: (() => void)[] = [];
  const entry = createRecognizeEntry({
    foreground: () => true,
    show: (_source, closed) => cards.push(closed),
  });
  entry.request();
  entry.request();
  assert.equal(cards.length, 1);
  cards[0]!();
  entry.request();
  assert.equal(cards.length, 2);
});

test("the inbox delivers cold and warm launches and stops delivering after cleanup", () => {
  let pending = true;
  const listeners = new Set<() => void>();
  let opened = 0;
  const stop = followRecognizeRequests(
    {
      take: () => {
        const next = pending;
        pending = false;
        return next;
      },
      subscribe: (listener) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
    },
    () => {
      opened++;
    },
  );
  assert.equal(opened, 1);
  pending = true;
  for (const listener of listeners) listener();
  assert.equal(opened, 2);
  stop();
  pending = true;
  for (const listener of listeners) listener();
  assert.equal(opened, 2);
  assert.equal(pending, true);
});

test("a cold or hidden launch waits for foreground, then consumes the request once", () => {
  let foreground = false;
  let opened = 0;
  const entry = createRecognizeEntry({
    foreground: () => foreground,
    show: () => {
      opened++;
    },
  });
  entry.request();
  entry.request();
  assert.equal(opened, 0);
  foreground = true;
  entry.resume();
  entry.resume();
  assert.equal(opened, 1);
});
