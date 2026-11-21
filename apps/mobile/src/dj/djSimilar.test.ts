import assert from "node:assert/strict";
import { test } from "node:test";

import type { DjSavedPage } from "@wave/core";

import { readDjSimilar } from "./djSimilar.ts";

const DAY = 24 * 60 * 60 * 1000;

const found = (checkedAt: number, similar: string[]): DjSavedPage => ({
  outcome: "found",
  checkedAt,
  page: { similar: similar.map((name) => ({ name })) },
});

/** A phone with [saved] for the page, where asking gives [answer] (a rejection when it's an Error). */
const phone = (saved: DjSavedPage | null, answer: DjSavedPage | Error, online = true) => {
  const asked: (DjSavedPage | null)[] = [];
  return {
    asked,
    ports: {
      saved: () => Promise.resolve(saved),
      canAsk: () => online,
      ask: (given: DjSavedPage | null) => {
        asked.push(given);
        return answer instanceof Error ? Promise.reject(answer) : Promise.resolve(answer);
      },
      now: () => 10 * DAY,
    },
  };
};

const listed = async (read: ReturnType<typeof readDjSimilar>): Promise<string[] | null> =>
  (await read)?.map((artist) => artist.name) ?? null;

test("a page saved within the week fills the row with no request", async () => {
  const dj = phone(found(9 * DAY, ["Tricky", "Lamb"]), new Error("never asked"));
  assert.deepEqual(await listed(readDjSimilar(dj.ports)), ["Tricky", "Lamb"]);
  assert.deepEqual(dj.asked, []);
});

test("with nothing saved the page is read, and its list fills the row", async () => {
  const dj = phone(null, found(10 * DAY, ["Morcheeba"]));
  assert.deepEqual(await listed(readDjSimilar(dj.ports)), ["Morcheeba"]);
  assert.deepEqual(dj.asked, [null]);
});

test("an artist YouTube Music doesn't have gives nothing", async () => {
  const dj = phone(null, { outcome: "unmatched", checkedAt: 10 * DAY });
  assert.equal(await readDjSimilar(dj.ports), null);
});

test("offline, nothing is asked and an older saved list stands", async () => {
  const stale = found(0, ["Tricky"]);
  const dj = phone(stale, new Error("never asked"), false);
  assert.deepEqual(await listed(readDjSimilar(dj.ports)), ["Tricky"]);
  assert.deepEqual(dj.asked, []);
  assert.equal(await readDjSimilar(phone(null, new Error("never asked"), false).ports), null);
});

test("a read that fails gives what was saved, or nothing", async () => {
  const stale = found(0, ["Tricky"]);
  const dj = phone(stale, new Error("timed out"));
  assert.deepEqual(await listed(readDjSimilar(dj.ports)), ["Tricky"]);
  assert.deepEqual(dj.asked, [stale]);
  assert.equal(await readDjSimilar(phone(null, new Error("timed out")).ports), null);
});

test("a saved answer that can't be read counts as none", async () => {
  const dj = phone(null, found(10 * DAY, ["Lamb"]));
  const ports = { ...dj.ports, saved: () => Promise.reject(new Error("database")) };
  assert.deepEqual(await listed(readDjSimilar(ports)), ["Lamb"]);
});
