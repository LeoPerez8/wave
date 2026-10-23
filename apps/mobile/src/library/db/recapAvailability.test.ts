import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import {
  availableRecaps,
  createRecapAvailability,
  homeRecapVisibility,
  startHomeRecap,
  type RecapPeriod,
} from "@wave/core";
import { loadLibraryStore } from "../../../bench/fastAgain/store.ts";
import { createFastAgainFixture } from "./fastAgainFixture.ts";
import { traceQueries } from "./testDatabase.ts";

const root = fileURLToPath(new URL("../../../../../", import.meta.url));
const at = (month: number, day = 1, h = 0, minute = 0) =>
  new Date(2026, month - 1, day, h, minute).getTime();

const announcementOnOpening = (
  available: readonly RecapPeriod[] | undefined,
  opened: readonly string[],
) => startHomeRecap(available, opened, true).period;

test("bounded listening pages preserve all Core availability without a whole-history statement", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const expected = availableRecaps(Effect.runSync(store.countedListening), fixture.now);
    const build = createRecapAvailability();
    let after = 0;
    let reads = 0;
    for (;;) {
      const page = traceQueries(fixture.db, () =>
        Effect.runSync(store.countedListeningPage(after)),
      );
      assert.equal(page.queries.length, 1);
      assert.ok(page.queries[0]!.rows <= 513);
      assert.ok(
        page.queries[0]!.plan.some((step) =>
          /SEARCH play_events USING INTEGER PRIMARY KEY/.test(step),
        ),
      );
      for (const entry of page.result.rows) build.add(entry);
      reads++;
      if (page.result.next === null) break;
      assert.ok(page.result.next > after);
      after = page.result.next;
    }
    const finish = build.finish(fixture.now);
    let result = finish.next();
    while (!result.done) result = finish.next();
    assert.deepEqual(result.value, expected);
    assert.equal(reads, Math.ceil(fixture.playEvents / 512));
  } finally {
    fixture.close();
  }
});

test("every persisted progress, replay and import changes the shared history version", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    let changes = 0;
    const stop = store.listeningHistoryVersion.subscribe(() => changes++);
    const initial = store.listeningHistoryVersion.get();
    const play = {
      trackId: String(fixture.songIds[0]),
      context: null,
      startedAt: fixture.now,
      listenedMs: 0,
      durationMs: 180_000,
      endReason: "interrupted",
      counted: false,
      source: "phone",
    } as const;
    const id = Effect.runSync(store.recordPlay(play));
    Effect.runSync(store.updatePlay(id, { ...play, listenedMs: 180_000, counted: true }));
    Effect.runSync(
      store.endPlay(id, { ...play, listenedMs: 180_000, counted: true, endReason: "completed" }),
    );
    Effect.runSync(store.recordPlay({ ...play, startedAt: fixture.now + 1 }));
    Effect.runSync(
      store.saveImportedPlays([{ trackId: fixture.songIds[0]!, startedAt: fixture.now - 1 }]),
    );
    assert.equal(store.listeningHistoryVersion.get(), initial + 5);
    assert.equal(changes, 5);
    stop();
  } finally {
    fixture.close();
  }
});

