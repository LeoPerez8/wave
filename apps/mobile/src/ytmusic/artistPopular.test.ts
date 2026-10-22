import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_SEARCHES, type YtArtistSaved } from "@wave/core";
import { createArtistOpeningRead } from "./artistOpeningRead.ts";
import type { NativeYtSong } from "../native/waveYtMusic.ts";

const flush = async () => {
  for (let i = 0; i < 5; i++) await new Promise<void>((r) => setImmediate(r));
};
const context = {
  enabled: true,
  settled: false,
  contentReady: true,
  integrated: false,
  always: false,
  pick: "online" as const,
};
const found: YtArtistSaved<import("../native/waveYtMusic.ts").NativeYtSong> = {
  outcome: "found",
  checkedAt: 1000,
  browseId: "justice",
  page: { name: "Justice", songs: [], allSongs: [], albums: [], singles: [] },
};

test("the app's Popular/Online reader sends zero requests before settlement, offline or with Online off, then once", async () => {
  const fresh = { ...found, checkedAt: Date.now() };
  let connected = true;
  let requests = 0;
  const reader = createArtistOpeningRead({
    restore: async () => null,
    request: async (_name, _key, _saved, _signal, allowed) => {
      if (!allowed()) throw { reason: "offline" };
      requests++;
      return fresh;
    },
    online: () => connected,
    allowance: () => NO_SEARCHES,
    always: () => true,
  });
  reader.open("Justice");
  reader.update(context);
  await flush();
  assert.equal(requests, 0);
  connected = false;
  reader.update({ ...context, settled: true });
  await flush();
  assert.equal(requests, 0);
  connected = true;
  reader.update({ ...context, settled: true, pick: "library" });
  await flush();
  assert.equal(requests, 0);
  reader.update({ ...context, settled: true });
  reader.retry();
  await flush();
  assert.equal(requests, 1);
  reader.update({ ...context, settled: true });
  reader.update({ ...context, settled: true });
  await flush();
  assert.equal(requests, 1);
  assert.deepEqual(reader.snapshot().state, { status: "ready", saved: fresh, failure: null });
  reader.close();
});

test("leaving or changing artists aborts the request and an uncooperative late answer cannot publish", async () => {
  const pending: {
    signal: AbortSignal;
    answer: (saved: YtArtistSaved) => void;
    allowed: () => boolean;
  }[] = [];
  const reader = createArtistOpeningRead({
    restore: async () => null,
    request: (_name, _key, _saved, signal, allowed) =>
      new Promise<YtArtistSaved>((answer) => pending.push({ signal, answer, allowed })),
    online: () => true,
    allowance: () => NO_SEARCHES,
    always: () => true,
  });
  reader.open("Justice");
  reader.update({ ...context, settled: true });
  await flush();
  reader.open("Portishead");
  await flush();
  assert.equal(pending[0]!.signal.aborted, true);
  assert.equal(pending[0]!.allowed(), false);
  pending[0]!.answer(found);
  await flush();
  assert.equal(reader.snapshot().key, "portishead");
  assert.equal(reader.snapshot().state.status, "loading");
  reader.close();
  assert.equal(pending[1]!.signal.aborted, true);
  const closed = reader.snapshot();
  pending[1]!.answer(found);
  await flush();
  assert.equal(reader.snapshot(), closed);
});

