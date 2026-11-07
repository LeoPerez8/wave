import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import * as Effect from "effect/Effect";

const boundary = `data:text/javascript,${encodeURIComponent(`
  import * as Effect from ${JSON.stringify(import.meta.resolve("effect/Effect"))};
  import * as Context from ${JSON.stringify(import.meta.resolve("effect/Context"))};
  export class LibraryStore extends Context.Service()("test/LibraryStore") {}
  export class YtMusic extends Context.Service()("test/YtMusic") {}
  export let refreshes = 0;
  export const reset = () => {
    refreshes = 0;
    WaveAccount.status = "signedIn";
    WaveAccount.calls.length = 0;
  };
  export const readHomeFollow = async () => { refreshes++; throw new Error("cache unavailable"); };
  export const followedArtistsEnabled = () => true;
  export const currentFollowCountry = () => "BR";
  export const showsConfigured = true;
  export const WaveAccount = {
    status: "signedIn",
    calls: [],
    answer: (path) => ({
      status: 200,
      body: JSON.stringify(
        path.includes("/attractions")
          ? { _embedded: { attractions: [{ id: "K1", name: "ABBA", classifications: [{ segment: { name: "Music" } }] }] } }
          : { page: { totalElements: 0 } },
      ),
    }),
    session: async () => ({ status: WaveAccount.status }),
    request: async (method, path, body) => {
      WaveAccount.calls.push(method + " " + path);
      return WaveAccount.answer(path);
    },
  };
  export const waveAccountErrorCode = (error) =>
    typeof error?.code === "string" && error.code.startsWith("ERR_WAVE_") ? error.code : null;
  export const showsNotificationsEnabled = () => false;
  export const ytMusicEnabled = () => false;
  export const online = () => true;
  export const WaveNative = {};
  export const currentLocalisation = () => ({});
  export const settledTurnEffect = Effect.void;
  export const withSearchTurn = (_kind, _query, read) => read;
  export const appRuntime = {};
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/") || specifier === "./knownHomeFollow")
      return { url: boundary, shortCircuit: true };
    if (specifier.startsWith("./") && !specifier.endsWith(".ts"))
      return next(specifier + ".ts", context);
    return next(specifier, context);
  },
});
const { checkFollowShows } = await import("./followShows.ts");
const { checkFollowReleases } = await import("./followReleases.ts");
const io = await import(boundary);
hooks.deregister();

