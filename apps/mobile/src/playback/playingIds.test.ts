import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import { normalizeTrack, type YtSong } from "@wave/core";
import { scanBatchChange } from "../library/scanChanges.ts";
import { loadLibraryStore } from "../../bench/fastAgain/store.ts";
import {
  addLibrary,
  closeTestDatabase,
  openTestDatabase,
  traceQueries,
} from "../library/db/testDatabase.ts";

const tick = () => new Promise((resolve) => setTimeout(resolve, 10));
const root = fileURLToPath(new URL("../../../../", import.meta.url));
const song: YtSong = {
  videoId: "playing",
  title: "Déjà Vu",
  artists: ["Beyoncé"],
  durationMs: 180000,
  album: null,
  explicit: false,
  artworkUrl: null,
};
const track = (
  title = song.title,
  artist = "Beyoncé",
  durationMs = 180000,
  path = "/Music/playing.m4a",
) => ({
  ...normalizeTrack({ path, title, artist, album: "Record", durationMs }),
  sizeBytes: 1000,
  modifiedAt: 0,
  sampleRate: null,
  bitrateKbps: null,
  artworkHash: null,
  hasLyrics: false,
  explicit: "unknown" as const,
});

test("committed scan additions and edits acquire a match without changing playback", async () => {
  const { createPlayingIds } = await import("./playingIds.ts");
  const { makeExternalStore } = await import("../lib/externalStore.ts");
  const bus = await import("../library/libraryChanges.ts");
  const db = await openTestDatabase();
  let stop = () => {};
  try {
    const store = await loadLibraryStore(root, db);
    const target = makeExternalStore({ id: "yt:playing", song });
    const queries: ReturnType<typeof traceQueries>[] = [];
    const ids = createPlayingIds({
      target,
      read: async (playingSong) => {
        const measured = traceQueries(db, () => Effect.runSync(store.matchingSong(playingSong)));
        queries.push(measured);
        return measured.result;
      },
      onDownload: bus.onDownloadedRecording,
      onSavedRecordings: bus.onSavedRecordings,
      onLibraryChange: bus.onLibraryChange,
    });
    const stops = Array.from({ length: 8 }, () => ids.subscribe(() => {}));
    stop = () => stops.forEach((detach) => detach());
    await tick();
    assert.deepEqual([...ids.get()], ["yt:playing"]);
    queries.length = 0;
    const saved = Effect.runSync(store.saveBatch([track()], []));
    bus.publishLibraryChange(scanBatchChange(saved.trackIds));
    // Scan invalidations retain the shared registry's 1.5 s burst coalescing.
    await new Promise((resolve) => setTimeout(resolve, 1600));
    const local = saved.trackIds[0]!;
    assert.deepEqual([...ids.get()], ["yt:playing", String(local)]);
    assert.equal(queries.length, 1, "eight consumers share one targeted scan lookup");
    assert.equal(
      queries[0]!.queries.reduce((sum, query) => sum + query.rows, 0),
      1,
    );

    Effect.runSync(store.removeSongs([local]));
    bus.publishLibraryChange({ kind: "tracks", ids: [local] });
    await tick();
    assert.deepEqual([...ids.get()], ["yt:playing"]);
    const different = Effect.runSync(store.saveBatch([track("Another song")], []));
    bus.publishLibraryChange(scanBatchChange(different.trackIds));
    queries.length = 0;
    Effect.runSync(store.saveBatch([track()], []));
    bus.publishLibraryChange({ kind: "tracks", ids: different.trackIds });
    await new Promise((resolve) => setTimeout(resolve, 1600));
    assert.deepEqual([...ids.get()], ["yt:playing", String(different.trackIds[0])]);
    assert.equal(queries.length, 1, "a committed edit can create a previously unknown match");
  } finally {
    stop();
    closeTestDatabase(db);
  }
});

test("scan bursts retag the matched row with one throttled lookup", async () => {
  const { createPlayingIds } = await import("./playingIds.ts");
  const { makeExternalStore } = await import("../lib/externalStore.ts");
  const bus = await import("../library/libraryChanges.ts");
  const db = await openTestDatabase();
  let stop = () => {};
  try {
    const store = await loadLibraryStore(root, db);
    const saved = Effect.runSync(store.saveBatch([track()], []));
    const ids = createPlayingIds({
      target: makeExternalStore({ id: "yt:playing", song }),
      read: async (playingSong) => Effect.runSync(store.matchingSong(playingSong)),
      onDownload: bus.onDownloadedRecording,
      onSavedRecordings: bus.onSavedRecordings,
      onLibraryChange: bus.onLibraryChange,
    });
    stop = ids.subscribe(() => {});
    await tick();
    assert.deepEqual([...ids.get()], ["yt:playing", String(saved.trackIds[0])]);
    const before = ids.stats().reads;
    Effect.runSync(store.saveBatch([track("Another song")], []));
    for (let index = 0; index < 10; index++)
      bus.publishLibraryChange(scanBatchChange(saved.trackIds));
    await new Promise((resolve) => setTimeout(resolve, 1600));
    assert.deepEqual([...ids.get()], ["yt:playing"]);
    assert.equal(ids.stats().reads, before + 1, "matched-row bursts coalesce into one lookup");
    assert.equal(Effect.runSync(store.matchingSong(song)), null);
  } finally {
    stop();
    closeTestDatabase(db);
  }
});

