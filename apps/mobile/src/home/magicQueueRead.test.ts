import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import { createLibraryQueries } from "@wave/core";
import { loadLibraryStore } from "../../bench/fastAgain/store.ts";
import { createFastAgainFixture } from "../library/db/fastAgainFixture.ts";
import { traceQueries } from "../library/db/testDatabase.ts";
import { magicQueueRead } from "./magicQueueRead.ts";

const root = fileURLToPath(new URL("../../../../", import.meta.url));
test("standing Home picks read at most nine songs, in saved order, and follow only their songs and stars", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const ids = fixture.songIds.slice(0, 9).toReversed().map(String);
    const query = magicQueueRead(ids);
    let reads = 0;
    const registry = createLibraryQueries({
      now: () => fixture.now,
      schedule: () => () => {},
      read: (_key, settle) => {
        reads++;
        const measured = traceQueries(fixture.db, () => Effect.runSync(query.read(store)));
        assert.equal(measured.queries.length, 1);
        assert.equal(measured.queries[0]!.rows, 9);
        settle({ ok: true, value: measured.result });
      },
    });
    registry.attach(query.key, query.reads, { visible: true, onChange: () => {} });
    assert.deepEqual(
      (registry.current(query.key)!.value as { id: number }[]).map((song) => String(song.id)),
      ids,
    );
    registry.change({ kind: "tracks", ids: [fixture.songIds[99]!] });
    registry.change({ kind: "favorites", ids: [fixture.songIds[99]!] });
    registry.change({ kind: "plays", ids: [Number(ids[0])] });
    assert.equal(reads, 1);
    registry.change({ kind: "tracks", ids: [Number(ids[0])] });
    registry.change({ kind: "favorites", ids: [Number(ids[0])] });
    assert.equal(reads, 3);
    assert.equal(Effect.runSync(magicQueueRead([]).read(store)).length, 0);
  } finally {
    fixture.close();
  }
});

test("a short standing row detects Library growth with one id, without decoding other songs", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const measured = traceQueries(fixture.db, () =>
      Effect.runSync(store.hasPlayableSongOutside(fixture.songIds.slice(0, 2))),
    );
    assert.equal(measured.result, true);
    assert.equal(measured.queries.length, 1);
    assert.equal(measured.queries[0]!.rows, 1);
    assert.equal(measured.queries[0]!.sql.includes('"tracks"."title"'), false);
  } finally {
    fixture.close();
  }
});

test("a removed saved song disappears in place and schedules its replacement without moving the survivors", async () => {
  const { homeMagicQueueDue } = await import("./magicQueueJob.ts");
  const { localDay } = await import("@wave/core");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const ids = fixture.songIds.slice(0, 9).toReversed().map(String);
    const saved = { day: localDay(fixture.now), trackIds: ids, shownToday: ids };
    const removed = Number(ids[3]);
    await Effect.runPromise(store.removeSongs([removed]));
    const shown = Effect.runSync(magicQueueRead(ids).read(store));
    assert.deepEqual(
      shown.map((song) => String(song.id)),
      ids.filter((id) => Number(id) !== removed),
    );
    assert.equal(
      homeMagicQueueDue(
        false,
        saved,
        shown.map((song) => String(song.id)),
        false,
        fixture.now,
      ),
      false,
    );
    assert.equal(
      homeMagicQueueDue(
        true,
        saved,
        shown.map((song) => String(song.id)),
        false,
        fixture.now,
      ),
      true,
    );
  } finally {
    fixture.close();
  }
});

test("the real scan-save notification leaves an unrelated standing row unread", async () => {
  const { scanBatchChange } = await import("../library/scanChanges.ts");
  const { normalizeTrack } = await import("@wave/core");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const ids = fixture.songIds.slice(0, 9).map(String);
    const query = magicQueueRead(ids);
    let reads = 0;
    const registry = createLibraryQueries({
      now: () => fixture.now + 5000,
      schedule: () => () => {},
      read: (_key, settle) => {
        reads++;
        settle({ ok: true, value: Effect.runSync(query.read(store)) });
      },
    });
    registry.attach(query.key, query.reads, { visible: true, onChange: () => {} });
    const unrelated = normalizeTrack({
      path: "/Music/new.mp3",
      title: "New song",
      artist: "New artist",
      durationMs: 180000,
    });
    const result = await Effect.runPromise(
      store.saveBatch(
        [
          {
            ...unrelated,
            sizeBytes: 1000,
            modifiedAt: fixture.now,
            sampleRate: null,
            bitrateKbps: null,
            artworkHash: null,
            hasLyrics: false,
            explicit: "unknown",
          },
        ],
        [],
      ),
    );
    registry.change(scanBatchChange(result.trackIds));
    // A forced edit proves the notification's IDs, independent of burst throttling.
    registry.change({ ...scanBatchChange(result.trackIds), burst: false });
    assert.equal(reads, 1);
    registry.change({ ...scanBatchChange([Number(ids[0])]), burst: false });
    assert.equal(reads, 2);
  } finally {
    fixture.close();
  }
});
