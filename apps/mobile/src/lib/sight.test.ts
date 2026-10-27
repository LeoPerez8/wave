import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create } from "react-test-renderer";
import { createLibraryQueries, type LibraryChange } from "@wave/core";

import { makeExternalStore } from "./externalStore.ts";
import {
  attachInSight,
  sightOf,
  useStoreInSight,
  type ScreenSight,
  type SightCondition,
} from "./sight.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/** A condition the test turns on and off (focus, the app in front). */
const condition = (initial: boolean) => {
  const listeners = new Set<(holds: boolean) => void>();
  let holds = initial;
  const value: SightCondition = {
    holds: () => holds,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  return {
    condition: value,
    set: (next: boolean) => {
      holds = next;
      for (const listener of listeners) listener(next);
    },
    listeners: () => listeners.size,
  };
};

test("a focused screen goes out of sight while the app is in the background, and back on return", () => {
  const focused = condition(true);
  const app = condition(true);
  const sight = sightOf(focused.condition, app.condition);
  const seen: boolean[] = [];
  const stop = sight.subscribe((visible) => seen.push(visible));

  app.set(false);
  assert.equal(sight.visible(), false);
  focused.set(false);
  focused.set(true);
  app.set(true);
  assert.equal(sight.visible(), true);
  assert.deepEqual(seen, [false, true]);

  stop();
  assert.equal(focused.listeners() + app.listeners(), 0);
});

/** Core's shared queries with a hand-run clock, counting reads. */
const queries = () => {
  let time = 0;
  const timers: { at: number; run: () => void }[] = [];
  const reads: string[] = [];
  const registry = createLibraryQueries<number>({
    now: () => time,
    schedule: (ms, run) => {
      const timer = { at: time + ms, run };
      timers.push(timer);
      return () => {
        const index = timers.indexOf(timer);
        if (index >= 0) timers.splice(index, 1);
      };
    },
    read: (key, settle) => {
      reads.push(key);
      settle({ ok: true, value: reads.length });
    },
  });
  const advance = (ms: number) => {
    time += ms;
    for (const timer of timers.filter((t) => t.at <= time)) {
      timers.splice(timers.indexOf(timer), 1);
      timer.run();
    }
  };
  return { registry, reads, advance };
};

const PLAY: LibraryChange = { kind: "plays", burst: true };

test("a focused screen's queries don't re-read on plays while the app is in the background, and read once on return", () => {
  const { registry, reads, advance } = queries();
  const app = condition(true);
  const sight = sightOf(condition(true).condition, app.condition);
  let changes = 0;
  const detach = attachInSight(registry, "homePlays", { plays: true }, sight, () => changes++);
  assert.deepEqual(reads, ["homePlays"]);

  app.set(false);
  for (let play = 0; play < 5; play++) {
    registry.change(PLAY);
    advance(2000);
  }
  assert.deepEqual(reads, ["homePlays"]);

  const before = changes;
  app.set(true);
  advance(2000);
  assert.deepEqual(reads, ["homePlays", "homePlays"]);
  assert.equal(changes - before, 1);

  detach();
});

/** A component following [store] through [sight], counting its renders. */
const follower = <A>(
  sight: ScreenSight | null,
  store: { subscribe: (onChange: () => void) => () => void; get: () => A },
) => {
  const rendered: A[] = [];
  const Follower = () => {
    rendered.push(useStoreInSight(sight, store.subscribe, store.get));
    return null;
  };
  let root: ReturnType<typeof create>;
  act(() => {
    root = create(createElement(Follower));
  });
  return { rendered, unmount: () => act(() => root.unmount()) };
};

test("a hidden screen doesn't re-render on a song change, a star or scan progress, and catches up once", () => {
  const focused = condition(true);
  const sight = sightOf(focused.condition);
  const playing = makeExternalStore("song 1");
  const stars = makeExternalStore<ReadonlySet<number>>(new Set());
  const scan = makeExternalStore({ status: "scanning", filesRead: 0 });
  const followers = [follower(sight, playing), follower(sight, stars), follower(sight, scan)];

  act(() => focused.set(false));
  const counts = followers.map((f) => f.rendered.length);
  act(() => {
    playing.set("song 2");
    playing.set("song 3");
    stars.set(new Set([3]));
    for (let read = 1; read <= 10; read++) scan.set({ status: "scanning", filesRead: read });
  });
  assert.deepEqual(
    followers.map((f) => f.rendered.length),
    counts,
  );
  assert.equal(playing.listenerCount() + stars.listenerCount() + scan.listenerCount(), 0);

  act(() => focused.set(true));
  assert.deepEqual(
    followers.map((f) => f.rendered.length),
    counts.map((count) => count + 1),
  );
  assert.equal(followers[0]!.rendered.at(-1), "song 3");
  assert.deepEqual(followers[1]!.rendered.at(-1), new Set([3]));
  assert.deepEqual(followers[2]!.rendered.at(-1), { status: "scanning", filesRead: 10 });

  act(() => playing.set("song 4"));
  assert.equal(followers[0]!.rendered.at(-1), "song 4");
  for (const f of followers) f.unmount();
});

test("coming back with nothing changed renders nothing", () => {
  const focused = condition(true);
  const playing = makeExternalStore("song 1");
  const { rendered, unmount } = follower(sightOf(focused.condition), playing);
  act(() => focused.set(false));
  act(() => {
    playing.set("song 2");
    playing.set("song 1");
  });
  const count = rendered.length;
  act(() => focused.set(true));
  assert.equal(rendered.length, count);
  unmount();
});

test("a screen mounted out of sight shows the store as it is, then waits", () => {
  const focused = condition(false);
  const playing = makeExternalStore("song 1");
  const { rendered, unmount } = follower(sightOf(focused.condition), playing);
  assert.deepEqual(rendered, ["song 1"]);
  act(() => playing.set("song 2"));
  assert.deepEqual(rendered, ["song 1"]);
  act(() => focused.set(true));
  assert.deepEqual(rendered, ["song 1", "song 2"]);
  unmount();
});

test("without a sight (a bundle that keeps hidden screens following) it follows every change", () => {
  const playing = makeExternalStore("song 1");
  const { rendered, unmount } = follower(null, playing);
  act(() => playing.set("song 2"));
  assert.deepEqual(rendered, ["song 1", "song 2"]);
  unmount();
});
