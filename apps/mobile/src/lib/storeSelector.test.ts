import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";

import { makeExternalStore } from "@wave/client/externalStore";
import { ytAlbumDownload, type YtDownloadJournalJob } from "@wave/core";

import { equalToDepth, selectFrom, shallowEqual, useStoreSelector } from "./storeSelector.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface Player {
  readonly position: number;
  readonly shuffle: boolean;
  readonly queue: readonly string[];
}

const shuffleOf = (player: Player) => player.shuffle;
const upNextOf = (player: Player) => player.queue.slice(1);
const wholeOf = (player: Player) => player;

test("a component re-renders only when the slice it selects changes", async () => {
  const store = makeExternalStore<Player>({ position: 0, shuffle: false, queue: ["a", "b"] });
  const rendered: string[] = [];
  const renders = () => ({
    shuffle: rendered.filter((name) => name === "shuffle").length,
    whole: rendered.filter((name) => name === "whole").length,
  });
  const Shuffle = () => {
    rendered.push("shuffle");
    return String(useStoreSelector(store, shuffleOf));
  };
  const Whole = () => {
    rendered.push("whole");
    return String(useStoreSelector(store, wholeOf).position);
  };
  let renderer: ReturnType<typeof create> | undefined;
  await act(() => {
    renderer = create(createElement("view", null, createElement(Shuffle), createElement(Whole)));
  });
  for (let tick = 1; tick <= 10; tick++) {
    await act(() => store.update((player) => ({ ...player, position: tick })));
  }
  assert.deepEqual(renders(), { shuffle: 1, whole: 11 }, "position ticks skip the shuffle button");
  await act(() => store.update((player) => ({ ...player, shuffle: true })));
  assert.equal(renders().shuffle, 2);
  assert.deepEqual(renderer!.toJSON(), { type: "view", props: {}, children: ["true", "10"] });
  await act(() => renderer!.unmount());
  assert.equal(store.listenerCount(), 0);
});

test("a derived slice re-renders only when it differs by the given equality", async () => {
  const store = makeExternalStore<Player>({ position: 0, shuffle: false, queue: ["a", "b", "c"] });
  let renders = 0;
  const UpNext = () => {
    renders++;
    return useStoreSelector(store, upNextOf, shallowEqual).join(",");
  };
  let renderer: ReturnType<typeof create> | undefined;
  await act(() => {
    renderer = create(createElement(UpNext));
  });
  // A new queue array with the same songs after the first is the same slice.
  await act(() => store.update((player) => ({ ...player, queue: ["z", "b", "c"] })));
  await act(() => store.update((player) => ({ ...player, position: 5 })));
  assert.equal(renders, 1);
  await act(() => store.update((player) => ({ ...player, queue: ["z", "c"] })));
  assert.equal(renders, 2);
  assert.equal(renderer!.toJSON(), "c");
  await act(() => renderer!.unmount());
});

test("selectFrom hands useSyncExternalStore a stable slice between changes", () => {
  const store = makeExternalStore<Player>({ position: 0, shuffle: false, queue: ["a", "b"] });
  const upNext = selectFrom(store, upNextOf, shallowEqual);
  const first = upNext.get();
  assert.equal(upNext.get(), first, "the same source gives the same slice");
  store.update((player) => ({ ...player, position: 1 }));
  assert.equal(upNext.get(), first, "an equal slice keeps the earlier one");
  store.update((player) => ({ ...player, queue: ["a", "c"] }));
  assert.deepEqual(upNext.get(), ["c"]);
  assert.equal(upNext.subscribe, store.subscribe);
});

test("shallowEqual compares arrays and plain objects one level deep", () => {
  assert.ok(shallowEqual([1, "a"], [1, "a"]));
  assert.ok(!shallowEqual([1], [1, 2]));
  assert.ok(shallowEqual({ a: 1, b: null }, { b: null, a: 1 }));
  assert.ok(!shallowEqual({ a: 1 }, { a: 1, b: undefined }));
  assert.ok(!shallowEqual({ a: [] }, { a: [] }));
  assert.ok(shallowEqual(null, null));
  assert.ok(!shallowEqual(null, {}));
});

test("equalToDepth compares nested arrays and plain objects down to the given depth", () => {
  const song = { id: 1 };
  const same = equalToDepth(3);
  assert.ok(
    same(
      { items: [{ song, shared: null }], line: "x" },
      { items: [{ song, shared: null }], line: "x" },
    ),
  );
  assert.ok(
    !same({ items: [{ song, shared: null }] }, { items: [{ song: { id: 1 }, shared: null }] }),
    "leaves by identity",
  );
  assert.ok(!same({ items: [{ song, shared: null }] }, { items: [{ song, shared: "j" }] }));
  assert.ok(!equalToDepth(1)({ items: [] }, { items: [] }));
});

test("a download progress tick leaves an album's download view, and its page, unrendered", async () => {
  const album = ["a", "b", "c"].map((videoId) => ({
    videoId,
    title: videoId,
    artists: ["Artist"],
    album: "Album",
    durationMs: 1,
    artworkUrl: null,
    explicit: false,
  }));
  const job = (videoId: string, received: number): YtDownloadJournalJob => ({
    id: videoId,
    song: album.find((song) => song.videoId === videoId)!,
    phase: "transferring",
    received,
    total: 100,
  });
  const journal = makeExternalStore<readonly YtDownloadJournalJob[]>([job("a", 0)]);
  const select = (jobs: readonly YtDownloadJournalJob[]) =>
    ytAlbumDownload(album, { inLibrary: () => false, jobs });
  let renders = 0;
  const Page = () => {
    renders++;
    return useStoreSelector(journal, select, equalToDepth(3)).line;
  };
  let renderer: ReturnType<typeof create> | undefined;
  await act(() => {
    renderer = create(createElement(Page));
  });
  for (let received = 10; received <= 90; received += 10) {
    await act(() => journal.set([job("a", received)]));
  }
  assert.equal(renders, 1, "bytes received change no line or action");
  await act(() => journal.set([job("a", 100), job("b", 0)]));
  assert.equal(renders, 2, "a second song joining does");
  await act(() => renderer!.unmount());
});