test("cache read failures leave checks successful; nothing due performs no feed refresh", async () => {
  const follow = {
    key: "abba",
    name: "ABBA",
    level: "shows",
    followedAt: Date.now(),
    deezerId: 1,
    ytBrowseId: null,
  };
  let showsAt = 0;
  let releasesAt = 0;
  let releaseSaves = 0;
  const store = {
    listFollows: Effect.succeed([follow]),
    followShowCache: Effect.sync(() => ({
      artists: [{ key: "abba", attractionId: "K1", country: "BR", checkedAt: showsAt, shows: [] }],
      notified: [],
    })),
    followReleaseCache: Effect.sync(() => ({
      artists: [{ key: "abba", checkedAt: releasesAt, releases: [] }],
      hidden: [],
    })),
    getFollow: () => Effect.succeed(follow),
    saveFollowShows: (row: { checkedAt: number }) =>
      Effect.sync(() => {
        showsAt = row.checkedAt;
      }),
    saveFollowReleases: (_key: string, _releases: unknown, at: number) =>
      Effect.sync(() => {
        releasesAt = at;
        releaseSaves++;
      }),
  };
  const run = (effect: Effect.Effect<unknown, unknown, unknown>) =>
    Effect.runPromise(
      effect.pipe(
        Effect.provideService(io.LibraryStore, store),
        Effect.provideService(io.YtMusic, {}),
      ) as Effect.Effect<unknown, unknown>,
    );
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    assert.ok(!url.includes("ticketmaster"), "Ticketmaster is asked only through the sync service");
    return { ok: true, json: async () => ({ data: [] }) };
  }) as unknown as typeof fetch;
  try {
    io.reset();
    assert.equal(await run(checkFollowShows()), true);
    assert.equal(io.refreshes, 1);
    assert.equal(await run(checkFollowReleases(false)), true);
    assert.equal(releaseSaves, 1);
    assert.equal(io.refreshes, 2);
    assert.equal(await run(checkFollowReleases(false)), false);
    assert.equal(await run(checkFollowShows()), false);
    assert.equal(io.refreshes, 2, "no redundant full feed reads when nothing changed");
    releasesAt = 0;
    assert.equal(await run(checkFollowReleases(false, "home", false)), true);
    assert.equal(io.refreshes, 2, "Home owns its one visit refresh");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/** A store of [follows] at shows, recording the shows each check saves. */
const showsStore = (follows: readonly { key: string; name: string; attractionId?: string }[]) => {
  const saved: string[] = [];
  const store = {
    listFollows: Effect.succeed(
      follows.map((f) => ({
        key: f.key,
        name: f.name,
        level: "shows",
        followedAt: 1,
        deezerId: 1,
        ytBrowseId: null,
      })),
    ),
    followShowCache: Effect.sync(() => ({
      artists: follows.flatMap((f) =>
        f.attractionId === undefined
          ? []
          : [{ key: f.key, attractionId: f.attractionId, country: "BR", checkedAt: 0, shows: [] }],
      ),
      notified: [],
    })),
    getFollow: (name: string) =>
      Effect.succeed({
        key: name.toLowerCase(),
        name,
        level: "shows",
        followedAt: 1,
        deezerId: 1,
        ytBrowseId: null,
      }),
    saveFollowShows: (row: { key: string; checkedAt: number }) =>
      Effect.sync(() => {
        if (row.checkedAt > 0) saved.push(row.key);
      }),
    markShowNotified: () => Effect.succeed(false),
  };
  const run = (effect: Effect.Effect<unknown, unknown, unknown>) =>
    Effect.runPromise(
      effect.pipe(Effect.provideService(io.LibraryStore, store)) as Effect.Effect<unknown, unknown>,
    );
  return { saved, run };
};

test("a show check asks the sync service's Ticketmaster routes with the Wave account's session", async () => {
  io.reset();
  const { saved, run } = showsStore([{ key: "abba", name: "ABBA" }]);
  assert.equal(await run(checkFollowShows("background", false)), true);
  assert.deepEqual(io.WaveAccount.calls, [
    "GET /v1/ticketmaster/attractions?keyword=ABBA",
    "GET /v1/ticketmaster/events?attractionId=K1&countryCode=BR",
  ]);
  assert.deepEqual(saved, ["abba"]);
});

test("signed out, a show check stops quietly before any request", async () => {
  io.reset();
  io.WaveAccount.status = "signedOut";
  const { saved, run } = showsStore([{ key: "abba", name: "ABBA", attractionId: "K1" }]);
  assert.equal(await run(checkFollowShows("background", false)), false);
  assert.deepEqual(io.WaveAccount.calls, []);
  assert.deepEqual(saved, []);
});

test("a session that ends during a show check stops it: no other artist is asked", async () => {
  io.reset();
  const answer = io.WaveAccount.answer;
  io.WaveAccount.answer = () => {
    throw Object.assign(new Error("Your Wave session ended"), { code: "ERR_WAVE_SESSION_ENDED" });
  };
  try {
    const { saved, run } = showsStore([
      { key: "abba", name: "ABBA", attractionId: "K1" },
      { key: "aurora", name: "Aurora", attractionId: "K2" },
    ]);
    assert.equal(await run(checkFollowShows("background", false)), false);
    assert.deepEqual(io.WaveAccount.calls, [
      "GET /v1/ticketmaster/events?attractionId=K1&countryCode=BR",
    ]);
    assert.deepEqual(saved, []);
  } finally {
    io.WaveAccount.answer = answer;
  }
});

test("a refused or failed answer from the service leaves that artist for the next check", async () => {
  io.reset();
  const answer = io.WaveAccount.answer;
  io.WaveAccount.answer = (path: string) =>
    path.includes("K1") ? { status: 502, body: '{"error":"upstream_failed"}' } : answer(path);
  try {
    const { saved, run } = showsStore([
      { key: "abba", name: "ABBA", attractionId: "K1" },
      { key: "aurora", name: "Aurora", attractionId: "K2" },
    ]);
    assert.equal(await run(checkFollowShows("background", false)), true);
    assert.deepEqual(saved, ["aurora"]);
  } finally {
    io.WaveAccount.answer = answer;
  }
});