test("actual fetch/save workflow uses the saved match and keeps a full answer saved meanwhile", async () => {
  const { fetchArtistAnswer } = await import("./artistFetch.ts");
  const Effect = await import("effect/Effect");
  const { resolve } = await import("node:path");
  const { createFastAgainFixture } = await import("../library/db/fastAgainFixture.ts");
  const { loadLibraryStore } = await import("../../bench/fastAgain/store.ts");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(resolve(import.meta.dirname, "../../../.."), fixture.db);
    const full = { ...found, checkedAt: Date.now() };
    let searches = 0;
    let pages = 0;
    const answer = await Effect.runPromise(
      fetchArtistAnswer("Justice", null, {
        search: () =>
          Effect.sync(() => {
            searches++;
            return [{ name: "Justice", browseId: "justice", audience: 50 }];
          }),
        page: () =>
          Effect.sync(() => {
            pages++;
            return full.page;
          }),
        saved: store.ytArtist("justice").pipe(Effect.orElseSucceed(() => null)),
        save: (saved) => store.saveYtArtist("justice", saved).pipe(Effect.ignore),
      }),
    );
    assert.equal(searches, 1);
    assert.equal(pages, 1);
    assert.deepEqual(Effect.runSync(store.ytArtist("justice")), answer);
    const partial = { ...full, page: { name: "Justice", songs: [], albums: [], singles: [] } };
    const kept = await Effect.runPromise(
      fetchArtistAnswer("Justice", partial, {
        search: () => Effect.die("the saved match skips searching"),
        page: () => Effect.succeed(partial.page),
        saved: store.ytArtist("justice").pipe(Effect.orElseSucceed(() => null)),
        save: () => Effect.die("a partial answer must not overwrite the full list"),
      }),
    );
    assert.deepEqual(kept, answer);
  } finally {
    fixture.close();
  }
});

test("switching to Library aborts work and late answers; explicit Online retry waits for settlement", async () => {
  let requests = 0;
  let signal: AbortSignal | undefined;
  let answer: ((saved: YtArtistSaved) => void) | undefined;
  const reader = createArtistOpeningRead({
    restore: async () => null,
    request: (_n, _k, _s, current) => {
      requests++;
      signal = current;
      return new Promise<YtArtistSaved>((r) => {
        answer = r;
      });
    },
    online: () => true,
    allowance: () => NO_SEARCHES,
    always: () => true,
  });
  reader.open("Justice");
  reader.update({ ...context, settled: true });
  await flush();
  assert.equal(requests, 1);
  reader.update({ ...context, settled: true, pick: "library" });
  assert.equal(signal?.aborted, true);
  answer?.(found);
  await flush();
  assert.equal(reader.snapshot().state.status, "ready");
  const canceled = reader.snapshot().state;
  assert.equal(canceled.status === "ready" ? canceled.saved : undefined, null);
  reader.update(context);
  reader.retry();
  await flush();
  assert.equal(requests, 1);
  reader.update({ ...context, settled: true });
  await flush();
  assert.equal(requests, 2);
  reader.close();
});

test("a full allowance waits for its expiry without spending a request; Always on Wi-Fi rechecks the network", async (t) => {
  const { SEARCH_ALLOWANCE, SEARCH_WINDOW_MS } = await import("@wave/core");
  t.mock.timers.enable({ apis: ["Date", "setTimeout"], now: 1000 });
  const allowance = { ...NO_SEARCHES, searchesAt: Array(SEARCH_ALLOWANCE).fill(1000) };
  let wifi = true;
  let requests = 0;
  const reader = createArtistOpeningRead({
    restore: async () => null,
    request: async () => {
      requests++;
      return found;
    },
    online: () => true,
    allowance: () => allowance,
    always: () => wifi,
  });
  reader.open("Justice");
  reader.update({ ...context, settled: true, always: true, pick: null });
  await flush();
  assert.equal(requests, 0);
  wifi = false;
  t.mock.timers.tick(SEARCH_WINDOW_MS);
  await flush();
  assert.equal(requests, 0, "an automatic Wi-Fi read must not follow the phone onto mobile data");
  reader.pick("online");
  await flush();
  assert.equal(requests, 1, "explicit Online has the toggle's on-demand consent on mobile data");
  reader.close();

  // Keep one stable window so its expiry can wake this reader.
  const windowAt = Date.now();
  const waiting = createArtistOpeningRead({
    restore: async () => null,
    request: async () => {
      requests++;
      return found;
    },
    online: () => true,
    allowance: () => ({ ...NO_SEARCHES, searchesAt: Array(SEARCH_ALLOWANCE).fill(windowAt) }),
    always: () => true,
  });
  waiting.open("Justice");
  waiting.update({ ...context, settled: true });
  await flush();
  assert.equal(requests, 1);
  t.mock.timers.tick(SEARCH_WINDOW_MS);
  await flush();
  assert.equal(requests, 2, "the deferred read wakes when the allowance has room");
  waiting.close();
});