test("a sync page invalidates persisted listening even when the next request fails", async () => {
  const { EMPTY_SYNC_TABLES } = await import("@wave/core");
  const { sql } = await import("drizzle-orm");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const songId = fixture.db.get<{ key: string }>(
      sql`SELECT recording_key AS key FROM tracks ORDER BY id LIMIT 1`,
    ).key;
    const before = store.listeningHistoryVersion.get();
    let requests = 0;
    await assert.rejects(
      Effect.runPromise(
        store.syncWithAccount({
          account: "recap-test@example.com",
          songsChanged: false,
          now: () => fixture.now,
          preferences: { value: () => null, apply: () => {} },
          wait: async () => {},
          transport: {
            request: async () => {
              if (requests++ > 0) return { status: 500, body: "failed after committed page" };
              return {
                status: 200,
                body: JSON.stringify({
                  ...EMPTY_SYNC_TABLES,
                  cursor: "1",
                  more: true,
                  plays: [
                    {
                      id: "recap-sync-play",
                      songId,
                      startedAt: fixture.now,
                      listenedMs: 180_000,
                      durationMs: 180_000,
                      endReason: "completed",
                      counted: true,
                      contextType: null,
                      contextId: null,
                      source: "phone",
                      importedFrom: null,
                    },
                  ],
                }),
              };
            },
          },
        }),
      ),
    );
    assert.equal(store.listeningHistoryVersion.get(), before + 1);
    assert.equal(
      fixture.db.get<{ count: number }>(
        sql`SELECT count(*) AS count FROM play_events WHERE sync_id = 'recap-sync-play'`,
      ).count,
      1,
    );
  } finally {
    fixture.close();
  }
});

test("shared availability and announcements follow actual threshold, opened, December/January and timezone changes", async () => {
  const { sql } = await import("drizzle-orm");
  const { createRecapReplay } = await import("../../../bench/fastAgain/recapReplay.ts");
  const previousZone = process.env.TZ;
  process.env.TZ = "America/Sao_Paulo";
  const fixture = await createFastAgainFixture();
  fixture.db.run(sql`DELETE FROM play_events`);
  const replay = (await createRecapReplay(root, fixture))!;
  try {
    const hour = 3_600_000;
    const history = {
      trackId: String(fixture.songIds[0]),
      context: null,
      startedAt: at(9, 30, 23, 45),
      listenedMs: 3 * hour - 1,
      durationMs: 3 * hour,
      counted: true,
      endReason: "interrupted",
      source: "phone",
    } as const;
    const id = Effect.runSync(replay.store.recordPlay(history));
    replay.at(at(10));
    const client = replay.attach(true);
    let home = startHomeRecap(replay.get(), [], true);
    assert.equal(home.period, null, "the pending check reserves no card");
    await replay.drain();
    assert.deepEqual(replay.get(), []);
    replay.reset(true);
    Effect.runSync(replay.store.updatePlay(id, { ...history, listenedMs: 3 * hour }));
    await replay.drain();
    home = homeRecapVisibility(home, true, replay.get(), []);
    assert.equal(home.period, null, "reaching the threshold cannot insert a card during a visit");
    home = homeRecapVisibility(home, false, replay.get(), []);
    home = homeRecapVisibility(home, true, replay.get(), []);
    assert.deepEqual(home.period, { kind: "month", year: 2026, month: 9 });
    assert.deepEqual(announcementOnOpening(replay.get(), []), {
      kind: "month",
      year: 2026,
      month: 9,
    });
    const result = replay.get();
    replay.reset(true);
    assert.equal(announcementOnOpening(result, ["2026-09"]), null);
    assert.equal(replay.work.statements, 0, "opened state never queries history");
    Effect.runSync(
      replay.store.recordPlay({ ...history, startedAt: at(11, 30, 23, 45), listenedMs: 17 * hour }),
    );
    replay.at(at(12));
    await replay.drain();
    assert.deepEqual(replay.get(), [
      { kind: "year", year: 2026 },
      { kind: "month", year: 2026, month: 11 },
      { kind: "month", year: 2026, month: 9 },
    ]);
    assert.deepEqual(announcementOnOpening(replay.get(), []), { kind: "year", year: 2026 });
    assert.deepEqual(announcementOnOpening(replay.get(), ["2026"]), {
      kind: "month",
      year: 2026,
      month: 11,
    });
    assert.equal(announcementOnOpening(replay.get(), ["2026", "2026-11"]), null);
    Effect.runSync(
      replay.store.recordPlay({ ...history, startedAt: at(12, 31, 23, 45), listenedMs: 3 * hour }),
    );
    replay.at(new Date(2027, 0, 1).getTime());
    await replay.drain();
    assert.deepEqual(announcementOnOpening(replay.get(), ["2026", "2026-11"]), {
      kind: "month",
      year: 2026,
      month: 12,
    });
    client.setActive(false);
    replay.reset(true);
    process.env.TZ = "Pacific/Kiritimati";
    replay.at(new Date(2027, 0, 1).getTime());
    await replay.drain();
    assert.equal(replay.work.reads, 0);
    client.setActive(true);
    await replay.drain();
    const expected = availableRecaps(
      Effect.runSync(replay.store.countedListening),
      new Date(2027, 0, 1).getTime(),
    );
    assert.deepEqual(replay.get(), expected);
    assert.equal(replay.work.reads, 1);
  } finally {
    replay.close();
    fixture.close();
    if (previousZone === undefined) delete process.env.TZ;
    else process.env.TZ = previousZone;
  }
});

