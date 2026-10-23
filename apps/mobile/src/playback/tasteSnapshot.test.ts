/**
 * The taste snapshot restarts only for writes to what it reads (#593 review F-1): playback's
 * own saves (position, queue, an ongoing play's progress) don't move it, a taste write still
 * does, and a storm of taste writes ends in a bounded number of attempts.
 */
import { sql } from "drizzle-orm";
import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import {
  magicLibrarySongs,
  magicQueuePicks,
  seededRandom,
  tasteProfile,
  tastePlaySignal,
  type PlayEvent,
  type TasteHistory,
} from "@wave/core";
import { loadLibraryStore } from "../../bench/fastAgain/store.ts";
import { createFastAgainFixture } from "../library/db/fastAgainFixture.ts";
import type { LibraryStore } from "../library/LibraryStore.ts";
import { buildHomeMagicQueue } from "../home/magicQueueJob.ts";
import { deriveTaste, readTasteLibrary } from "./tasteDerivation.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
/** Writers stop after this many turns, so a derivation that restarts on every write ends too. */
const STORM_TURNS = 3000;
/** Checked attempts before the last one walks in a single task. */
const CHECKED_ATTEMPTS = 3;

type Store = LibraryStore["Service"];

/** [store] noting each history walk's start and the turn each of its pages was read at. */
const watched = (store: Store) => {
  let turns = 0;
  const walks: number[][] = [];
  const counted: Store = {
    ...store,
    tastePlaysPage: (cursor) => {
      if (cursor[0] === -Number.MAX_VALUE) walks.push([]);
      walks.at(-1)!.push(turns);
      return store.tastePlaysPage(cursor);
    },
  };
  return {
    store: counted,
    walks,
    turn: (each: (turn: number) => void) =>
      Effect.sync(() => {
        turns++;
        each(turns);
      }),
  };
};

/** ti's profile: the whole sources read at once. */
const tiProfile = (store: Store, now: number, history?: TasteHistory) => {
  const convert = magicLibrarySongs(Effect.runSync(store.listArtists));
  const byId = new Map(
    Effect.runSync(store.listSongs).map((song) => [String(song.id), convert(song)]),
  );
  return tasteProfile(history ?? Effect.runSync(store.tasteHistory), (id) => byId.get(id), now);
};

/** A tenth of the fixture's plays: shorter attempts, so a writer outlasts several of them. */
const fewerPlays = (fixture: {
  readonly db: { run: (query: ReturnType<typeof sql>) => unknown };
}) => fixture.db.run(sql`DELETE FROM play_events WHERE id % 10 <> 0`);

const ongoing = (trackId: number, startedAt: number, listenedMs: number): PlayEvent => ({
  trackId: String(trackId),
  context: null,
  startedAt,
  listenedMs,
  durationMs: 180_000,
  endReason: "interrupted",
  counted: false,
  source: "phone",
});

test("playback's own saves don't restart a taste derivation: it finishes in one attempt", async () => {
  const fixture = await createFastAgainFixture();
  try {
    fewerPlays(fixture);
    const base = await loadLibraryStore(root, fixture.db);
    Effect.runSync(base.saveQueue("[]", 0));
    const track = fixture.songIds[3]!;
    const startedAt = fixture.now - 60_000;
    const playId = Effect.runSync(base.recordPlay(ongoing(track, startedAt, 0)));
    const { store, walks, turn } = watched(base);
    const profile = Effect.runSync(
      deriveTaste(
        store,
        turn((n) => {
          if (n > STORM_TURNS) return;
          // What playing music writes: the position every 5 s, the play's progress every 15 s,
          // and a pause ("stopped" so far), all as fast as the turns come.
          Effect.runSync(base.savePosition(n));
          Effect.runSync(
            base.updatePlay(playId, {
              ...ongoing(track, startedAt, n * 1000),
              endReason: n % 2 === 0 ? "stopped" : "interrupted",
            }),
          );
          fixture.db.run(sql`UPDATE play_events SET pushed = 1 WHERE id = ${playId}`);
          fixture.db.run(
            sql`UPDATE artists SET artwork_hash = NULL WHERE id = (SELECT min(id) FROM artists)`,
          );
        }),
        fixture.now,
      ),
    );
    assert.equal(walks.length, 1, "one attempt, not one per save");
    assert.deepEqual(profile, tiProfile(base, fixture.now));
  } finally {
    fixture.close();
  }
});

test("a write to a taste source during the derivation still restarts it", async () => {
  for (const write of ["play end", "star", "song"] as const) {
    const fixture = await createFastAgainFixture();
    try {
      const base = await loadLibraryStore(root, fixture.db);
      const track = fixture.songIds[4]!;
      const startedAt = fixture.now - 60_000;
      const playId = Effect.runSync(base.recordPlay(ongoing(track, startedAt, 0)));
      const { store, walks, turn } = watched(base);
      const profile = Effect.runSync(
        deriveTaste(
          store,
          turn((n) => {
            if (n !== 40) return;
            if (write === "play end")
              Effect.runSync(
                base.endPlay(playId, {
                  ...ongoing(track, startedAt, 180_000),
                  endReason: "completed",
                  counted: true,
                }),
              );
            else if (write === "star") Effect.runSync(base.setFavorites([track], true));
            else fixture.db.run(sql`UPDATE tracks SET path = NULL WHERE id = ${track}`);
          }),
          fixture.now,
        ),
      );
      assert.equal(walks.length, 2, `${write}: the attempt it disturbed is discarded`);
      assert.deepEqual(profile, tiProfile(base, fixture.now), write);
    } finally {
      fixture.close();
    }
  }
});

