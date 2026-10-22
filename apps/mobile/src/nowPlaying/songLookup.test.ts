import assert from "node:assert/strict";
import { test } from "node:test";
import { createNowPlayingSongLookup, type PlayingSongTarget } from "./songLookup.ts";

const target: PlayingSongTarget = {
  trackId: "yt:one",
  song: {
    videoId: "one",
    title: "One",
    artists: ["Artist"],
    album: null,
    durationMs: 180000,
    artworkUrl: null,
    explicit: false,
  },
};
const answer = { track: null, favorite: false, pendingFavorite: false };

test("opening and several consumers acquire no data until settled, then share one answer", async () => {
  let reads = 0;
  const lookup = createNowPlayingSongLookup({
    read: async () => {
      reads++;
      return answer;
    },
  });
  lookup.update(target, true, false);
  assert.equal(lookup.get(target), undefined);
  assert.equal(lookup.get(target), undefined);
  await Promise.resolve();
  assert.equal(reads, 0);
  lookup.update(target, true, true);
  assert.deepEqual(await Promise.all([lookup.acquire(target), lookup.acquire(target)]), [
    answer,
    answer,
  ]);
  assert.equal(reads, 1);
  assert.equal(lookup.get(target), answer);
});

const deferred = <T>() => {
  let resolve!: (answer: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
};

test("closing before the scheduled read cancels it; reopening does not publish the cancelled result", async () => {
  let reads = 0;
  const first = deferred<typeof answer>();
  const lookup = createNowPlayingSongLookup({
    read: async () => {
      reads++;
      return reads === 1 ? first.promise : { ...answer, favorite: true, pendingFavorite: false };
    },
  });
  lookup.update(target, true, true);
  lookup.update(target, false, false);
  await Promise.resolve();
  assert.equal(reads, 0);
  lookup.update(target, true, true);
  await Promise.resolve();
  lookup.update(target, false, false);
  lookup.update(target, true, false);
  first.resolve(answer);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lookup.get(target), undefined);
  lookup.update(target, true, true);
  assert.equal((await lookup.acquire(target)).favorite, true);
  assert.equal(reads, 2);
});

test("a relevant edit during acquisition discards its stale answer and unrelated ids do not refresh a local song", async () => {
  const local = { trackId: "7", song: null };
  const first = deferred<typeof answer>();
  let reads = 0;
  const lookup = createNowPlayingSongLookup({
    read: async () => {
      reads++;
      return reads === 1 ? first.promise : { ...answer, favorite: true, pendingFavorite: false };
    },
  });
  lookup.update(local, true, true);
  const action = lookup.acquire(local);
  await Promise.resolve();
  lookup.change({ kind: "favorites", ids: [7] });
  first.resolve(answer);
  assert.equal((await action).favorite, true);
  assert.equal(reads, 2);
  lookup.change({ kind: "tracks", ids: [8] });
  lookup.change({ kind: "favorites", ids: [8] });
  lookup.change({ kind: "plays", ids: [7] });
  await Promise.resolve();
  assert.equal(reads, 2);
  lookup.update(local, false, false);
  lookup.change({ kind: "tracks", ids: [7] });
  await Promise.resolve();
  assert.equal(reads, 2);
  lookup.update(local, true, false);
  assert.equal(reads, 2);
  lookup.update(local, true, true);
  await lookup.acquire(local);
  assert.equal(reads, 3);
});