test("a settled offline Online page shows the offline note without entering the transport", async () => {
  const reader = createArtistOpeningRead({
    restore: async () => null,
    request: async () => assert.fail("offline never enters transport"),
    online: () => false,
    allowance: () => NO_SEARCHES,
    always: () => true,
  });
  reader.open("Justice");
  reader.update({ ...context, settled: true });
  await flush();
  assert.deepEqual(reader.snapshot().state, { status: "ready", saved: null, failure: "offline" });
  reader.close();
});

test("real-store opening keeps local order offline, then saves one fake-YT answer and reuses its Popular order offline", async () => {
  const { artistPopularSongs } = await import("./artistOpeningRead.ts");
  const { fetchArtistAnswer } = await import("./artistFetch.ts");
  const { artistOpeningRequest } = await import("./artistOpeningRequest.ts");
  const Effect = await import("effect/Effect");
  const { rankPopular, sortSongs } = await import("@wave/core");
  const { resolve } = await import("node:path");
  const { createFastAgainFixture } = await import("../library/db/fastAgainFixture.ts");
  const { traceQueries } = await import("../library/db/testDatabase.ts");
  const { loadLibraryStore } = await import("../../bench/fastAgain/store.ts");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(resolve(import.meta.dirname, "../../../.."), fixture.db);
    const opening = traceQueries(fixture.db, () =>
      Effect.runSync(store.getArtist(fixture.targets.small.artistId))!,
    );
    const detail = opening.result;
    assert.equal(detail.songs.length, 20);
    const songRows = opening.queries
      .filter((q) => /(?:"tracks"|tracks)\.(?:"title"|title)/.test(q.sql))
      .reduce((sum, q) => sum + q.rows, 0);
    assert.equal(songRows, 20, "only this artist's songs are read, in a 1,000-song Library");
    const allSongs = detail.songs.toReversed().map((song, i) => ({
      videoId: `yt-${i}`,
      title: song.title,
      artists: [song.artist],
      album: song.album,
      durationMs: song.durationMs,
      artworkUrl: null,
      albumId: null,
      explicit: false,
    }));
    const fakeYT = {
      calls: [] as string[],
      search: (query: string) =>
        Effect.sync(() => {
          fakeYT.calls.push(`search:${query}`);
          return [{ name: detail.artist.name, browseId: "artist", audience: 100 }];
        }),
      page: () =>
        Effect.sync(() => {
          fakeYT.calls.push("artist");
          return { name: detail.artist.name, songs: allSongs, allSongs, albums: [], singles: [] };
        }),
    };
    let connected = false;
    const create = () =>
      createArtistOpeningRead<import("../native/waveYtMusic.ts").NativeYtSong>({
        restore: (key) =>
          Effect.runPromise(store.ytArtist(key).pipe(Effect.orElseSucceed(() => null))),
        request: (name, key, saved, signal, canSend) =>
          Effect.runPromise(
            artistOpeningRequest(
              canSend,
              fetchArtistAnswer(name, saved, {
                search: fakeYT.search,
                page: fakeYT.page,
                saved: store.ytArtist(key).pipe(Effect.orElseSucceed(() => null)),
                save: (answer) => store.saveYtArtist(key, answer).pipe(Effect.ignore),
              }),
            ),
            { signal },
          ),
        online: () => connected,
        allowance: () => NO_SEARCHES,
        always: () => true,
      });
    const reader = create();
    reader.open(detail.artist.name);
    reader.update({ ...context, pick: "library" });
    await flush();
    assert.equal(artistPopularSongs(reader.snapshot().state), null);
    const local = sortSongs(detail.songs, { key: "popular", descending: false });
    assert.deepEqual(
      local.map((s) => s.id),
      detail.songs.map((s) => s.id),
    );
    assert.deepEqual(fakeYT.calls, []);
    reader.update(context);
    await flush();
    assert.deepEqual(fakeYT.calls, []);
    reader.update({ ...context, settled: true });
    await flush();
    assert.deepEqual(fakeYT.calls, []);
    connected = true;
    reader.update({ ...context, settled: true, pick: "library" });
    await flush();
    assert.deepEqual(fakeYT.calls, []);
    reader.pick("online");
    reader.retry();
    await flush();
    assert.deepEqual(fakeYT.calls, [`search:${detail.artist.name}`, "artist"]);
    const popular = artistPopularSongs(reader.snapshot().state)!;
    const ranked = sortSongs(rankPopular(detail.songs, popular), {
      key: "popular",
      descending: false,
    });
    assert.deepEqual(
      ranked.map((s) => s.id),
      detail.songs.toReversed().map((s) => s.id),
    );
    reader.update({ ...context, settled: true });
    await flush();
    assert.equal(fakeYT.calls.length, 2, "Popular and Online share one request");
    reader.close();
    connected = false;
    const offline = create();
    offline.open(detail.artist.name);
    offline.update({ ...context, enabled: false, pick: "library" });
    await flush();
    assert.deepEqual(
      artistPopularSongs(offline.snapshot().state),
      popular,
      "saved Popular order works offline, YT-off and Online-off",
    );
    assert.equal(fakeYT.calls.length, 2);
    offline.close();
  } finally {
    fixture.close();
  }
});