test("a storm of taste writes ends after the checked attempts with one consistent walk in a single task", async () => {
  const fixture = await createFastAgainFixture();
  try {
    fewerPlays(fixture);
    const base = await loadLibraryStore(root, fixture.db);
    const moved = fixture.db.get<{ id: number }>(
      sql`SELECT id FROM play_events WHERE end_reason = 'completed' ORDER BY started_at LIMIT 1`,
    )!.id;
    const early = fixture.now - 80 * 86_400_000;
    const late = fixture.now - 86_400_000;
    const { store, walks, turn } = watched(base);
    // Moving a counted play across the walk's (started_at, id) order on every turn: a mixed
    // walk would count it twice or not at all.
    const profile = Effect.runSync(
      deriveTaste(
        store,
        turn((n) => {
          if (n <= STORM_TURNS * 7)
            fixture.db.run(
              sql`UPDATE play_events SET started_at = ${n % 2 === 0 ? early : late} WHERE id = ${moved}`,
            );
        }),
        fixture.now,
      ),
    );
    assert.equal(walks.length, CHECKED_ATTEMPTS + 1, "bounded: three checked attempts and a last");
    assert.equal(new Set(walks.at(-1)).size, 1, "the last walk takes no turn");
    const consistent = [early, late].map((startedAt) => {
      fixture.db.run(sql`UPDATE play_events SET started_at = ${startedAt} WHERE id = ${moved}`);
      return tiProfile(base, fixture.now);
    });
    assert.ok(
      consistent.some((expected) => {
        try {
          assert.deepEqual(profile, expected);
          return true;
        } catch {
          return false;
        }
      }),
      "the profile is one the history actually had",
    );
  } finally {
    fixture.close();
  }
});

test("Home's due pick under a write storm still saves picks after the checked attempts", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    let reads = 0;
    const picked = Effect.runSync(
      buildHomeMagicQueue(store, null, {
        now: fixture.now,
        random: seededRandom("storm"),
        turn: Effect.void,
        taste: (library) =>
          Effect.gen(function* () {
            // A write that changes nothing the pick sees, yet moves the taste revision.
            if (++reads <= 10)
              fixture.db.run(
                sql`UPDATE tracks SET title = title WHERE id = ${fixture.songIds[0]!}`,
              );
            return yield* deriveTaste(store, Effect.void, fixture.now, library);
          }),
      }),
    );
    assert.equal(reads, CHECKED_ATTEMPTS);
    const library = Effect.runSync(readTasteLibrary(store, Effect.void));
    assert.deepEqual(
      picked,
      magicQueuePicks(null, library.playable, {
        now: fixture.now,
        taste: tiProfile(store, fixture.now),
        random: seededRandom("storm"),
      }),
    );
  } finally {
    fixture.close();
  }
});

test("the taste revision moves only for what the taste reads", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    Effect.runSync(store.saveQueue("[]", 0));
    const track = fixture.songIds[5]!;
    const startedAt = fixture.now - 60_000;
    const playId = Effect.runSync(store.recordPlay(ongoing(track, startedAt, 0)));
    const revision = () => Effect.runSync(store.tasteRevision);
    const unrelated: Record<string, () => void> = {
      "position save": () => Effect.runSync(store.savePosition(1234)),
      "queue save": () => Effect.runSync(store.saveQueue("[]", 99)),
      "ongoing play's progress": () =>
        Effect.runSync(store.updatePlay(playId, ongoing(track, startedAt, 15_000))),
      "pause of the ongoing play": () =>
        Effect.runSync(
          store.updatePlay(playId, { ...ongoing(track, startedAt, 16_000), endReason: "stopped" }),
        ),
      "sync's pushed flags": () => {
        fixture.db.run(sql`UPDATE play_events SET pushed = 1`);
        fixture.db.run(sql`UPDATE favorites SET pushed = 1`);
      },
      "an artist image": () =>
        fixture.db.run(
          sql`UPDATE artists SET artwork_hash = NULL WHERE id = (SELECT min(id) FROM artists)`,
        ),
    };
    for (const [name, write] of Object.entries(unrelated)) {
      const before = revision();
      write();
      assert.equal(revision(), before, name);
    }
    const taste: Record<string, () => void> = {
      "a play starting": () => Effect.runSync(store.recordPlay(ongoing(track, fixture.now, 0))),
      "a play ending": () =>
        Effect.runSync(
          store.endPlay(playId, {
            ...ongoing(track, startedAt, 180_000),
            endReason: "completed",
            counted: true,
          }),
        ),
      "a star": () => Effect.runSync(store.setFavorites([track], true)),
      "an unstar": () => Effect.runSync(store.setFavorites([track], false)),
      "a song's file": () => fixture.db.run(sql`UPDATE tracks SET path = NULL WHERE id = ${track}`),
      "a song's credits": () =>
        fixture.db.run(sql`DELETE FROM track_artists WHERE track_id = ${track}`),
      "an artist's name": () =>
        fixture.db.run(
          sql`UPDATE artists SET name = name || '!' WHERE id = (SELECT min(id) FROM artists)`,
        ),
      "a genre": () => fixture.db.run(sql`UPDATE genres SET name = name || '!'`),
    };
    for (const [name, write] of Object.entries(taste)) {
      const before = revision();
      write();
      assert.notEqual(revision(), before, name);
    }
  } finally {
    fixture.close();
  }
});

test("a play neither played through nor skipped says nothing, however long it was listened to", () => {
  // The taste revision leaves out an unfinished play's progress on this rule (tastePages.ts).
  for (const endReason of ["stopped", "interrupted"] as const)
    for (const listenedMs of [0, 1000, 29_999, 30_000, 180_000, 10_000_000])
      assert.equal(tastePlaySignal({ endReason, listenedMs }), null);
});