test("unrelated and rolled-back saves do no lookup, and saved-recording sources detach", async () => {
  const { createPlayingIds } = await import("./playingIds.ts");
  const { makeExternalStore } = await import("../lib/externalStore.ts");
  const bus = await import("../library/libraryChanges.ts");
  const db = await openTestDatabase();
  let stop = () => {};
  try {
    const store = await loadLibraryStore(root, db);
    Effect.runSync(store.saveBatch([track()], []));
    let subscribers = 0;
    let deliveries = 0;
    const ids = createPlayingIds({
      target: makeExternalStore({ id: "yt:playing", song }),
      read: async (playingSong) => Effect.runSync(store.matchingSong(playingSong)),
      onDownload: bus.onDownloadedRecording,
      onSavedRecordings: (listener) => {
        subscribers++;
        const detach = bus.onSavedRecordings((recordings) => {
          deliveries++;
          listener(recordings);
        });
        return () => {
          subscribers--;
          detach();
        };
      },
      onLibraryChange: bus.onLibraryChange,
    });
    const stops = Array.from({ length: 8 }, () => ids.subscribe(() => {}));
    stop = () => stops.forEach((detach) => detach());
    await tick();
    const before = ids.stats().reads;
    const snapshot = ids.get();
    assert.equal(subscribers, 1);
    for (let index = 0; index < 10; index++) {
      for (const unrelated of [
        track("Another song", "Beyoncé", 180000, `/Music/title${index}.m4a`),
        track(song.title, "Another artist", 180000, `/Music/artist${index}.m4a`),
        track(song.title, "Beyoncé", 220000, `/Music/length${index}.m4a`),
      ]) {
        const saved = Effect.runSync(store.saveBatch([unrelated], []));
        bus.publishLibraryChange(scanBatchChange(saved.trackIds));
      }
    }
    assert.equal(deliveries, 30, "each committed batch has one source delivery for eight lists");
    assert.throws(() => Effect.runSync(store.saveBatch([{ ...track(), sizeBytes: null! }], [])));
    assert.equal(deliveries, 30, "a failed transaction announces no saved recording");
    await new Promise((resolve) => setTimeout(resolve, 1600));
    assert.equal(ids.stats().reads, before, "unrelated saves never schedule a targeted lookup");
    assert.equal(ids.get(), snapshot);
    stop();
    assert.equal(subscribers, 0);
    Effect.runSync(store.saveBatch([track()], []));
    assert.equal(deliveries, 30, "detached lists follow no saved recordings");
  } finally {
    stop();
    closeTestDatabase(db);
  }
});