test("execution-time loss of usable connectivity sends no fake-YT request and saves nothing", async () => {
  const { fetchArtistAnswer } = await import("./artistFetch.ts");
  const { artistOpeningRequest } = await import("./artistOpeningRequest.ts");
  const Effect = await import("effect/Effect");
  const Result = await import("effect/Result");
  let connected = true;
  let requests = 0;
  let saves = 0;
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const reader = createArtistOpeningRead({
    restore: async () => null,
    request: (_name, _key, saved, signal, canSend) =>
      Effect.runPromise(
        Effect.result(
          Effect.promise(() => gate).pipe(
            Effect.andThen(
              artistOpeningRequest(
                canSend,
                fetchArtistAnswer("Justice", saved, {
                  search: () =>
                    Effect.sync(() => {
                      requests++;
                      return [];
                    }),
                  page: () => Effect.die("no page without a match"),
                  saved: Effect.succeed(null),
                  save: () =>
                    Effect.sync(() => {
                      saves++;
                    }),
                }),
              ),
            ),
          ),
        ),
        { signal },
      ).then((result) => {
        if (Result.isFailure(result)) throw result.failure;
        return result.success;
      }),
    online: () => connected,
    allowance: () => NO_SEARCHES,
    always: () => true,
  });
  reader.open("Justice");
  reader.update({ ...context, settled: true });
  await flush();
  assert.equal(reader.snapshot().state.status, "loading");
  connected = false;
  release();
  await flush();
  assert.equal(requests, 0);
  assert.equal(saves, 0);
  assert.deepEqual(reader.snapshot().state, { status: "ready", saved: null, failure: "offline" });
  reader.close();
});

test("outdated saved-data restores cannot replace another artist or start their request", async () => {
  const restores: { signal: AbortSignal; resolve: (saved: YtArtistSaved | null) => void }[] = [];
  let requests = 0;
  const reader = createArtistOpeningRead({
    restore: (_key, signal) =>
      new Promise<YtArtistSaved | null>((resolve) => restores.push({ signal, resolve })),
    request: async () => {
      requests++;
      return found;
    },
    online: () => true,
    allowance: () => NO_SEARCHES,
    always: () => true,
  });
  reader.open("Justice");
  reader.update({ ...context, settled: true });
  reader.open("Portishead");
  assert.equal(restores[0]!.signal.aborted, true);
  restores[0]!.resolve(found);
  await flush();
  assert.equal(reader.snapshot().key, "portishead");
  assert.equal(reader.snapshot().state.status, "reading");
  assert.equal(requests, 0);
  restores[1]!.resolve(null);
  await flush();
  assert.equal(requests, 1);
  reader.close();
});

test("a failed read is not repeated by rerenders, toggles or artist reuse; another page opening can try", async () => {
  let requests = 0;
  const create = () =>
    createArtistOpeningRead({
      restore: async () => null,
      request: async (): Promise<YtArtistSaved> => {
        requests++;
        throw { reason: "failed" };
      },
      online: () => true,
      allowance: () => NO_SEARCHES,
      always: () => true,
    });
  const reader = create();
  reader.open("Justice");
  reader.update({ ...context, settled: true });
  await flush();
  assert.equal(requests, 1);
  reader.update({ ...context, settled: true });
  reader.pick("library");
  reader.pick("online");
  await flush();
  assert.equal(requests, 1);
  reader.open("Portishead");
  await flush();
  assert.equal(requests, 2);
  reader.open("Justice");
  await flush();
  assert.equal(requests, 2);
  assert.deepEqual(
    reader.snapshot().state,
    { status: "ready", saved: null, failure: "failed" },
    "revisiting an attempted artist offers retry instead of an endless loading state",
  );
  reader.close();
  const next = create();
  next.open("Justice");
  next.update({ ...context, settled: true });
  await flush();
  assert.equal(requests, 3);
  next.close();
});

