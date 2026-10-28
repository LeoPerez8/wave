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

test("link imports append ti's songs in 100-song transactions, one per turn, keeping order, stopping on replacement and resuming idempotently", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const made = Effect.runSync(store.createPlaylist("Resume", []));
    const titles = Array.from({ length: 250 }, (_, i) => `Song ${i}`);
    const plan = planLinkImport<YtAlbumSong, never>(
      {
        service: "spotify",
        playlist: {
          title: "Resume",
          artworkUrl: null,
          total: titles.length,
          truncated: false,
          songs: titles.map((title) => ({
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
    const appends: number[] = [];
    const counted: typeof store = {
      ...store,
      addToPlaylist: (id, songs) => {
        appends.push(songs.length);
        return store.addToPlaylist(id, songs);
      },
    };
    let active = true;
    // Replaced once the first transaction landed.
    const turn = Effect.sync(() => {
      if (appends.length === 1) active = false;
    });
    let published = 0;
    const stopped = traceQueries(fixture.db, () =>
      Effect.runSync(
        finishLinkImport(
          counted,
          job,
          turn,
          () => active,
          () => published++,
        ),
      ),
    );
    assert.equal(stopped.result, null);
    assert.deepEqual(appends, [100]);
    assert.equal(published, 1); // A partial import is visible even when cancellation prevents completion.
    assert.equal(Effect.runSync(store.getPlaylist(made.playlistId))!.items.length, 100);
    active = true;
    appends.length = 0;
    const done = Effect.runSync(finishLinkImport(counted, job, Effect.void, () => active));
    assert.equal(done?.state.kind, "done");
    assert.deepEqual(appends, [100, 100, 50]);
    const songs = Effect.runSync(store.getPlaylist(made.playlistId))!.items;
    assert.deepEqual(
      songs.map((item) => (item.source === "library" ? "library" : item.song.title)),
      titles,
    );
    Effect.runSync(finishLinkImport(store, job, Effect.void, () => active));
    assert.equal(Effect.runSync(store.getPlaylist(made.playlistId))!.items.length, 250);
  } finally {
    fixture.close();
  }
});

test("a link import tells how many of its songs have landed, before the first slice and after each", async () => {
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const made = Effect.runSync(store.createPlaylist("Counted", []));
    const titles = Array.from({ length: 250 }, (_, i) => `Song ${i}`);
    const plan = planLinkImport<YtAlbumSong, never>(
      {
        service: "spotify",
        playlist: {
          title: "Counted",
          artworkUrl: null,
          total: titles.length,
          truncated: false,
          songs: titles.map((title) => ({ title, artists: ["A"], album: null, durationMs: 1000 })),
        },
      },
      [],
    );
    const job = startPlaylistImport(plan, { playlistId: made.playlistId, name: made.name });
    const told: [number, number][] = [];
    Effect.runSync(
      finishLinkImport(
        store,
        job,
        Effect.void,
        () => true,
        () => {},
        (added, total) => told.push([added, total]),
      ),
    );
    assert.deepEqual(told, [
      [0, 250],
      [100, 250],
      [200, 250],
      [250, 250],
    ]);
  } finally {
    fixture.close();
  }
});

test("Liked Songs' stars and pending favorites go in 100-row writes per turn, and the downloads in one request, as on ti", async () => {
  const { dispatchLibraryFavorites } = await import("./startupJobs.ts");
  const favorites = {
    star: Array.from({ length: 250 }, (_, i) => i + 1),
    pending: Array.from({ length: 230 }, (_, i) => ({
      videoId: `v${i}`,
      title: `Liked ${i}`,
      artists: ["A"],
      durationMs: 1000,
    })),
    download: Array.from({ length: 230 }, (_, i) => ({
      title: `Liked ${i}`,
      videoId: `v${i}`,
      artists: ["A"],
      album: null,
      durationMs: 1000,
      artworkUrl: null,
      explicit: false,
    })),
  };
  const run = async (stopAfter: number) => {
    const events: string[] = [];
    let turns = 0;
    const done = await dispatchLibraryFavorites(favorites, {
      turn: async () => {
        turns++;
      },
      current: () => turns <= stopAfter,
      star: async (ids) => {
        events.push(`star ${ids.length} from ${ids[0]}`);
      },
      syncedStars: () => {
        events.push("synced stars");
      },
      pend: async (list) => {
        events.push(`pend ${list.length} from ${list[0]!.videoId}`);
      },
      download: (songs) => {
        events.push(`download ${songs.length}`);
      },
    });
    return { done, events, turns };
  };
  const whole = await run(Infinity);
  assert.equal(whole.done, true);
  assert.deepEqual(whole.events, [
    "star 100 from 1",
    "star 100 from 101",
    "star 50 from 201",
    "synced stars",
    "pend 100 from v0",
    "pend 100 from v100",
    "pend 30 from v200",
    "download 230",
  ]);
  // Every write waits for its own turn.
  assert.equal(whole.turns, 7);
  // A read refreshed or deleted meanwhile stops at the next turn.
  const stopped = await run(2);
  assert.equal(stopped.done, false);
  assert.deepEqual(stopped.events, ["star 100 from 1", "star 100 from 101"]);
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

const scanned = async (
  path: string,
  title: string,
  tags: { readonly artist?: string; readonly album?: string } = {},
  artworkHash: string | null = null,
) => {
  const { normalizeTrack } = await import("@wave/core");
  return {
    ...normalizeTrack({ path, title, artist: "A", album: "Album", durationMs: 180000, ...tags }),
    sizeBytes: 1000,
    modifiedAt: 1,
    sampleRate: 44100,
    bitrateKbps: 320,
    artworkHash,
    hasLyrics: false,
    explicit: "clean" as const,
  };
};

test("scan saves ti's 100-file slices, one transaction per turn with artwork first, keeping moved identity and a retry after interruption", async () => {
  const { saveScanBatch } = await import("./startupJobs.ts");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const old = await scanned("/Startup/old.mp3", "Moved");
    const [movedId] = Effect.runSync(
      store.saveBatch([old], [], [], { linkEntries: false }),
    ).trackIds;
    const read = [
      ...(await Promise.all(
        Array.from({ length: 249 }, (_, i) => scanned(`/Startup/added-${i}.mp3`, `Added ${i}`)),
      )),
      { ...old, path: "/Startup/moved.mp3" },
    ];
    const art = { hash: "cover", path: "/covers/c.jpg", thumbPath: "/covers/c.t.jpg", palette: {} };
    const saves: { tracks: number; artwork: number; moves: number }[] = [];
    const counted: typeof store = {
      ...store,
      saveBatch: (tracks, artwork, moves = [], options) => {
        saves.push({ tracks: tracks.length, artwork: artwork.length, moves: moves.length });
        return store.saveBatch(tracks, artwork, moves, options);
      },
    };
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
      saveScanBatch(counted, { missing: [old], read, isIndexed: () => false }, [art], turn),
      { signal: controller.signal },
    );
    // Reconciliation's CPU steps take their own turns before any write.
    for (let i = 0; i < 20 && saves.length === 0; i++) {
      turns.shift()!();
      await new Promise((resolve) => setImmediate(resolve));
    }
    // One transaction per turn: ti's first slice, with the batch's artwork.
    assert.deepEqual(saves, [{ tracks: 100, artwork: 1, moves: 0 }]);
    assert.equal(Effect.runSync(store.knownFiles(["/Startup"])).length, 101);
    controller.abort();
    await assert.rejects(saving);
    assert.equal(turns.length, 0);
    saves.length = 0;
    const retried = Effect.runSync(
      saveScanBatch(
        counted,
        {
          missing: [old],
          read,
          isIndexed: (p) => /^\/Startup\/added-(\d|[1-9]\d)\.mp3$/.test(p),
        },
        [],
        Effect.void,
      ),
    );
    assert.equal(retried.count, 250);
    assert.deepEqual(saves, [
      { tracks: 100, artwork: 0, moves: 0 },
      { tracks: 100, artwork: 0, moves: 0 },
      { tracks: 50, artwork: 0, moves: 1 },
    ]);
    assert.equal(Effect.runSync(store.songsByIds([movedId!]))[0]!.path, "/Startup/moved.mp3");
    assert.equal(Effect.runSync(store.knownFiles(["/Startup"])).length, 250);
    // Artwork alone (read files that saved nothing) still gets its transaction, as on ti.
    saves.length = 0;
    Effect.runSync(
      saveScanBatch(counted, { missing: [], read: [], isIndexed: () => true }, [art], Effect.void),
    );
    assert.deepEqual(saves, [{ tracks: 0, artwork: 1, moves: 0 }]);
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

test("a completed scan that saved nothing still prunes what other saves left, skipping only when nothing wrote since", async () => {
  const { finishScanIndex } = await import("./startupJobs.ts");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(root, fixture.db);
    const ariana = () =>
      Effect.runSync(store.listArtists)
        .filter((artist) => /Ariana|Social House/.test(artist.name))
        .map((artist) => ({
          name: artist.name,
          songs: artist.trackCount,
          image: artist.thumbPath,
        }));
    const file = (path: string, title: string, artist: string, artworkHash: string | null) =>
      scanned(path, title, { artist, album: title }, artworkHash);
    let turns = 0;
    const turn = Effect.sync(() => {
      turns++;
    });
    // A scan brings in a collaboration and completes (a changed scan prunes).
    Effect.runSync(
      store.saveBatch(
        [await file("/Startup/boyfriend.mp3", "boyfriend", "Ariana Grande & Social House", null)],
        [],
        [],
        { linkEntries: false },
      ),
    );
    Effect.runSync(finishScanIndex(store, [], turn));
    // A download lands outside any scan (saveBatch, no prune).
    Effect.runSync(
      store.saveBatch(
        [await file("/Startup/7 rings.mp3", "7 rings", "Ariana Grande", "cover")],
        [{ hash: "cover", path: "/covers/1.jpg", thumbPath: "/covers/1.t.jpg", palette: {} }],
        [],
        { linkEntries: false },
      ),
    );
    const roots = Effect.runSync(store.ensureDefaultRoot("/Startup")).map((row) => row.path);
    // The next rescan finds nothing new or gone; as on ti, its end re-files credits and images.
    turns = 0;
    Effect.runSync(finishScanIndex(store, [], turn));
    assert.equal(turns, 1);
    assert.deepEqual(ariana(), [
      { name: "Ariana Grande", songs: 2, image: "/covers/1.t.jpg" },
      { name: "Social House", songs: 1, image: null },
    ]);
    // Then it records the scan. Nothing else wrote since that prune: the next unchanged scan
    // has nothing to clean up.
    const recorded = traceQueries(fixture.db, () => Effect.runSync(store.markScanned(roots, 1)));
    assert.ok(recorded.queries.some((query) => /^\s*update/i.test(query.sql)));
    const unchanged = traceQueries(fixture.db, () =>
      Effect.runSync(finishScanIndex(store, [], turn)),
    );
    assert.ok(unchanged.queries.every((query) => /^\s*select/i.test(query.sql)));
    assert.ok(unchanged.queries.length <= 1);
    // A changed scan prunes on its own turn.
    turns = 0;
    const gone = await scanned("/Startup/gone.mp3", "Gone");
    const saved = Effect.runSync(store.saveBatch([gone], [], [], { linkEntries: false }));
    Effect.runSync(finishScanIndex(store, [gone.path], turn));
    assert.equal(turns, 1);
    assert.equal(Effect.runSync(store.songsByIds(saved.trackIds)).length, 0);
  } finally {
    fixture.close();
  }
});

test("a new process's first completed scan prunes even when it saved nothing, as on ti", async () => {
  const { finishScanIndex } = await import("./startupJobs.ts");
  const fixture = await createFastAgainFixture();
  try {
    const before = await loadLibraryStore(root, fixture.db);
    const save = async (title: string, artist: string) =>
      Effect.runSync(
        before.saveBatch([await scanned(`/Startup/${title}.mp3`, title, { artist })], [], [], {
          linkEntries: false,
        }),
      );
    await save("boyfriend", "Ariana Grande & Social House");
    Effect.runSync(finishScanIndex(before, [], Effect.void));
    // A download lands, then Wave stops before any scan.
    await save("7 rings", "Ariana Grande");
    // The next launch's scan finds nothing changed; its end still re-files the credits.
    const after = await loadLibraryStore(root, fixture.db);
    Effect.runSync(finishScanIndex(after, [], Effect.void));
    assert.deepEqual(
      Effect.runSync(after.listArtists)
        .filter((artist) => /Ariana|Social House/.test(artist.name))
        .map((artist) => [artist.name, artist.trackCount]),
      [
        ["Ariana Grande", 2],
        ["Social House", 1],
      ],
    );
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
