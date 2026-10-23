import assert from "node:assert/strict";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import * as Effect from "effect/Effect";
import { normalizeTrack, type YtSong } from "@wave/core";
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
