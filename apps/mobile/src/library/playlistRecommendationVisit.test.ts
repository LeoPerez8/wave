import assert from "node:assert/strict";
import test from "node:test";
import * as Effect from "effect/Effect";
import { playlistRecommendationSession } from "@wave/core";
import { settledTurn } from "../lib/settledWork.ts";
import { followPlaylistRecommendations } from "./playlistRecommendationVisit.ts";
import { onLibraryChange, publishLibraryChange } from "./libraryChanges.ts";

const tick = async () => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

test("background writes let a running recommendation read finish, then coalesce into one catch-up", async () => {
  const release = Promise.withResolvers<void>();
  let signal: AbortSignal | undefined;
  let reads = 0;
  const session = playlistRecommendationSession({
    newId: () => "id",
    read: async (current) => {
      if (++reads === 1) {
        signal = current;
        await release.promise;
      }
      current?.throwIfAborted();
      return { playlist: [], sources: { library: [], catalog: [], graph: null, now: 0 } };
    },
    dismiss: async () => {},
  });
  const visit = followPlaylistRecommendations(session, {
    playlistId: 7,
    sight: { visible: () => true, subscribe: () => () => {} },
    start: async () => {},
    subscribe: onLibraryChange,
    wait: async () => {},
  });
  try {
    await tick();
    assert.ok(signal);
    for (let i = 0; i < 20; i++) publishLibraryChange({ kind: "tracks", burst: true });
    assert.equal(signal.aborted, false, "bursts must not restart the recommendation deadline");
    release.resolve();
    await tick();
    await tick();
    assert.equal(reads, 2, "one completed read and one catch-up after all writes");
    assert.equal(session.get().loading, false);
    assert.equal(session.get().error, null);
  } finally {
    release.resolve();
    visit.dispose();
  }
});
const setup = () => {
  let visible = true,
    settled = false;
  const listeners = new Set<() => void>();
  const turns = new Set<() => void>();
  const sight = {
    visible: () => visible,
    subscribe: (f: () => void) => {
      listeners.add(f);
      return () => {
        listeners.delete(f);
      };
    },
  };
  const start = settledTurn({
    settled: () => settled,
    subscribe: sight.subscribe,
    schedule: (f) => {
      turns.add(f);
      return () => {
        turns.delete(f);
      };
    },
  });
  return {
    sight,
    start,
    listeners,
    turns,
    show: (value: boolean) => {
      visible = value;
      for (const f of listeners) f();
    },
    settle: () => {
      settled = true;
      for (const f of listeners) f();
    },
    flush: async () => {
      await tick();
      for (const f of turns) {
        turns.delete(f);
        f();
      }
      await tick();
    },
  };
};

test("opening, hidden bursts and return obey visibility and settlement, coalescing to one renewal", async () => {
  const gate = setup();
  let reads = 0,
    ranks = 0,
    notifications = 0;
  const session = playlistRecommendationSession({
    newId: () => "id",
    read: async () => {
      reads++;
      return { playlist: [], sources: { library: [], catalog: [], graph: null, now: 0 } };
    },
    rank: async () => {
      ranks++;
      return [];
    },
    dismiss: async () => {},
  });
  session.subscribe(() => notifications++);
  const visit = followPlaylistRecommendations(session, {
    playlistId: 7,
    sight: gate.sight,
    start: (signal) => Effect.runPromise(gate.start, { signal }),
    subscribe: onLibraryChange,
    wait: async () => {},
  });
  await gate.flush();
  assert.deepEqual([reads, ranks, notifications], [0, 0, 0]);
  gate.show(false);
  gate.settle();
  for (let i = 0; i < 12; i++)
    publishLibraryChange({ kind: i % 2 ? "tracks" : "favorites", burst: true });
  await gate.flush();
  assert.deepEqual([reads, ranks, notifications], [0, 0, 0]);
  gate.show(true);
  await gate.flush();
  assert.deepEqual([reads, ranks, notifications], [1, 1, 3]);
  publishLibraryChange({ kind: "playlists", ids: [99] });
  await gate.flush();
  assert.equal(reads, 1);
  for (let i = 0; i < 12; i++) publishLibraryChange({ kind: "tracks", burst: true });
  await gate.flush();
  assert.equal(reads, 2);
  visit.dispose();
  publishLibraryChange({ kind: "tracks" });
  gate.show(false);
  gate.show(true);
  await gate.flush();
  assert.equal(reads, 2);
  assert.equal(gate.listeners.size, 0);
});

