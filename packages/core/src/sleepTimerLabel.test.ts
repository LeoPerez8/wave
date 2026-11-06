import assert from "node:assert/strict";
import { test } from "node:test";

import {
  catalogueOf,
  sleepTimerEntryLabel,
  sleepTimerLabelChangesIn,
  sleepTimerLabelSeconds,
} from "./index.ts";

test("a deadline label changes only at whole seconds remaining, including while paused", () => {
  const timer = { type: "deadline", endsAt: 60_250 } as const;
  assert.equal(sleepTimerLabelSeconds(timer, 250), 60);
  assert.equal(sleepTimerLabelSeconds(timer, 1_249), 60);
  assert.equal(sleepTimerLabelSeconds(timer, 1_250), 59);
  assert.equal(sleepTimerLabelSeconds(timer, 60_249), 1);
  assert.equal(sleepTimerLabelSeconds(timer, 60_250), 0);
  assert.equal(sleepTimerLabelSeconds(timer, 90_000), 0);
});

test("End of track never asks for a ticking label", () => {
  const timer = { type: "endOfTrack" } as const;
  assert.equal(sleepTimerLabelSeconds(timer, 0), null);
  assert.equal(sleepTimerLabelSeconds(timer, 60_000), null);
});

test("the playing song's card names Sleep Timer, with the time left while a timer runs", () => {
  assert.equal(sleepTimerEntryLabel(null, 0), "Sleep Timer");
  const timer = { type: "deadline", endsAt: 900_250 } as const;
  assert.equal(sleepTimerEntryLabel(timer, 250), "Sleep Timer · 15:00");
  assert.equal(sleepTimerEntryLabel(timer, 1_250), "Sleep Timer · 14:59");
  assert.equal(sleepTimerEntryLabel(timer, 999_999), "Sleep Timer · 0:00");
  assert.equal(sleepTimerEntryLabel({ type: "endOfTrack" }, 0), "Sleep Timer · End of track");
});

test("the card's Sleep Timer entry in Brazilian Portuguese", () => {
  const pt = catalogueOf("pt-BR");
  assert.equal(sleepTimerEntryLabel(null, 0, pt), "Timer para Dormir");
  assert.equal(
    sleepTimerEntryLabel({ type: "deadline", endsAt: 61_000 }, 0, pt),
    "Timer para Dormir · 1:01",
  );
  assert.equal(
    sleepTimerEntryLabel({ type: "endOfTrack" }, 0, pt),
    "Timer para Dormir · Fim da música",
  );
});

test("the card's entry changes at each whole second left, and not once the timer is due or ends with the song", () => {
  const timer = { type: "deadline", endsAt: 60_250 } as const;
  assert.equal(sleepTimerLabelChangesIn(timer, 250), 1_000);
  assert.equal(sleepTimerLabelChangesIn(timer, 600), 650);
  assert.equal(sleepTimerLabelChangesIn(timer, 1_249), 1);
  assert.equal(sleepTimerLabelChangesIn(timer, 59_250), 1_000);
  assert.equal(sleepTimerLabelChangesIn(timer, 60_250), null);
  assert.equal(sleepTimerLabelChangesIn({ type: "endOfTrack" }, 0), null);
  // The label at that moment has moved on by one second.
  assert.equal(
    sleepTimerLabelSeconds(timer, 600 + 650),
    (sleepTimerLabelSeconds(timer, 600) ?? 0) - 1,
  );
});