test("an all-skipped bounded page advances, including a trailing exact page", async () => {
  const { sql } = await import("drizzle-orm");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    fixture.db.run(sql`DELETE FROM play_events WHERE id > 1024`);
    fixture.db.run(sql`UPDATE play_events SET counted = 0`);
    const first = traceQueries(fixture.db, () => Effect.runSync(store.countedListeningPage(0)));
    assert.deepEqual(first.result, { rows: [], next: 512 });
    assert.equal(first.queries[0]!.rows, 1, "cursor advances without any decoded buckets");
    const second = Effect.runSync(store.countedListeningPage(512));
    assert.deepEqual(second, { rows: [], next: 1024 });
    const end = Effect.runSync(store.countedListeningPage(1024));
    assert.deepEqual(end, { rows: [], next: null });
  } finally {
    fixture.close();
  }
});

test("Stats waits for every controlled free turn and cancellation prevents the next SQL page", async () => {
  const { createRecapReplay } = await import("../../../bench/fastAgain/recapReplay.ts");
  const fixture = await createFastAgainFixture();
  const replay = (await createRecapReplay(root, fixture))!;
  try {
    replay.reset(true);
    const turns = new Set<() => void>();
    let cancelled = 0;
    const between = Effect.callback<void>((resume) => {
      const run = () => {
        turns.delete(run);
        resume(Effect.void);
      };
      turns.add(run);
      return Effect.sync(() => {
        if (turns.delete(run)) cancelled++;
      });
    });
    const abort = new AbortController();
    const running = Effect.runPromise(replay.stats.recaps(fixture.now, between), {
      signal: abort.signal,
    });
    assert.equal(replay.work.statements, 0);
    assert.equal(turns.size, 1);
    turns.values().next().value!();
    for (let i = 0; i < 8; i++) await Promise.resolve();
    assert.equal(replay.work.statements, 1);
    assert.ok(replay.work.maxRows <= 513);
    assert.equal(turns.size, 1, "the second page waits for another turn");
    abort.abort();
    await assert.rejects(running);
    assert.equal(cancelled, 1);
    assert.equal(turns.size, 0);
    assert.equal(replay.work.statements, 1);
  } finally {
    replay.close();
    fixture.close();
  }
});

test("the availability benchmark restores listening for the next registered benchmark", async () => {
  const { bench } = await import("../../../bench/fastAgain/benches/recapAvailability.ts");
  const { runBenchmarks } = await import("../../../bench/fastAgain/runner.ts");
  let before: unknown;
  await runBenchmarks({
    sizes: [1000],
    variants: [{ variant: "after", root }],
    runs: 1,
    benches: [
      {
        name: "beforeRecap",
        run: async ({ fixture }) => {
          const store = await loadLibraryStore(root, fixture.db);
          before = Effect.runSync(store.countedListening);
          return [];
        },
      },
      bench,
      {
        name: "afterRecap",
        run: async ({ fixture }) => {
          const store = await loadLibraryStore(root, fixture.db);
          assert.deepEqual(Effect.runSync(store.countedListening), before);
          return [];
        },
      },
    ],
    emit: () => {},
  });
});