test("a newer invalidation cancels in-flight work; hidden cancellation publishes no obsolete answer", async () => {
  const gate = setup();
  gate.settle();
  const first = Promise.withResolvers<void>();
  const ready = Promise.withResolvers<void>();
  let reads = 0,
    notifications = 0;
  const session = playlistRecommendationSession({
    newId: () => "id",
    read: async (signal) => {
      if (++reads === 1) {
        ready.resolve();
        await first.promise;
      }
      signal?.throwIfAborted();
      return { playlist: [], sources: { library: [], catalog: [], graph: null, now: 0 } };
    },
    dismiss: async () => {},
  });
  session.subscribe(() => notifications++);
  const visit = followPlaylistRecommendations(session, {
    playlistId: 7,
    sight: gate.sight,
    start: (signal) => Effect.runPromise(gate.start, { signal }),
    subscribe: onLibraryChange,
    wait: async () => {},
  });
  await gate.flush();
  await ready.promise;
  publishLibraryChange({ kind: "playlists", ids: [7] });
  gate.show(false);
  const heard = notifications;
  first.resolve();
  await gate.flush();
  assert.equal(notifications, heard);
  gate.show(true);
  await gate.flush();
  assert.equal(reads, 2);
  assert.equal(session.get().error, null);
  assert.equal(session.get().loading, false);
  visit.dispose();
  // Effect cleanup/re-setup (also React StrictMode) can reuse the same visit session.
  const again = followPlaylistRecommendations(session, {
    playlistId: 7,
    sight: gate.sight,
    start: (signal) => Effect.runPromise(gate.start, { signal }),
    subscribe: onLibraryChange,
  });
  await gate.flush();
  assert.equal(reads, 3);
  again.dispose();
});

test("successive visible bursts share the existing throttle window and an urgent edit cancels it", async () => {
  const gate = setup();
  gate.settle();
  let reads = 0,
    clock = 0;
  const waits: { ms: number; signal: AbortSignal; release: () => void }[] = [];
  const session = playlistRecommendationSession({
    newId: () => "id",
    read: async () => {
      reads++;
      return { playlist: [], sources: { library: [], catalog: [], graph: null, now: 0 } };
    },
    dismiss: async () => {},
  });
  const visit = followPlaylistRecommendations(session, {
    playlistId: 7,
    sight: gate.sight,
    start: (signal) => Effect.runPromise(gate.start, { signal }),
    subscribe: onLibraryChange,
    now: () => clock,
    wait: (ms, signal) =>
      new Promise<void>((resolve, reject) => {
        waits.push({ ms, signal, release: resolve });
        signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true });
      }),
  });
  await gate.flush();
  assert.equal(reads, 1);
  clock = 100;
  for (let i = 0; i < 20; i++) publishLibraryChange({ kind: "tracks", burst: true });
  await tick();
  assert.equal(waits.length, 1);
  assert.equal(waits[0]!.ms, 1400);
  assert.equal(reads, 1);
  clock = 1500;
  waits[0]!.release();
  await gate.flush();
  assert.equal(reads, 2);
  clock = 1600;
  publishLibraryChange({ kind: "tracks", burst: true });
  await tick();
  assert.equal(waits.length, 2);
  publishLibraryChange({ kind: "favorites" });
  await gate.flush();
  assert.equal(waits[1]!.signal.aborted, true);
  assert.equal(reads, 3);
  visit.dispose();
});

test("return renews an action interrupted after an external invalidation was queued during its save", async () => {
  const gate = setup();
  gate.settle();
  const saved = Promise.withResolvers<void>();
  let reads = 0,
    sequence = 0;
  const track = (id: string) => ({
    id,
    source: "library" as const,
    videoId: "",
    title: id,
    artists: ["Artist"],
    album: null,
    albumId: null,
    durationMs: 1000,
    artworkUrl: null,
    explicit: false,
    genre: "Rock",
  });
  const session = playlistRecommendationSession({
    newId: () => String(++sequence),
    read: async (signal) => {
      signal?.throwIfAborted();
      reads++;
      return {
        playlist: [track("seed")],
        sources: { library: "abcdefg".split("").map(track), catalog: [], graph: null, now: 0 },
      };
    },
    dismiss: async () => {},
    accept: async () => saved.promise,
  });
  const visit = followPlaylistRecommendations(session, {
    playlistId: 7,
    sight: gate.sight,
    start: (signal) => Effect.runPromise(gate.start, { signal }),
    subscribe: onLibraryChange,
  });
  await gate.flush();
  const offered = session.get().slots[0]!;
  const action = session.accept(offered.key);
  publishLibraryChange({ kind: "playlists", ids: [7] });
  await gate.flush();
  gate.show(false);
  saved.resolve();
  await action;
  gate.show(true);
  await gate.flush();
  assert.equal(reads, 2);
  assert.equal(
    session.get().slots.some((x) => x?.track.id === offered.track.id),
    false,
  );
  assert.equal(session.get().pending, null);
  assert.equal(session.get().loading, false);
  visit.dispose();
});

