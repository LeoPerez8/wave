import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import { planLinkImport, startPlaylistImport, type YtAlbumSong } from "@wave/core";
import { loadLibraryStore } from "../../bench/fastAgain/store.ts";
import { createFastAgainFixture } from "./db/fastAgainFixture.ts";
import { traceQueries } from "./db/testDatabase.ts";
import { finishLinkImport } from "./startupJobs.ts";
const root = fileURLToPath(new URL("../../../../", import.meta.url));

test("resumed link imports yield before reads/writes, keep exact order, stop on replacement and resume idempotently", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const made = Effect.runSync(store.createPlaylist("Resume", []));
    const plan = planLinkImport<YtAlbumSong, never>(
      {
        service: "spotify",
        playlist: {
          title: "Resume",
          artworkUrl: null,
          total: 3,
          truncated: false,
          songs: ["First", "Second", "Third"].map((title) => ({
            title,
            artists: ["A"],
            album: null,
            durationMs: 1000,
          })),
        },
      },
      [],
    );
    const job = startPlaylistImport(plan, { playlistId: made.playlistId, name: made.name });
    let active = true;
    let turns = 0;
    const turn = Effect.sync(() => {
      turns++;
      if (turns === 3) active = false;
    });
    let published = 0;
    const stopped = traceQueries(fixture.db, () =>
      Effect.runSync(
        finishLinkImport(
          store,
          job,
          turn,
          () => active,
          () => published++,
        ),
      ),
    );
    assert.equal(stopped.result, null);
    assert.equal(published, 1); // A partial import is visible even when cancellation prevents completion.
    assert.equal(Effect.runSync(store.getPlaylist(made.playlistId))!.items.length, 1);
    active = true;
    const done = Effect.runSync(finishLinkImport(store, job, Effect.void, () => active));
    assert.equal(done?.state.kind, "done");
    const songs = Effect.runSync(store.getPlaylist(made.playlistId))!.items;
    assert.deepEqual(
      songs.map((item) => (item.source === "library" ? "library" : item.song.title)),
      ["First", "Second", "Third"],
    );
    Effect.runSync(finishLinkImport(store, job, Effect.void, () => active));
    assert.equal(Effect.runSync(store.getPlaylist(made.playlistId))!.items.length, 3);
  } finally {
    fixture.close();
  }
});

test("actual startup jobs cannot read before global settlement; navigation pauses scan steps and abort gives up pending turns", async () => {
  const { createStartupWork } = await import("../lib/startupWork.ts");
  const { createTimingSession } = await import("../lib/timingSession.ts");
  const { readScanIndex, checkDuplicateFiles } = await import("./startupJobs.ts");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    let now = 0,
      next = 0;
    const frames = new Map<number, () => void>(),
      tasks = new Map<number, () => void>();
    const session = createTimingSession({
      now: () => now,
      wallNow: () => now,
      write: () => {},
      context: () => ({ background: [], offline: true }),
      build: () => ({ version: "test", commit: "test" }),
    });
    const work = createStartupWork({
      now: () => now,
      isSettled: session.isSettled,
      subscribe: session.onSettled,
      request: (run) => {
        frames.set(++next, run);
        return next;
      },
      cancel: (id) => {
        frames.delete(id);
      },
      whenFree: (run) => {
        tasks.set(++next, run);
        const id = next;
        return () => {
          tasks.delete(id);
        };
      },
    });
    const turn = Effect.callback<void>((resume) => {
      const cancel = work.whenFree(() => resume(Effect.void));
      return Effect.sync(cancel);
    });
    const controller = new AbortController();
    const cold = session.routeCommitted("/")!;
    const first = traceQueries(fixture.db, () =>
      Effect.runPromise(readScanIndex(store, ["/Music"], turn), { signal: controller.signal }),
    );
    assert.equal(first.queries.length, 0);
    assert.equal(frames.size, 0);
    assert.equal(tasks.size, 0);
    session.content(cold);
    session.frame(cold);
    assert.equal(frames.size, 0);
    session.end(cold);
    for (let i = 0; i < 4; i++) {
      now += 16;
      const due = [...frames.values()];
      frames.clear();
      for (const run of due) run();
    }
    const navigation = session.begin("push", "/settings");
    assert.equal(tasks.size, 0);
    controller.abort();
    await assert.rejects(first.result);
    assert.equal(frames.size, 0);
    session.response(navigation);
    session.frame(navigation);
    session.content(navigation);
    session.end(navigation);
    let finished = false;
    const result = Effect.runPromise(
      Effect.gen(function* () {
        const index = yield* readScanIndex(store, ["/Music"], turn);
        const duplicates = yield* checkDuplicateFiles(store, turn, () =>
          Effect.die("no pairs expected"),
        );
        return { index, duplicates };
      }),
    ).then((value) => {
      finished = true;
      return value;
    });
    for (let i = 0; i < 100; i++) {
      if (finished) break;
      now += 16;
      const due = [...frames.values()];
      frames.clear();
      for (const run of due) run();
      const task = tasks.entries().next().value;
      if (task) {
        tasks.delete(task[0]);
        task[1]();
      }
      await new Promise((resolve) => setImmediate(resolve));
    }
    assert.equal(finished, true);
    const done = await result;
    assert.equal(done.index.known.length, 980);
    assert.equal(done.index.indexed.size, 980);
    assert.deepEqual(done.duplicates, { outcomes: [], changed: [] });
    assert.equal(tasks.size, 0);
    assert.equal(frames.size, 0);
    work.dispose();
  } finally {
    fixture.close();
  }
});

