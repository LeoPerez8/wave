import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

import { makeExternalStore } from "../lib/externalStore.ts";

/** What the app's boundaries answer in this file. */
const app = {
  settle: async (): Promise<void> => {},
  settleWaits: 0,
  reads: 0,
  read: async (_signal: AbortSignal): Promise<void> => {},
  lines: [] as string[],
};
Object.assign(globalThis, { playlistVisitApp: app });

const boundary = `data:text/javascript,${encodeURIComponent(`
  import * as Effect from ${JSON.stringify(import.meta.resolve("effect/Effect"))};
  import * as Context from ${JSON.stringify(import.meta.resolve("effect/Context"))};
  const app = globalThis.playlistVisitApp;
  const song = (id) => ({ id, source: "library", videoId: "", title: id, artists: ["Artist " + id],
    album: null, albumId: null, durationMs: 180000, artworkUrl: null, explicit: false, genre: "Rock" });
  const seed = song("seed");
  const library = [seed, ..."abcdefghijkl".split("").map(song)];
  export class LibraryStore extends Context.Service()("test/LibraryStore") {}
  const store = { dismissPlaylistRecommendation: () => Effect.void };
  export const appRuntime = {
    runPromise: (effect, options) =>
      Effect.runPromise(Effect.provideService(effect, LibraryStore, store), options),
  };
  export const settledTurnEffect = Effect.promise(() => {
    app.settleWaits++;
    return app.settle();
  });
  export const recommendationTurnEffect = Effect.void;
  export const recommendationTurn = async () => {};
  export const afterPaint = async () => {};
  export const appLog = (_level, _tag, line) => { app.lines.push(line); };
  export const online = () => true;
  export const lookedUpProfileOf = () => undefined;
  export const playlistsChanged = () => {};
  export const recommendationSnapshot = {
    graph: Effect.void,
    library: Effect.void,
    peek: () => ({ graph: null, library: null }),
  };
  export const recommendationFavorites = { get: Effect.void, peek: () => null };
  export const sharePlaylistRecommendationInputs = () => ({
    latest: () =>
      Effect.promise(async (signal) => {
        app.reads++;
        await app.read(signal);
        return {
          playlist: [seed],
          library,
          songById: new Map(library.map((row) => [row.id, row])),
        };
      }),
  });
  export const playlistSuggestionSeeds = () => [seed];
  export const playlistSuggestionRadios = () =>
    Effect.succeed([{ id: "song:seed", artists: seed.artists, songs: library }]);
`)}`;
const REAL = new Set(["@/lib/externalStore", "@/lib/sight", "@/lib/stepped"]);
const MOCKED = new Set([
  "./LibraryStore",
  "./runtime",
  "./playlists",
  "./playlistRecommendationInputs",
  "./playlistSuggestionRadios",
]);
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (REAL.has(specifier))
      return next(new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href, context);
    if (specifier.startsWith("@/") || MOCKED.has(specifier))
      return { url: boundary, shortCircuit: true };
    if (specifier.startsWith("./") && !/\.[cm]?[jt]s$/.test(specifier))
      return next(specifier + ".ts", context);
    return next(specifier, context);
  },
});
const { createPlaylistSuggestionsVisit } = await import("./playlistSuggestionsVisit.ts");
const { publishLibraryChange } = await import("./libraryChanges.ts");
hooks.deregister();

const settledFrames = async () => {
  for (let i = 0; i < 5; i++) await setImmediate();
};

const opened = () => {
  const screen = (() => {
    let visible = true;
    const listeners = new Set<(visible: boolean) => void>();
    return {
      visible: () => visible,
      subscribe: (listener: (visible: boolean) => void) => {
        listeners.add(listener);
        return () => {
          listeners.delete(listener);
        };
      },
      show: (value: boolean) => {
        visible = value;
        for (const listener of listeners) listener(value);
      },
    };
  })();
  const wanted = makeExternalStore(true);
  const sectionSight = makeExternalStore<number | null>(null);
  const visit = createPlaylistSuggestionsVisit(7);
  return { visit, screen, wanted, sectionSight };
};

const reset = () => {
  app.settle = async () => {};
  app.settleWaits = 0;
  app.reads = 0;
  app.read = async () => {};
  app.lines = [];
};
const offerIds = (visit: ReturnType<typeof createPlaylistSuggestionsVisit>) =>
  visit.session.get().slots.map((offer) => offer?.track.id ?? null);

