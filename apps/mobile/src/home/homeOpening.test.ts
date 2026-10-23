import assert from "node:assert/strict";
import test from "node:test";
import * as Effect from "effect/Effect";
import { createLibraryQueries } from "@wave/core";
import { fileURLToPath } from "node:url";

import { loadLibraryStore } from "../../bench/fastAgain/store.ts";
import { createFastAgainFixture } from "../library/db/fastAgainFixture.ts";
import {
  addTrack,
  closeTestDatabase,
  openTestDatabase,
  traceQueries,
} from "../library/db/testDatabase.ts";
import {
  afterHomeFrame,
  homeContent,
  homeOpeningState,
  homeSectionWaiting,
  homeBodyHeight,
  magicQueueGrid,
} from "./homeOpening.ts";
import type { HomeContent } from "./homeOpening.ts";
import type { HomePlays, HomeSections } from "../library/db/playHistory.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));

test("Home's shared queries publish each real slice without waiting for its neighbours", async () => {
  const { homeReads } = await import("../library/homeReads.ts");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const pending = new Map<string, () => void>();
    const definitions = Object.values(homeReads);
    const registry = createLibraryQueries<HomeContent>({
      now: () => fixture.now,
      schedule: () => () => {},
      read: (key, settle) => {
        pending.set(key, () => {
          pending.delete(key);
          const definition = definitions.find((query) => query.key === key)!;
          settle({ ok: true, value: Effect.runSync<HomeContent, unknown>(definition.read(store)) });
        });
      },
    });
    const snapshot = () =>
      homeContent(
        registry.current(homeReads.added.key)?.value as
          Pick<HomeSections, "recentlyAdded"> | undefined,
        registry.current(homeReads.plays.key)?.value as HomePlays | undefined,
        registry.current(homeReads.favorites.key)?.value as
          Pick<HomeSections, "favorites"> | undefined,
      );
    const shown: HomeContent[] = [];
    const frames: (() => void)[] = [];
    const initial = traceQueries(fixture.db, () => {
      afterHomeFrame(
        () => {
          for (const { key, reads } of definitions)
            registry.attach(key, reads, { visible: true, onChange: () => shown.push(snapshot()) });
        },
        { request: (run) => frames.push(run), cancel: () => {} },
      );
      frames.shift()!();
    });
    assert.equal(initial.queries.length, 0);
    assert.equal(pending.size, 0);
    assert.equal(traceQueries(fixture.db, () => frames.shift()!()).queries.length, 0);
    const favorites = traceQueries(fixture.db, () => pending.get(homeReads.favorites.key)!());
    assert.deepEqual(
      favorites.queries.map((query) => query.rows),
      [10],
    );
    assert.equal(shown.at(-1)?.favorites?.length, 10);
    assert.equal(shown.at(-1)?.recentlyAdded, undefined);
    assert.equal(shown.at(-1)?.mostPlayed, undefined);
    assert.equal(homeOpeningState(snapshot()).played, undefined);
    const plays = traceQueries(fixture.db, () => pending.get(homeReads.plays.key)!());
    assert.equal(plays.queries.length, 3);
    assert.equal(
      plays.queries.reduce((sum, query) => sum + query.rows, 0),
      70,
    );
    assert.equal(shown.at(-1)?.mostPlayed?.length, 10);
    // Discover must distinguish an unanswered plays query from a genuinely unplayed Library.
    assert.equal(homeOpeningState(snapshot()).played, true);
    assert.equal(shown.at(-1)?.recentlyAdded, undefined);
    registry.change({ kind: "favorites" });
    assert.deepEqual([...pending.keys()].sort(), ["home:added", "home:favorites"]);
    const added = traceQueries(fixture.db, () => pending.get(homeReads.added.key)!());
    assert.equal(added.queries.length, 2);
    assert.equal(
      added.queries.reduce((sum, query) => sum + query.rows, 0),
      24,
    );
    assert.equal(shown.at(-1)?.recentlyAdded?.length, 12);
  } finally {
    fixture.close();
  }
});

test("Home paints its skeleton frame before starting any of its real section reads", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const frames = new Map<number, () => void>();
    let next = 0;
    let content = homeContent(undefined, undefined, undefined);
    const paint = () => {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((run) => run());
    };
    const initial = traceQueries(fixture.db, () =>
      afterHomeFrame(
        () => {
          content = homeContent(Effect.runSync(store.homeAdded), undefined, undefined);
        },
        {
          request: (run) => {
            frames.set(++next, run);
            return next;
          },
          cancel: (id) => {
            frames.delete(id);
          },
        },
      ),
    );
    assert.equal(initial.queries.length, 0);
    assert.equal(homeOpeningState(content).ready, false);
    assert.equal(traceQueries(fixture.db, paint).queries.length, 0);
    const ownRead = traceQueries(fixture.db, paint);
    assert.equal(ownRead.queries.length, 2);
    assert.equal(
      ownRead.queries.reduce((sum, q) => sum + q.rows, 0),
      24,
    );
    assert.equal(content.recentlyAdded?.length, 12);
    assert.equal(content.recentlyPlayed, undefined);
    assert.equal(content.favorites, undefined);
    assert.equal(homeOpeningState(content).ready, true);
  } finally {
    fixture.close();
  }
});

