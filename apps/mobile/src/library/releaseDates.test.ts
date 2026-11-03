import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { stripTypeScriptTypes } from "node:module";
import { followReleaseEligibility } from "./releaseEligibility.ts";
import * as core from "../../../../packages/core/src/index.ts";

const harness = () => {
  const listeners: Record<string, (...args: unknown[]) => void> = {};
  const timers = new Map<number, () => void>();
  let reads = 0;
  let failRead = false;
  let failSave = false;
  let eligible = true;
  let status: unknown = null;
  let interrupt: (() => void) | undefined;
  let stopped = false;
  const answers: Record<string, core.ReleaseAnswer> = {};
  const playlists = [{ id: 1 }, { id: 2 }];
  // Each playlist's sort, by sync id (here its id); Custom when absent.
  const sorts: Record<string, string> = { "1": "releaseDate" };
  const songs = [{ id: 1, title: "Song", artist: "Artist", year: null, original: null }];
  const store = {
    saveReleaseDate: () => {
      if (failSave) throw Error("save release date");
      return null;
    },
    get listPlaylists() {
      return playlists;
    },
    get listSongs() {
      reads++;
      if (failRead) throw Error("read");
      return songs;
    },
    getPlaylist: (id: number) => {
      reads++;
      return { items: id === 1 ? [] : [{ source: "stream", song: songs[0] }] };
    },
  };
  const subscribe = (name: string) => (fn: (...args: unknown[]) => void) => {
    listeners[name] = fn;
    return () => {};
  };
  const deps = {
    ...core,
    persistedSetting: ({ key }: { key: string }) => ({
      get: () => (key.endsWith("notice") ? true : null),
      set: (value: unknown) => {
        if (key.endsWith("backgroundProgress")) status = value;
      },
    }),
    onMobileData: () => false,
    ytMusicEnabled: () => eligible,
    searchOnline: { get: () => "always", subscribe: subscribe("preference") },
    subscribeConnectivity: subscribe("connectivity"),
    subscribeYtMusicEnabled: subscribe("yt"),
    onPlaylistSongSortChanged: subscribe("sort"),
    onPlaylistsEdited: subscribe("edit"),
    onLibraryChange: subscribe("library"),
    onTypedReleaseDatesChanged: subscribe("typed"),
    followReleaseEligibility,
    playlistSongSetting: (id: string) => ({
      get: () => ({ key: sorts[id] ?? "custom" }),
    }),
    LibraryStore: { use: (fn: (value: typeof store) => unknown) => fn(store) },
    appRuntime: { runPromise: async (value: unknown) => value },
    releaseAnswers: {
      get: () => answers,
      put: (key: string, value: core.ReleaseAnswer) => {
        answers[key] = value;
      },
    },
    libraryReleaseSong: (song: unknown) => song,
    entryReleaseSong: (entry: { song: unknown }) => entry.song,
    heldReleaseDate: () => null,
    releaseLookupClient: () => ({}),
    lookUpReleaseDates: async ({
      songs,
      going,
      progress,
    }: Parameters<typeof core.lookUpReleaseDates>[0]) => {
      progress({ done: 0, total: songs.length, offline: false });
      interrupt?.();
      stopped ||= !going();
      for (const song of songs)
        answers[song.key] = { date: null, source: "unknown", retryAt: null };
      return "done";
    },
    setTimeout: (fn: () => void, ms: number) => {
      timers.set(ms, fn);
      return ms;
    },
    clearTimeout: (id: number) => timers.delete(id),
  };
  const source = readFileSync(new URL("./releaseDates.ts", import.meta.url), "utf8")
    .replace(/import[\s\S]*?from "[^"]+";/g, "")
    .replace(/export /g, "");
  const code = stripTypeScriptTypes(source);
  const start = () =>
    new Function(...Object.keys(deps), `${code}\nreturn startReleaseDates;`)(
      ...Object.values(deps),
    )();
  const settle = async () => {
    for (let i = 0; i < 80; i++) await Promise.resolve();
  };
  return {
    start,
    settle,
    sorts,
    answers,
    listeners,
    timers,
    deps,
    songs,
    get stopped() {
      return stopped;
    },
    get reads() {
      return reads;
    },
    get status() {
      return status;
    },
    set failSave(value: boolean) {
      failSave = value;
    },
    set failRead(value: boolean) {
      failRead = value;
    },
    set interrupt(fn: () => void) {
      interrupt = fn;
    },
    set eligible(value: boolean) {
      eligible = value;
    },
  };
};