const scanned = async (path: string, title: string) => {
  const { normalizeTrack } = await import("@wave/core");
  return {
    ...normalizeTrack({ path, title, artist: "A", album: "Album", durationMs: 180000 }),
    sizeBytes: 1000,
    modifiedAt: 1,
    sampleRate: 44100,
    bitrateKbps: 320,
    artworkHash: null,
    hasLyrics: false,
    explicit: "clean" as const,
  };
};

test("scan saves one track per free turn, preserving moved identity and a retry after interruption", async () => {
  const { saveScanBatch } = await import("./startupJobs.ts");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const old = await scanned("/Startup/old.mp3", "Moved");
    const [movedId] = Effect.runSync(
      store.saveBatch([old], [], [], { linkEntries: false }),
    ).trackIds;
    const read = [
      await scanned("/Startup/added.mp3", "Added"),
      { ...old, path: "/Startup/moved.mp3" },
    ];
    const turns: (() => void)[] = [];
    const turn = Effect.callback<void>((resume) => {
      const run = () => resume(Effect.void);
      turns.push(run);
      return Effect.sync(() => {
        const i = turns.indexOf(run);
        if (i >= 0) turns.splice(i, 1);
      });
    });
    const controller = new AbortController();
    const saving = Effect.runPromise(
      saveScanBatch(store, { missing: [old], read, isIndexed: () => false }, [], turn),
      { signal: controller.signal },
    );
    turns.shift()!();
    await new Promise((resolve) => setImmediate(resolve)); // Reconciliation, no write.
    assert.equal(Effect.runSync(store.knownFiles(["/Startup"])).length, 1);
    turns.shift()!();
    await new Promise((resolve) => setImmediate(resolve)); // First transaction only.
    assert.deepEqual(
      Effect.runSync(store.knownFiles(["/Startup"])).map((f) => f.path),
      ["/Startup/old.mp3", "/Startup/added.mp3"],
    );
    controller.abort();
    await assert.rejects(saving);
    assert.equal(turns.length, 0);
    const retried = Effect.runSync(
      saveScanBatch(
        store,
        { missing: [old], read, isIndexed: (p) => p === "/Startup/added.mp3" },
        [],
        Effect.void,
      ),
    );
    assert.equal(retried.count, 2);
    assert.equal(Effect.runSync(store.songsByIds([movedId!]))[0]!.path, "/Startup/moved.mp3");
    assert.equal(Effect.runSync(store.knownFiles(["/Startup"])).length, 2);
    const count = traceQueries(fixture.db, () => Effect.runSync(store.knownFiles(["/Startup"])));
    assert.equal(count.queries.length, 1);
    assert.equal(count.queries[0]!.rows, 2);
  } finally {
    fixture.close();
  }
});

