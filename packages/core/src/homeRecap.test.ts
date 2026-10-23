import assert from "node:assert/strict";
import test from "node:test";
import { homeRecapVisibility, startHomeRecap, type RecapPeriod } from "./index.ts";

const september: RecapPeriod = { kind: "month", year: 2026, month: 9 };

test("a Recap found during a Home visit waits until Home is shown again", () => {
  const first = startHomeRecap(undefined, [], true);
  assert.equal(first.period, null);
  const answered = homeRecapVisibility(first, true, [september], []);
  assert.equal(answered.period, null);
  const hidden = homeRecapVisibility(answered, false, [september], []);
  assert.equal(hidden.period, null);
  const returned = homeRecapVisibility(hidden, true, [september], []);
  assert.deepEqual(returned.period, september);
});

test("a known Recap shows on opening and stays put until the next visit", () => {
  const first = startHomeRecap([september], [], true);
  assert.deepEqual(first.period, september);
  const october: RecapPeriod = { kind: "month", year: 2026, month: 10 };
  const updated = homeRecapVisibility(first, true, [october, september], []);
  assert.deepEqual(updated.period, september);
  const hidden = homeRecapVisibility(updated, false, [october, september], []);
  assert.deepEqual(homeRecapVisibility(hidden, true, [october, september], []).period, october);
});

test("a pending or empty answer has no card, including on a later visit", () => {
  assert.equal(startHomeRecap([], [], true).period, null);
  const hidden = homeRecapVisibility(startHomeRecap(undefined, [], true), false, undefined, []);
  assert.equal(homeRecapVisibility(hidden, true, undefined, []).period, null);
});

test("returning from a Recap removes its announcement and reopening uses the known answer", () => {
  const hidden = homeRecapVisibility(startHomeRecap([september], [], true), false, [september], []);
  assert.equal(homeRecapVisibility(hidden, true, [september], ["2026-09"]).period, null);
  assert.equal(startHomeRecap([september], ["2026-09"], true).period, null);
  assert.deepEqual(startHomeRecap([september], [], true).period, september);
});