test("eight mounted lists share one source refresh and row read across the playing download", async () => {
  const { createPlayingIds } = await import("./playingIds.ts");
  const { makeExternalStore } = await import("../lib/externalStore.ts");
  const bus = await import("../library/libraryChanges.ts");
  const db = await openTestDatabase();
  try {
    addLibrary(db, { tracks: 1000, artists: 40, albums: 100 });
    const store = await loadLibraryStore(root, db);
    const target = makeExternalStore({
      id: "yt:playing" as string | null,
      song: song as YtSong | null,
    });
    const queries: ReturnType<typeof traceQueries>[] = [];
    let sourceSubscribers = 0;
    const ids = createPlayingIds({
      target,
      read: async (playingSong) => {
        const measured = traceQueries(db, () => Effect.runSync(store.matchingSong(playingSong)));
        queries.push(measured);
        return measured.result;
      },
      onDownload: (listener) => {
        sourceSubscribers++;
        const stop = bus.onDownloadedRecording(listener);
        return () => {
          sourceSubscribers--;
          stop();
        };
      },
      onLibraryChange: bus.onLibraryChange,
      onSavedRecordings: bus.onSavedRecordings,
    });
    let notifications = 0;
    const stops = Array.from({ length: 8 }, () =>
      ids.subscribe(() => {
        notifications++;
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.deepEqual([...ids.get()], ["yt:playing"]);
    assert.equal(sourceSubscribers, 1);
    const before = ids.stats();
    queries.length = 0;
    notifications = 0;
    Effect.runSync(store.saveBatch([track()], []));
    bus.publishDownloadedRecording(track());
    await new Promise((resolve) => setTimeout(resolve, 20));
    const local = Effect.runSync(store.matchingSong(song))!.id;
    assert.deepEqual([...ids.get()], ["yt:playing", String(local)]);
    assert.equal(ids.stats().sourceRefreshes - before.sourceRefreshes, 1);
    assert.equal(ids.stats().reads - before.reads, 1);
    assert.equal(queries.length, 1);
    assert.equal(
      queries.flatMap((q) => q.queries).reduce((n, q) => n + q.rows, 0),
      1,
    );
    assert.equal(notifications, 8, "all eight lists hear their actually changed snapshot");
    const snapshot = ids.get();
    notifications = 0;
    queries.length = 0;
    bus.publishDownloadedRecording(track("Another song"));
    bus.publishLibraryChange({ kind: "tracks", burst: true });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(queries.length, 0);
    bus.publishDownloadedRecording(track());
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(queries.length, 1);
    assert.equal(ids.get(), snapshot);
    assert.equal(notifications, 0, "same row identities never notify");
    Effect.runSync(store.removeSongs([local]));
    bus.publishLibraryChange({ kind: "tracks", ids: [local] });
    await tick();
    assert.deepEqual([...ids.get()], ["yt:playing"]);
    assert.equal(notifications, 8, "removing the matched row clears only its local identity");
    stops.forEach((stop) => stop());
    assert.equal(sourceSubscribers, 0);
  } finally {
    closeTestDatabase(db);
  }
});

test("rapid track changes discard old lookups and unchanged queue metadata never re-reads", async () => {
  const { createPlayingIds } = await import("./playingIds.ts");
  const { makeExternalStore } = await import("../lib/externalStore.ts");
  const bus = await import("../library/libraryChanges.ts");
  const target = makeExternalStore({
    id: "yt:playing" as string | null,
    song: song as YtSong | null,
  });
  const pending: { resolve: (row: { id: number } | null) => void; song: YtSong }[] = [];
  const ids = createPlayingIds({
    target,
    read: (playingSong) =>
      new Promise((resolve) => {
        pending.push({ resolve, song: playingSong });
      }),
    onDownload: bus.onDownloadedRecording,
    onSavedRecordings: bus.onSavedRecordings,
    onLibraryChange: bus.onLibraryChange,
  });
  const seen: string[][] = [];
  const stop = ids.subscribe(() => seen.push([...ids.get()]));
  await tick();
  target.set({ id: "yt:next", song: { ...song, videoId: "next", title: "Next" } });
  await tick();
  pending[0]!.resolve({ id: 7 });
  await tick();
  assert.deepEqual([...ids.get()], ["yt:next"]);
  assert.ok(seen.every((value) => !value.includes("7")));
  pending[1]!.resolve({ id: 9 });
  await tick();
  assert.deepEqual([...ids.get()], ["yt:next", "9"]);
  target.set({ ...target.get(), song: { ...target.get().song! } });
  await tick();
  assert.equal(pending.length, 2);
  target.set({ id: "9", song: null });
  assert.deepEqual([...ids.get()], ["9"]);
  target.set({ id: null, song: null });
  assert.deepEqual([...ids.get()], []);
  await tick();
  assert.equal(pending.length, 2, "local identity and empty queue read nothing");
  stop();
  bus.publishDownloadedRecording(track());
  await tick();
  assert.equal(pending.length, 2, "no subscriber means no source work");
});

test("a download during an in-flight lookup discards its older answer", async () => {
  const { createPlayingIds } = await import("./playingIds.ts");
  const { makeExternalStore } = await import("../lib/externalStore.ts");
  const bus = await import("../library/libraryChanges.ts");
  const target = makeExternalStore({ id: "yt:playing", song });
  const answers: ((row: { id: number } | null) => void)[] = [];
  const ids = createPlayingIds({
    target,
    read: () =>
      new Promise((resolve) => {
        answers.push(resolve);
      }),
    onDownload: bus.onDownloadedRecording,
    onSavedRecordings: bus.onSavedRecordings,
    onLibraryChange: bus.onLibraryChange,
  });
  const seen: string[][] = [];
  const stop = ids.subscribe(() => seen.push([...ids.get()]));
  try {
    await tick();
    bus.publishDownloadedRecording(track());
    answers[0]!({ id: 7 });
    await tick();
    assert.deepEqual([...ids.get()], ["yt:playing"]);
    assert.ok(seen.every((snapshot) => !snapshot.includes("7")));
    assert.equal(answers.length, 2);
    answers[1]!({ id: 8 });
    await tick();
    assert.deepEqual([...ids.get()], ["yt:playing", "8"]);
  } finally {
    stop();
  }
});
