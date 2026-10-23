import assert from "node:assert/strict";
import test from "node:test";
import {
  homeRecapVisibility,
  parseKnownRecaps,
  storedKnownRecaps,
  startHomeRecap,
  type RecapPeriod,
} from "./index.ts";

const september: RecapPeriod = { kind: "month", year: 2026, month: 9 };

test("a discovered Recap survives a restart and is announced on opening unless already opened", () => {
  const stored = storedKnownRecaps([september]);
  assert.equal(stored, '["2026-09"]');
  const restored = parseKnownRecaps(stored);
  assert.deepEqual(
    startHomeRecap({ available: restored, opened: [], visible: true }).period,
    september,
  );
  assert.equal(
    startHomeRecap({ available: restored, opened: ["2026-09"], visible: true }).period,
    null,
  );
});

test("stored availability preserves yearly and monthly Recaps and distinguishes empty from unknown", () => {
  const periods: readonly RecapPeriod[] = [{ kind: "year", year: 2026 }, september];
  assert.deepEqual(parseKnownRecaps(storedKnownRecaps(periods)), periods);
  assert.deepEqual(parseKnownRecaps(storedKnownRecaps([])), []);
  assert.equal(parseKnownRecaps(storedKnownRecaps(undefined)), undefined);
  for (const stored of ["broken", "null", "{}", '["2026-13"]', "[42]", '["2026",null]']) {
    assert.equal(parseKnownRecaps(stored), undefined);
  }
});

test("a Recap found during a Home visit waits until Home is shown again", () => {
  const first = startHomeRecap({ available: undefined, opened: [], visible: true });
  assert.equal(first.period, null);
  const answered = homeRecapVisibility(first, {
    visible: true,
    available: [september],
    opened: [],
  });
  assert.equal(answered.period, null);
  const hidden = homeRecapVisibility(answered, {
    visible: false,
    available: [september],
    opened: [],
  });
  assert.equal(hidden.period, null);
  const returned = homeRecapVisibility(hidden, {
    visible: true,
    available: [september],
    opened: [],
  });
  assert.deepEqual(returned.period, september);
});

test("a known Recap shows on opening and stays put until the next visit", () => {
  const first = startHomeRecap({ available: [september], opened: [], visible: true });
  assert.deepEqual(first.period, september);
  const october: RecapPeriod = { kind: "month", year: 2026, month: 10 };
  const updated = homeRecapVisibility(first, {
    visible: true,
    available: [october, september],
    opened: [],
  });
  assert.deepEqual(updated.period, september);
  const hidden = homeRecapVisibility(updated, {
    visible: false,
    available: [october, september],
    opened: [],
  });
  assert.deepEqual(
    homeRecapVisibility(hidden, { visible: true, available: [october, september], opened: [] })
      .period,
    october,
  );
});

test("a pending or empty answer has no card, including on a later visit", () => {
  assert.equal(startHomeRecap({ available: [], opened: [], visible: true }).period, null);
  const hidden = homeRecapVisibility(
    startHomeRecap({ available: undefined, opened: [], visible: true }),
    { visible: false, available: undefined, opened: [] },
  );
  assert.equal(
    homeRecapVisibility(hidden, { visible: true, available: undefined, opened: [] }).period,
    null,
  );
});

test("returning from a Recap removes its announcement and reopening uses the known answer", () => {
  const hidden = homeRecapVisibility(
    startHomeRecap({ available: [september], opened: [], visible: true }),
    { visible: false, available: [september], opened: [] },
  );
  assert.equal(
    homeRecapVisibility(hidden, { visible: true, available: [september], opened: ["2026-09"] })
      .period,
    null,
  );
  assert.equal(
    startHomeRecap({ available: [september], opened: ["2026-09"], visible: true }).period,
    null,
  );
  assert.deepEqual(
    startHomeRecap({ available: [september], opened: [], visible: true }).period,
    september,
  );
});