test("duplicate jobs read audio pair by pair, retain the older track and recover safely from native failure", async () => {
  const { checkDuplicateFiles } = await import("./startupJobs.ts");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const files = [
      await scanned("/Startup/pair.mp3", "Pair"),
      await scanned("/Startup/pair.m4a", "Pair"),
    ];
    const saved = Effect.runSync(store.saveBatch(files, [], [], { linkEntries: false }));
    const failing = checkDuplicateFiles(store, Effect.void, () => Effect.fail("native failure"));
    assert.throws(() => Effect.runSync(failing), /native failure/);
    assert.equal(Effect.runSync(store.songsByIds(saved.trackIds)).length, 2);
    const paths: (readonly string[])[] = [];
    let turns = 0;
    const checked = Effect.runSync(
      checkDuplicateFiles(
        store,
        Effect.sync(() => {
          turns++;
        }),
        (pair) => {
          paths.push(pair);
          return Effect.succeed([180000, 180000]);
        },
      ),
    );
    assert.deepEqual(paths, [["/Startup/pair.m4a", "/Startup/pair.mp3"]]);
    assert.deepEqual(checked.changed, saved.trackIds);
    assert.equal(Effect.runSync(store.songsByIds(saved.trackIds)).length, 1);
    assert.ok(turns >= 5);
    assert.deepEqual(
      Effect.runSync(checkDuplicateFiles(store, Effect.void, () => Effect.die("unexpected read"))),
      { outcomes: [], changed: [] },
    );
  } finally {
    fixture.close();
  }
});

test("an unchanged scan performs no cleanup read/write, while a changed scan prunes on its own turn", async () => {
  const { finishScanIndex } = await import("./startupJobs.ts");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const unchanged = traceQueries(fixture.db, () =>
      Effect.runSync(finishScanIndex(store, [], 0, Effect.void)),
    );
    assert.equal(unchanged.queries.length, 0);
    let turns = 0;
    const file = await scanned("/Startup/gone.mp3", "Gone");
    const saved = Effect.runSync(store.saveBatch([file], [], [], { linkEntries: false }));
    Effect.runSync(
      finishScanIndex(
        store,
        [file.path],
        0,
        Effect.sync(() => {
          turns++;
        }),
      ),
    );
    assert.equal(turns, 1);
    assert.equal(Effect.runSync(store.songsByIds(saved.trackIds)).length, 0);
  } finally {
    fixture.close();
  }
});

test("native scan input preparation yields before work and at its operation cap, preserving source columns", async () => {
  const { scanInputColumns } = await import("./startupJobs.ts");
  const rows = Array.from({ length: 1200 }, (_, i) => ({
    path: `/Music/${i}.mp3`,
    sizeBytes: i + 100,
    modifiedAt: i + 200,
  }));
  const turns: (() => void)[] = [];
  const turn = Effect.callback<void>((resume) => {
    turns.push(() => resume(Effect.void));
  });
  let done = false;
  const promise = Effect.runPromise(scanInputColumns(rows, turn)).then((result) => {
    done = true;
    return result;
  });
  assert.equal(done, false);
  let count = 0;
  while (!done && count < 20) {
    assert.equal(turns.length, 1);
    turns.shift()!();
    count++;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(done, true);
  assert.ok(count >= 3); // At most 512 inputs may advance per scheduled CPU task.
  const result = await promise;
  assert.equal(result.paths.length, 1200);
  assert.deepEqual(result.paths.slice(0, 2), ["/Music/0.mp3", "/Music/1.mp3"]);
  assert.deepEqual(result.paths.slice(-2), ["/Music/1198.mp3", "/Music/1199.mp3"]);
  assert.deepEqual(result.sizes.slice(-2), [1298, 1299]);
  assert.deepEqual(result.modified.slice(-2), [1398, 1399]);
});

test("resuming filled import downloads builds its Library matches in steps and ignores a replaced batch", async () => {
  const { readImportDownloadInput } = await import("./startupJobs.ts");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    Effect.runSync(
      store.saveBatch([await scanned("/Startup/present.mp3", "Present")], [], [], {
        linkEntries: false,
      }),
    );
    const song = (title: string, videoId: string) => ({
      title,
      videoId,
      artists: ["A"],
      album: null,
      durationMs: 180000,
      artworkUrl: null,
      explicit: false,
    });
    const present = song("Present", "present"),
      absent = song("Absent", "absent");
    const made = Effect.runSync(
      store.createPlaylist("Download resume", [
        { source: "stream", song: present },
        { source: "stream", song: absent },
      ]),
    );
    let turns = 0;
    const ready = Effect.runSync(
      readImportDownloadInput(
        store,
        made.playlistId,
        Effect.sync(() => {
          turns++;
        }),
      ),
    );
    assert.ok(turns >= 5);
    assert.equal(ready?.detail.items.length, 2);
    assert.equal(ready?.inLibrary(present), true);
    assert.equal(ready?.inLibrary(absent), false);
    let current = true;
    const stopped = Effect.runSync(
      readImportDownloadInput(
        store,
        made.playlistId,
        Effect.sync(() => {
          current = false;
        }),
        () => current,
      ),
    );
    assert.equal(stopped, null);
  } finally {
    fixture.close();
  }
});
