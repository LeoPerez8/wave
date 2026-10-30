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
  export const reset = () => { refreshes = 0; };
  export const readHomeFollow = async () => { refreshes++; throw new Error("cache unavailable"); };
  export const followedArtistsEnabled = () => true;
  export const currentFollowCountry = () => "BR";
  export const ticketmasterKey = "key";
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
  globalThis.fetch = (async (url: string) => ({
    ok: true,
    json: async () =>
      url.includes("ticketmaster") ? { page: { totalElements: 0 } } : { data: [] },
  })) as unknown as typeof fetch;
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
