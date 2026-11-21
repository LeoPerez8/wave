import assert from "node:assert/strict";
import { test } from "node:test";

import { isDisliked } from "@wave/core";

import { createDislikeSet, type DislikeSetPorts } from "./dislikeSet.ts";

const song = (key: string) => ({ key, title: key, artists: ["Artist"], durationMs: 1_000 });

/** A store of dislikes and Tracks in memory, whose writes can be made to fail. */
const store = (kept: string[] = [], tracks: { id: number; videoId: string }[] = []) => {
  const state = { kept: new Set(kept), tracks, fail: false, learned: [] as string[] };
  const ports: DislikeSetPorts = {
    read: async () => ({ keys: [...state.kept], tracks: state.tracks }),
    keep: async (songs) => {
      if (state.fail) throw new Error("disk full");
      for (const { key } of songs) state.kept.add(key);
    },
    forget: async (keys) => {
      if (state.fail) throw new Error("disk full");
      for (const key of keys) state.kept.delete(key);
    },
    disliked: (songs) => state.learned.push(...songs.map(({ key }) => `+${key}`)),
    undisliked: (keys) => state.learned.push(...keys.map((key) => `-${key}`)),
  };
  return { state, set: createDislikeSet(ports) };
};

test("a song disliked while streamed reads disliked as the Library song it is by now", async () => {
  const { set } = store(["yt:abc"], [{ id: 42, videoId: "abc" }]);
  await set.load();
  assert.equal(isDisliked(set.now(), { id: 42 }), true);
  assert.equal(set.now().has("42"), true);
  assert.equal(set.count(), 1);
});

test("removing the dislike by the Library song forgets the key it is kept under", async () => {
  const { set, state } = store(["yt:abc"], [{ id: 42, videoId: "abc" }]);
  await set.load();
  await set.forget(["42"]);
  assert.deepEqual([...state.kept], []);
  assert.equal(set.now().size, 0);
});

test("a removal asked before the dislikes are read still finds the song's other key", async () => {
  const { set, state } = store(["yt:abc"], [{ id: 42, videoId: "abc" }]);
  await set.forget(["42"]);
  assert.deepEqual([...state.kept], []);
});

test("a dislike kept with its Track answers under the Track id at once", async () => {
  const { set, state } = store();
  await set.load();
  const saved = set.keep([song("yt:abc")], [{ id: 42, videoId: "abc" }]);
  assert.equal(set.now().has("42"), true);
  assert.equal(set.now().has("yt:abc"), true);
  await saved;
  assert.deepEqual([...state.kept], ["yt:abc"]);
});

test("a download landing makes its disliked video's Track read disliked", async () => {
  const { set, state } = store(["yt:abc"]);
  await set.load();
  assert.equal(set.now().has("42"), false);
  state.tracks = [{ id: 42, videoId: "abc" }];
  await set.tracksChanged();
  assert.equal(set.now().has("42"), true);
});

test("a dislike the store removed itself leaves the set under every key", async () => {
  const { set } = store(["yt:abc", "7"], [{ id: 42, videoId: "abc" }]);
  await set.load();
  set.dropped(["yt:abc"]);
  assert.deepEqual([...set.now()], ["7"]);
  assert.equal(set.count(), 1);
});

test("a re-read that changes nothing keeps the same set, so nothing following it runs", async () => {
  const { set } = store(["yt:abc"], [{ id: 42, videoId: "abc" }]);
  await set.load();
  const before = set.now();
  let changes = 0;
  set.onChanged(() => changes++);
  await set.reload();
  assert.equal(set.now(), before);
  assert.equal(changes, 0);
});

test("a dislike that fails to save rejects, is put back and is unlearned", async () => {
  const { set, state } = store();
  await set.load();
  let saves = 0;
  set.onSaved(() => saves++);
  state.fail = true;
  await assert.rejects(set.keep([song("yt:abc")]), /disk full/);
  assert.equal(set.now().has("yt:abc"), false);
  assert.deepEqual(state.learned, ["+yt:abc", "-yt:abc"]);
  assert.equal(saves, 0);
});

test("a removal that fails to save rejects, is put back and isn't announced", async () => {
  const { set, state } = store(["yt:abc"]);
  await set.load();
  state.fail = true;
  await assert.rejects(set.forget(["yt:abc"]), /disk full/);
  assert.equal(set.now().has("yt:abc"), true);
  assert.deepEqual(state.learned, []);
});

test("a saved change is announced: the removal after its write", async () => {
  const { set, state } = store();
  await set.load();
  let saves = 0;
  set.onSaved(() => saves++);
  await set.keep([song("7")]);
  await set.forget(["7"]);
  assert.deepEqual(state.learned, ["+7", "-7"]);
  assert.equal(saves, 2);
});
