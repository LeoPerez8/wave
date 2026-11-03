import assert from "node:assert/strict";
import { test } from "node:test";
import type { ReleaseAnswer } from "@wave/core";
import { releaseAnswerStore } from "./releaseAnswerStore.ts";

const found: ReleaseAnswer = { date: "1985-06", source: "first-release", retryAt: null };
const failed: ReleaseAnswer = { date: null, source: "failed", retryAt: 123456789 };
const phone = (legacy: Record<string, ReleaseAnswer> = {}) => {
  const data = new Map([["releaseDates.answers", JSON.stringify(legacy)]]);
  const writes: string[] = [];
  return {
    data,
    writes,
    getItemSync: (key: string) => data.get(key) ?? null,
    getAllKeysSync: () => [...data.keys()],
    setItemSync: (key: string, value: string) => {
      writes.push(value);
      data.set(key, value);
    },
    removeItemSync: (key: string) => {
      data.delete(key);
    },
  };
};

test("one answer writes only that answer with 20,000 stored answers", () => {
  const storage = phone(
    Object.fromEntries(Array.from({ length: 20_000 }, (_, i) => [`song${i}`, found])),
  );
  const store = releaseAnswerStore(storage);
  assert.equal(Object.keys(store.get()).length, 20_000);
  storage.writes.length = 0;
  store.put("new song", failed);
  assert.equal(storage.writes.length, 1);
  assert.ok(storage.writes[0]!.length < 150);
  assert.deepEqual(releaseAnswerStore(storage).get()["new song"], failed);
});

test("migration keeps dates and retry deadlines; removal survives restart", () => {
  const storage = phone({ found, failed });
  const store = releaseAnswerStore(storage);
  assert.deepEqual(store.get(), { found, failed });
  assert.equal(storage.data.has("releaseDates.answers"), false);
  store.remove("found");
  store.put("download", found);
  assert.deepEqual(releaseAnswerStore(storage).get(), { failed, download: found });
});

test("failed writes leave memory and subscribers unchanged", () => {
  const storage = phone();
  const store = releaseAnswerStore(storage);
  store.get();
  let changes = 0;
  store.subscribe(() => changes++);
  storage.setItemSync = () => {
    throw new Error("disk full");
  };
  assert.throws(() => store.put("song", found), /disk full/);
  assert.deepEqual(store.get(), {});
  assert.equal(changes, 0);
});

test("migration resumes after a storage failure without dropping old answers", () => {
  const storage = phone({ found, failed });
  const write = storage.setItemSync;
  let writes = 0;
  storage.setItemSync = (key, value) => {
    if (++writes === 2) throw new Error("interrupted");
    write(key, value);
  };
  assert.throws(() => releaseAnswerStore(storage).get(), /interrupted/);
  assert.equal(storage.data.has("releaseDates.answers"), true);
  storage.setItemSync = write;
  assert.deepEqual(releaseAnswerStore(storage).get(), { found, failed });
  assert.equal(storage.data.has("releaseDates.answers"), false);
});

test("readers receive a new snapshot and can unsubscribe", () => {
  const store = releaseAnswerStore(phone());
  const before = store.get();
  let changes = 0;
  const unsubscribe = store.subscribe(() => changes++);
  store.put("song", found);
  assert.deepEqual(before, {});
  assert.deepEqual(store.get(), { song: found });
  assert.equal(changes, 1);
  unsubscribe();
  store.remove("song");
  assert.equal(changes, 1);
});