test("canceling a fake-YT page interrupts the actual fetch/save workflow before it writes the real store", async () => {
  const { fetchArtistAnswer } = await import("./artistFetch.ts");
  const { artistOpeningRequest } = await import("./artistOpeningRequest.ts");
  const Effect = await import("effect/Effect");
  const { resolve } = await import("node:path");
  const { createFastAgainFixture } = await import("../library/db/fastAgainFixture.ts");
  const { loadLibraryStore } = await import("../../bench/fastAgain/store.ts");
  const fixture = await createFastAgainFixture();
  try {
    const store = await loadLibraryStore(resolve(import.meta.dirname, "../../../.."), fixture.db);
    let release!: () => void;
    const page = new Promise<void>((done) => {
      release = done;
    });
    let pageSignal: AbortSignal | undefined;
    let searches = 0;
    let pages = 0;
    const reader = createArtistOpeningRead({
      restore: (key) =>
        Effect.runPromise(store.ytArtist(key).pipe(Effect.orElseSucceed(() => null))),
      request: (name, key, saved, signal, canSend) =>
        Effect.runPromise(
          artistOpeningRequest(
            canSend,
            fetchArtistAnswer(name, saved, {
              search: () =>
                Effect.sync(() => {
                  searches++;
                  return [{ name: "Justice", browseId: "justice", audience: 100 }];
                }),
              page: () =>
                Effect.promise(async (transportSignal) => {
                  pages++;
                  pageSignal = transportSignal;
                  await page;
                  return found.page;
                }),
              saved: store.ytArtist(key).pipe(Effect.orElseSucceed(() => null)),
              save: (answer) => store.saveYtArtist(key, answer).pipe(Effect.ignore),
            }),
          ),
          { signal },
        ),
      online: () => true,
      allowance: () => NO_SEARCHES,
      always: () => true,
    });
    reader.open("Justice");
    reader.update({ ...context, settled: true });
    await flush();
    assert.equal(searches, 1);
    assert.equal(pages, 1);
    reader.pick("library");
    await flush();
    assert.equal(pageSignal?.aborted, true);
    release();
    await flush();
    assert.equal(Effect.runSync(store.ytArtist("justice")), null);
    const state = reader.snapshot().state;
    assert.equal(state.status === "ready" ? state.saved : undefined, null);
    reader.close();
  } finally {
    fixture.close();
  }
});

test("closing the page prevents later context updates or retry presses from reviving its work", async () => {
  let requests = 0;
  const reader = createArtistOpeningRead({
    restore: async () => null,
    request: async () => {
      requests++;
      return found;
    },
    online: () => true,
    allowance: () => NO_SEARCHES,
    always: () => true,
  });
  reader.open("Justice");
  reader.update(context);
  await flush();
  reader.close();
  reader.update({ ...context, settled: true });
  reader.retry();
  await flush();
  assert.equal(requests, 0);
});

test("retry presses during a pending request cannot queue a second ask after success", async () => {
  let requests = 0;
  let answer!: (saved: YtArtistSaved) => void;
  const reader = createArtistOpeningRead({
    restore: async () => null,
    request: () => {
      requests++;
      return new Promise<YtArtistSaved>((resolve) => {
        answer = resolve;
      });
    },
    online: () => true,
    allowance: () => NO_SEARCHES,
    always: () => true,
  });
  reader.open("Justice");
  reader.update({ ...context, settled: true });
  await flush();
  reader.retry();
  reader.retry();
  answer({ ...found, checkedAt: Date.now() });
  await flush();
  reader.update({ ...context, settled: true });
  await flush();
  assert.equal(requests, 1);
  reader.close();
});

