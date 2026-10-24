import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import { sql } from "drizzle-orm";
import { localDay, magicQueuePicks, seededRandom, type MagicQueuePicks } from "@wave/core";
import { loadLibraryStore } from "../../bench/fastAgain/store.ts";
import { createFastAgainFixture } from "../library/db/fastAgainFixture.ts";
import { readTasteLibrary, deriveTaste } from "../playback/tasteDerivation.ts";
import { homeMagicQueueDue, buildHomeMagicQueue } from "./magicQueueJob.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
test("due picks retry their shared Library after a write before profile scoring", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    let reads = 0;
    const picked = Effect.runSync(
      buildHomeMagicQueue(store, null, {
        now: fixture.now,
        random: seededRandom("write"),
        turn: Effect.void,
        taste: (library) =>
          Effect.gen(function* () {
            if (++reads === 1) fixture.db.run(sql`UPDATE tracks SET path = NULL WHERE id % 2 = 0`);
            return yield* deriveTaste(store, Effect.void, fixture.now, library);
          }),
      }),
    );
    const library = Effect.runSync(readTasteLibrary(store, Effect.void));
    const taste = Effect.runSync(deriveTaste(store, Effect.void, fixture.now, library));
    assert.deepEqual(
      picked,
      magicQueuePicks(null, library.playable, {
        now: fixture.now,
        taste,
        random: seededRandom("write"),
      }),
    );
    assert.equal(reads, 2);
  } finally {
    fixture.close();
  }
});
test("due Home preserves yesterday's picks through scheduler waits, cancels without saving, then saves exact ti picks", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const old: MagicQueuePicks = {
      day: "yesterday",
      trackIds: fixture.songIds.slice(0, 9).map(String),
      shownToday: [],
    };
    let saved = old;
    const queue: (() => void)[] = [];
    let cancelled = 0;
    const turn = Effect.callback<void>((resume) => {
      const run = () => resume(Effect.void);
      queue.push(run);
      return Effect.sync(() => {
        const i = queue.indexOf(run);
        if (i >= 0) {
          queue.splice(i, 1);
          cancelled++;
        }
      });
    });
    const job = () =>
      buildHomeMagicQueue(store, old, {
        now: fixture.now,
        random: seededRandom("day"),
        turn,
        taste: (library) => deriveTaste(store, turn, fixture.now, library),
      }).pipe(
        Effect.tap((picks) =>
          Effect.sync(() => {
            saved = picks;
          }),
        ),
      );
    assert.equal(homeMagicQueueDue(false, old, [], false, fixture.now), false);
    assert.equal(homeMagicQueueDue(true, old, old.trackIds, false, fixture.now), true);
    assert.equal(
      homeMagicQueueDue(
        true,
        { ...old, day: localDay(fixture.now) },
        old.trackIds,
        false,
        fixture.now,
      ),
      false,
    );
    const controller = new AbortController();
    const first = Effect.runPromise(job(), { signal: controller.signal });
    assert.equal(queue.length, 1);
    assert.equal(saved, old);
    queue.shift()!();
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(saved, old);
    controller.abort();
    await assert.rejects(first);
    assert.equal(saved, old);
    assert.equal(queue.length, 0);
    assert.equal(cancelled, 1);
    const second = Effect.runPromise(job());
    let finished = false;
    void second.then(() => {
      finished = true;
    });
    for (let turns = 0; turns < 1000; turns++) {
      if (finished) break;
      queue.shift()?.();
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(finished, true, "the build finishes within bounded scheduler turns");
    const library = Effect.runSync(readTasteLibrary(store, Effect.void));
    const taste = Effect.runSync(deriveTaste(store, Effect.void, fixture.now, library));
    assert.deepEqual(
      saved,
      magicQueuePicks(old, library.playable, {
        now: fixture.now,
        taste,
        random: seededRandom("day"),
      }),
    );
  } finally {
    fixture.close();
  }
});

test("Home's actual timing session releases due work only after content AND transition settle", async () => {
  const { createTimingSession } = await import("../lib/timingSession.ts");
  for (const contentFirst of [true, false]) {
    let starts = 0;
    const session = createTimingSession({
      now: () => 0,
      wallNow: () => 0,
      write: () => {},
      context: () => ({ background: [], offline: false }),
      build: () => ({ version: "test", commit: "test" }),
    });
    const update = () => {
      if (homeMagicQueueDue(session.isSettled(), null, [], false, 0)) starts++;
    };
    session.onSettled(update);
    const id = session.begin("tab", "/home");
    session.response(id);
    session.frame(id);
    (contentFirst ? session.content : session.end)(id);
    assert.equal(starts, 0);
    (contentFirst ? session.end : session.content)(id);
    assert.equal(starts, 1);
    session.begin("push", "/settings");
    assert.equal(session.isSettled(), false);
    assert.equal(starts, 1);
  }
});