test("idle eligibility and typed-date triggers reuse songs without reads", async () => {
  const h = harness();
  h.start();
  await h.settle();
  const reads = h.reads;
  h.listeners.connectivity!();
  h.listeners.typed!();
  h.timers.get(2000)?.();
  await h.settle();
  assert.equal(h.reads, reads);
});

test("unsorted playlist edits do not interrupt general lookup", async () => {
  const h = harness();
  h.interrupt = () => h.listeners.library!({ kind: "playlists", ids: [2] });
  h.start();
  await h.settle();
  assert.equal(h.status, null);
  assert.equal(h.stopped, false);
});

test("read exceptions clear progress and schedule retry", async () => {
  const h = harness();
  h.failRead = true;
  h.start();
  await h.settle();
  assert.equal(h.status, null);
  assert.ok([...h.timers.keys()].some((ms) => ms > 2000 && ms <= 60000));
});

test("failed jobs preserve an earlier group's retry deadline", async () => {
  const h = harness();
  h.deps.lookUpReleaseDates = async () => "failed";
  // First sorted group waits ten seconds; the general group's failure retries in a minute.
  let calls = 0;
  h.deps.releaseNextDue = () => (++calls === 1 ? Date.now() + 10000 : Date.now());
  h.start();
  await h.settle();
  assert.ok([...h.timers.keys()].some((ms) => ms > 0 && ms <= 10000));
});

test("exceptions while keeping an answer clear progress and retry", async () => {
  const h = harness();
  h.failSave = true;
  h.deps.lookUpReleaseDates = async ({
    songs,
    answered,
    progress,
  }: Parameters<typeof core.lookUpReleaseDates>[0]) => {
    progress({ done: 0, total: songs.length, offline: false });
    await answered(songs[0]!, { source: "first-release", date: "2000", retryAt: null });
    return "done";
  };
  h.start();
  await h.settle();
  assert.equal(h.status, null);
  assert.ok([...h.timers.keys()].some((ms) => ms > 2000 && ms <= 60000));
});

test("a scan invalidates cached songs and picks up a newly due track", async () => {
  const h = harness();
  h.start();
  await h.settle();
  h.songs.push({ id: 2, title: "New", artist: "Artist", year: null, original: null });
  const reads = h.reads;
  h.listeners.library!({ kind: "tracks", ids: [2] });
  h.timers.get(2000)?.();
  await h.settle();
  assert.ok(h.reads > reads);
  assert.ok(h.deps.releaseAnswers.get()[core.releaseAnswerKey(h.songs[1]!)]);
});

test("a read exception retries without another external trigger", async () => {
  const h = harness();
  h.failRead = true;
  h.start();
  await h.settle();
  h.failRead = false;
  const retry = [...h.timers.entries()].find(([ms]) => ms > 2000)!;
  retry[1]();
  await h.settle();
  assert.ok(Object.keys(h.deps.releaseAnswers.get()).length > 0);
  assert.equal(h.status, null);
});

test("choosing Release date asks again about songs the general lookup didn't date", async () => {
  const h = harness();
  const asked: string[][] = [];
  h.deps.lookUpReleaseDates = async ({
    songs,
    answered,
  }: Parameters<typeof core.lookUpReleaseDates>[0]) => {
    const now = Date.now();
    const due = songs.filter((song) => core.releaseDue(song, song.held, song.answer, now));
    asked.push(due.map((song) => song.title));
    for (const song of due)
      await answered(song, {
        date: null,
        source: "unknown",
        retryAt: now + 30 * 86_400_000,
        version: core.RELEASE_LOOKUP_VERSION,
      });
    return "done";
  };
  h.start();
  await h.settle();
  // The general lookup found nothing for the Library song, also playlist 2's YT Music entry.
  assert.deepEqual(asked, [["Song", "Song"]]);
  h.sorts["2"] = "releaseDate";
  h.listeners.sort!();
  h.timers.get(2000)?.();
  await h.settle();
  assert.deepEqual(asked, [["Song", "Song"], ["Song"]]);
  // Only the choice asks: the next run waits for the retry again.
  h.listeners.typed!();
  h.timers.get(2000)?.();
  await h.settle();
  assert.equal(asked.length, 2);
});

test("a playlist already on Release date at launch waits for its songs' retries", async () => {
  const h = harness();
  h.sorts["2"] = "releaseDate";
  const key = core.releaseAnswerKey(h.songs[0]!);
  h.answers[key] = {
    date: null,
    source: "unknown",
    retryAt: Date.now() + 86_400_000,
    version: core.RELEASE_LOOKUP_VERSION,
  };
  let calls = 0;
  h.deps.lookUpReleaseDates = async () => {
    calls++;
    return "done";
  };
  h.start();
  await h.settle();
  assert.equal(calls, 0);
});