test("losing screen visibility or YT consent aborts one attempt and cannot auto-retry on return", async () => {
  for (const blocked of [{ settled: false }, { contentReady: false }, { enabled: false }]) {
    let requests = 0;
    let signal!: AbortSignal;
    let allowed!: () => boolean;
    let answer!: (saved: YtArtistSaved) => void;
    const reader = createArtistOpeningRead({
      restore: async () => null,
      request: (_name, _key, _saved, current, canSend) => {
        requests++;
        signal = current;
        allowed = canSend;
        return new Promise<YtArtistSaved>((resolve) => {
          answer = resolve;
        });
      },
      online: () => true,
      allowance: () => NO_SEARCHES,
      always: () => true,
    });
    reader.open("Justice");
    reader.update({ ...context, settled: true });
    await flush();
    assert.equal(requests, 1);
    reader.update({ ...context, settled: true, ...blocked });
    assert.equal(signal.aborted, true);
    assert.equal(allowed(), false);
    answer(found);
    await flush();
    reader.update({ ...context, settled: true });
    await flush();
    assert.equal(requests, 1);
    assert.deepEqual(reader.snapshot().state, { status: "ready", saved: null, failure: "failed" });
    reader.retry();
    await flush();
    assert.equal(requests, 2, "a new explicit Online press is allowed");
    reader.close();
  }
});

test("the fetch workflow rechecks connectivity after search before browsing or saving an unmatched answer", async () => {
  const { fetchArtistAnswer } = await import("./artistFetch.ts");
  const Effect = await import("effect/Effect");
  const Result = await import("effect/Result");
  for (const matched of [true, false]) {
    let connected = true;
    const calls: string[] = [];
    const result = await Effect.runPromise(
      Effect.result(
        fetchArtistAnswer<NativeYtSong, never, never>("Justice", null, {
          canSend: () => connected,
          search: () =>
            Effect.sync(() => {
              calls.push("search");
              connected = false;
              return matched ? [{ name: "Justice", browseId: "justice", audience: 100 }] : [];
            }),
          page: () =>
            Effect.sync((): import("@wave/core").YtArtistPage<NativeYtSong> => {
              calls.push("page");
              return found.page;
            }),
          saved: Effect.succeed(null),
          save: () =>
            Effect.sync(() => {
              calls.push("save");
            }),
        }),
      ),
    );
    assert.deepEqual(calls, ["search"]);
    assert.equal(Result.isFailure(result), true);
  }
});

test("a request waiting to execute rechecks live visibility even before React delivers the context update", async () => {
  let visible = true;
  let allowed!: () => boolean;
  const reader = createArtistOpeningRead({
    restore: async () => null,
    request: (_name, _key, _saved, _signal, canSend) => {
      allowed = canSend;
      return new Promise<YtArtistSaved>(() => {});
    },
    online: () => true,
    allowance: () => NO_SEARCHES,
    always: () => true,
    settled: () => visible,
  });
  reader.open("Justice");
  reader.update({ ...context, settled: true });
  await flush();
  assert.equal(allowed(), true);
  visible = false;
  assert.equal(
    allowed(),
    false,
    "a pending native call must not follow the screen into the background",
  );
  reader.close();
});

test("standing full and unmatched saved answers skip Online transport; partial and expired Online answers refresh once", async () => {
  const fresh = { ...found, checkedAt: Date.now() };
  const partial = { ...fresh, page: { name: "Justice", songs: [], albums: [], singles: [] } };
  const unmatched = { outcome: "unmatched" as const, checkedAt: Date.now() };
  for (const [saved, expectedRequests] of [
    [fresh, 0],
    [unmatched, 0],
    [partial, 1],
    [found, 1],
  ] as const) {
    let requests = 0;
    const reader = createArtistOpeningRead({
      restore: async () => saved,
      request: async () => {
        requests++;
        return fresh;
      },
      online: () => true,
      allowance: () => NO_SEARCHES,
      always: () => true,
    });
    reader.open("Justice");
    reader.update({ ...context, settled: true });
    await flush();
    reader.update({ ...context, settled: true });
    await flush();
    assert.equal(requests, expectedRequests);
    reader.close();
  }
});