test("counted plays alone renew nothing, as before #599", async () => {
  const gate = setup();
  gate.settle();
  let reads = 0;
  const session = playlistRecommendationSession({
    newId: () => "id",
    read: async () => {
      reads++;
      return { playlist: [], sources: { library: [], catalog: [], graph: null, now: 0 } };
    },
    dismiss: async () => {},
  });
  const visit = followPlaylistRecommendations(session, {
    playlistId: 7,
    sight: gate.sight,
    start: (signal) => Effect.runPromise(gate.start, { signal }),
    subscribe: onLibraryChange,
    wait: async () => {},
  });
  await gate.flush();
  assert.equal(reads, 1);
  publishLibraryChange({ kind: "plays", ids: [1], burst: true });
  publishLibraryChange({ kind: "plays" });
  await gate.flush();
  assert.equal(reads, 1);
  visit.dispose();
});

test("graph source writes coalesce under the burst throttle and are released on dispose", async () => {
  const gate = setup();
  gate.settle();
  let reads = 0,
    clock = 0;
  const graphListeners = new Set<() => void>();
  const waits: { ms: number; release: () => void }[] = [];
  const session = playlistRecommendationSession({
    newId: () => "id",
    read: async () => {
      reads++;
      return { playlist: [], sources: { library: [], catalog: [], graph: null, now: 0 } };
    },
    dismiss: async () => {},
  });
  const visit = followPlaylistRecommendations(session, {
    playlistId: 7,
    sight: gate.sight,
    start: (signal) => Effect.runPromise(gate.start, { signal }),
    subscribe: onLibraryChange,
    graphSources: (listener) => {
      graphListeners.add(listener);
      return () => {
        graphListeners.delete(listener);
      };
    },
    now: () => clock,
    wait: (ms) => new Promise<void>((resolve) => waits.push({ ms, release: resolve })),
  });
  await gate.flush();
  assert.equal(reads, 1);
  clock = 500;
  // A harvest saves several catalog/similar pages in a row.
  for (let i = 0; i < 6; i++) for (const f of graphListeners) f();
  await gate.flush();
  assert.equal(waits.length, 1);
  assert.equal(waits[0]!.ms, 1000);
  assert.equal(reads, 1);
  clock = 1500;
  waits[0]!.release();
  await gate.flush();
  assert.equal(reads, 2);
  visit.dispose();
  assert.equal(graphListeners.size, 0);
});

test("a burst landing while a finished renewal leaves the queue still renews, and so do later ones", async () => {
  // The visit drops its job handle a few microtasks before the serial queue
  // releases the job; an invalidation in that gap must not wedge renewal.
  for (let gap = 0; gap <= 6; gap++) {
    let renews = 0;
    let emit: ((change: { kind: "tracks"; burst: true }) => void) | undefined;
    const session = {
      resume: () => {},
      pause: () => {},
      get: () => ({ pending: null, loading: false }),
      renew: async () => {
        renews++;
        if (renews === 1)
          void (async () => {
            for (let i = 0; i < gap; i++) await Promise.resolve();
            emit?.({ kind: "tracks", burst: true });
          })();
      },
    } as unknown as Parameters<typeof followPlaylistRecommendations>[0];
    const visit = followPlaylistRecommendations(session, {
      playlistId: 1,
      sight: { visible: () => true, subscribe: () => () => {} },
      start: async () => {},
      subscribe: (listener) => {
        emit = listener;
        return () => {};
      },
      now: () => 1e9,
      wait: async () => {},
    });
    await tick();
    await tick();
    emit?.({ kind: "tracks", burst: true });
    await tick();
    await tick();
    assert.equal(renews, 3, `gap of ${gap} microtasks`);
    visit.dispose();
  }
});