test("opening reads the radios once the screen settled, one wait for it, with the section nowhere", async () => {
  reset();
  const settled = Promise.withResolvers<void>();
  app.settle = () => settled.promise;
  const { visit, screen, wanted, sectionSight } = opened();
  const stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  assert.equal(app.reads, 0, "nothing reads before the screen settled");
  settled.resolve();
  await settledFrames();
  assert.equal(app.reads, 1);
  assert.equal(app.settleWaits, 1, "the renewal waits for the app to settle once");
  assert.deepEqual(offerIds(visit), ["a", "b", "c", "d", "e"]);
  stop();
});

test("the section scrolling out of sight and back keeps its offers and renews nothing", async () => {
  reset();
  const { visit, screen, wanted, sectionSight } = opened();
  const stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  const offers = visit.session.get().slots;
  for (const at of [1000, null, 2000, null, 3000]) {
    sectionSight.set(at);
    await settledFrames();
  }
  assert.equal(app.reads, 1);
  assert.equal(visit.session.get().slots, offers);
  stop();
});

test("offers ready before the section came into sight log a wait of 0 ms, once for the visit", async () => {
  reset();
  const { visit, screen, wanted, sectionSight } = opened();
  const stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  sectionSight.set(Date.now() + 60_000);
  sectionSight.set(null);
  sectionSight.set(Date.now() + 120_000);
  const lines = app.lines.filter((line) => line.includes("in sight"));
  assert.equal(lines.length, 1);
  assert.match(lines[0]!, /5 offers after 0 ms/);
  stop();
});

test("while the section isn't wanted nothing reads; once wanted it renews once", async () => {
  reset();
  const { visit, screen, wanted, sectionSight } = opened();
  wanted.set(false);
  const stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  publishLibraryChange({ kind: "playlists", ids: [7] });
  await settledFrames();
  assert.equal(app.reads, 0);
  assert.equal(visit.session.get().loading, true);
  wanted.set(true);
  await settledFrames();
  assert.equal(app.reads, 1);
  stop();
});

test("the section leaving for a while keeps a finished renewal's offers and cancels one under way", async () => {
  reset();
  const { visit, screen, wanted, sectionSight } = opened();
  const stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  // Find or selection opens and closes: the offers stand, with nothing new read.
  wanted.set(false);
  await settledFrames();
  wanted.set(true);
  await settledFrames();
  assert.equal(app.reads, 1);
  // An edit starts a read; Find opens over it, which cancels it, and closing asks again.
  let cancelled: AbortSignal | undefined;
  const held = Promise.withResolvers<void>();
  app.read = async (signal) => {
    cancelled = signal;
    await held.promise;
  };
  publishLibraryChange({ kind: "playlists", ids: [7] });
  await settledFrames();
  assert.equal(app.reads, 2);
  wanted.set(false);
  await settledFrames();
  assert.equal(cancelled?.aborted, true);
  app.read = async () => {};
  wanted.set(true);
  await settledFrames();
  assert.equal(app.reads, 3);
  assert.equal(visit.session.get().loading, false);
  stop();
});

test("leaving the playlist cancels the read under way", async () => {
  reset();
  let cancelled: AbortSignal | undefined;
  const held = Promise.withResolvers<void>();
  app.read = async (signal) => {
    cancelled = signal;
    await held.promise;
  };
  const { visit, screen, wanted, sectionSight } = opened();
  const stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  assert.equal(app.reads, 1);
  stop();
  await settledFrames();
  assert.equal(cancelled?.aborted, true);
});

test("an offer's Library row stays readable through refills with the section unmounted", async () => {
  reset();
  const { visit, screen, wanted, sectionSight } = opened();
  const stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  for (const index of [0, 1]) {
    const offer = visit.session.get().slots[index]!;
    assert.equal(await visit.session.dismiss(offer.key), true);
  }
  const shown = visit.session.get().slots.flatMap((offer) => offer?.track.id ?? []);
  assert.equal(shown.length, 5);
  for (const id of shown)
    assert.equal(visit.libraryRows.get().get(id)?.id, id, `the row of offer ${id}`);
  stop();
});