test("Favorites and plays draw from their own reads even while Recently added has no answer", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const starred = traceQueries(fixture.db, () => Effect.runSync(store.homeFavorites));
    const first = homeContent(undefined, undefined, starred.result);
    assert.equal(starred.queries.length, 1);
    assert.equal(
      starred.queries.reduce((sum, q) => sum + q.rows, 0),
      10,
    );
    assert.equal(first.favorites?.length, 10);
    assert.equal(homeSectionWaiting("favorites", first), false);
    assert.equal(homeSectionWaiting("recently-added", first), true);
    assert.equal(homeSectionWaiting("recently-played", first), true);

    const played = traceQueries(fixture.db, () => Effect.runSync(store.homePlays));
    const next = homeContent(undefined, played.result, starred.result);
    assert.equal(played.queries.length, 3);
    assert.equal(
      played.queries.reduce((sum, q) => sum + q.rows, 0),
      70,
    );
    assert.equal(next.recentlyPlayed?.length, 12);
    assert.equal(next.mostPlayed?.length, 10);
    assert.equal(homeSectionWaiting("recently-played", next), false);
    assert.equal(homeSectionWaiting("most-played", next), false);
    assert.equal(homeSectionWaiting("recently-added", next), true);
    assert.strictEqual(next.favorites, first.favorites);
  } finally {
    fixture.close();
  }
});

test("first content can draw independently while settlement waits for the local slices", () => {
  const first = homeContent(undefined, undefined, { favorites: [] });
  assert.equal(homeOpeningState(first).ready, true);
  assert.equal(homeOpeningState(first).settled, false);
  const done = homeContent(
    { recentlyAdded: [] },
    { recentlyPlayed: [], mostPlayed: [] },
    { favorites: [] },
  );
  assert.equal(homeOpeningState(done).settled, true);
});

test("unanswered plays never show the first-play hint; an empty Library and unplayed Library stay distinct", async () => {
  const db = await openTestDatabase();
  try {
    const store = await loadLibraryStore(root, db);
    const blank = homeContent(undefined, undefined, undefined);
    assert.equal(homeOpeningState(blank).empty, false);
    assert.equal(homeOpeningState(blank).nothingPlayed, false);
    const empty = homeContent(Effect.runSync(store.homeAdded), undefined, undefined);
    assert.equal(homeOpeningState(empty).empty, true);
    assert.equal(homeOpeningState(empty).nothingPlayed, false);
    addTrack(db, { title: "Unplayed", artist: "A", album: "One" });
    const unplayed = homeContent(
      Effect.runSync(store.homeAdded),
      Effect.runSync(store.homePlays),
      Effect.runSync(store.homeFavorites),
    );
    assert.equal(homeOpeningState(unplayed).empty, false);
    assert.equal(homeOpeningState(unplayed).nothingPlayed, true);
    assert.equal(homeOpeningState(unplayed).played, false);
    assert.equal(homeSectionWaiting("favorites", unplayed), false);
    assert.deepEqual(unplayed.favorites, []);
  } finally {
    closeTestDatabase(db);
  }
});

test("leaving Home before either frame cancels its read-backed mount", () => {
  for (const firstPaint of [false, true]) {
    const frames = new Map<number, () => void>();
    let id = 0;
    let mounts = 0;
    const cancel = afterHomeFrame(
      () => {
        mounts++;
      },
      {
        request: (run) => {
          frames.set(++id, run);
          return id;
        },
        cancel: (key) => {
          frames.delete(key);
        },
      },
    );
    if (firstPaint) {
      const callbacks = [...frames.values()];
      frames.clear();
      callbacks.forEach((run) => run());
    }
    cancel();
    [...frames.values()].forEach((run) => run());
    assert.equal(mounts, 0);
  }
});

test("Home reserves matching shelf, list and adaptive Magic Queue dimensions at both text sizes", () => {
  for (const scale of [1, 1.3]) {
    assert.equal(homeBodyHeight("most-played", scale), 560);
    assert.equal(homeBodyHeight("favorites", scale), 560);
    assert.equal(homeBodyHeight("recently-added", scale), scale === 1 ? 200 : 212);
    assert.equal(homeBodyHeight("recently-played", scale), homeBodyHeight("recently-added", scale));
    assert.equal(
      homeBodyHeight("most-played-albums", scale),
      homeBodyHeight("recently-added", scale),
    );
    assert.equal(homeBodyHeight("most-played-artists", scale), scale === 1 ? 182 : 188.6);
    assert.equal(homeBodyHeight("listening-overview", scale), scale === 1 ? 124 : 160);
  }
  assert.equal(magicQueueGrid(312, 1).columns, 3);
  assert.equal(magicQueueGrid(312, Math.fround(1.3)).columns, 2);
  assert.equal(magicQueueGrid(312, 2).columns, 1);
});

test("the Magic Queue reserves all nine tile places before its saved picks answer", () => {
  assert.equal(Math.round(magicQueueGrid(312, 1).height), 456);
  assert.equal(Math.round(magicQueueGrid(312, Math.fround(1.3)).height), 1092);
});
