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
  online: true,
  stored: new Map<string, string>(),
  letters: "abcdefghijkl",
  radio: "abcdefghijkl",
  playlist: ["seed"],
};
Object.assign(globalThis, { playlistVisitApp: app });

const boundary = `data:text/javascript,${encodeURIComponent(`
  import * as Effect from ${JSON.stringify(import.meta.resolve("effect/Effect"))};
  import * as Context from ${JSON.stringify(import.meta.resolve("effect/Context"))};
  const app = globalThis.playlistVisitApp;
  const song = (id) => ({ id, source: "library", videoId: "", title: id, artists: ["Artist " + id],
    album: null, albumId: null, durationMs: 180000, artworkUrl: null, explicit: false, genre: "Rock" });
  const row = (id) => ({ id, path: "/" + id, title: id, artist: "Artist " + id, album: "",
    durationMs: 180000, thumbPath: null, artworkPath: null, titleSort: id, artistSort: id, albumSort: id,
    addedAt: 0, albumId: 1, artistId: 1, artistIds: [1], discNumber: null, trackNumber: null, year: null,
    genre: "Rock", hasLyrics: false, explicit: "unknown" });
  const seed = song("seed");
  const libraryNow = () => [seed, ...app.letters.split("").map(song)];
  export class LibraryStore extends Context.Service()("test/LibraryStore") {}
  const store = {
    dismissPlaylistRecommendation: () => Effect.void,
    acceptPlaylistRecommendation: (_id, offer) => Effect.sync(() => {
      app.playlist = [...app.playlist, offer.track.id];
      return true;
    }),
  };
  export const Storage = {
    getItemSync: (key) => app.stored.get(key) ?? null,
    setItemSync: (key, value) => { app.stored.set(key, value); },
    removeItemSync: (key) => app.stored.delete(key),
  };
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
  export const online = () => app.online;
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
        const library = libraryNow();
        return {
          playlist: app.playlist.map(song),
          library,
          songById: new Map(library.map(({ id }) => [id, row(id)])),
        };
      }),
  });
  export const playlistSuggestionSeeds = () => [seed];
  export const playlistSuggestionRadios = () =>
    Effect.succeed([{ id: "song:seed", artists: seed.artists, songs: app.radio.split("").map(song) }]);
`)}`;
const REAL = new Set(["@/lib/externalStore", "@/lib/sight", "@/lib/stepped"]);
const MOCKED = new Set([
  "expo-sqlite/kv-store",
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
  app.online = true;
  app.stored = new Map();
  app.letters = "abcdefghijkl";
  app.radio = "abcdefghijkl";
  app.playlist = ["seed"];
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

/** A whole visit: opened, its renewal done, left. */
const visited = async () => {
  const { visit, screen, wanted, sectionSight } = opened();
  const stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  stop();
  return visit;
};

test("coming back shows the last offers before anything reads, with their Library rows", async () => {
  reset();
  await visited();
  app.reads = 0;
  const { visit } = opened();
  assert.deepEqual(offerIds(visit), ["a", "b", "c", "d", "e"]);
  assert.equal(visit.session.get().loading, false);
  assert.equal(app.reads, 0);
  for (const id of offerIds(visit))
    assert.equal(visit.libraryRows.get().get(id!)?.id, id, `the row of offer ${id}`);
});

test("a first visit with nothing saved waits for its offers", () => {
  reset();
  const { visit } = opened();
  assert.deepEqual(offerIds(visit), []);
  assert.equal(visit.session.get().loading, true);
});

test("a renewal over saved offers leaves them, and its offers show on the next visit", async () => {
  reset();
  await visited();
  app.letters = "abcdefghijklmnopqrstuvwx";
  app.radio = "mnopqrstuvwx";
  const { visit, screen, wanted, sectionSight } = opened();
  const offers = visit.session.get().slots;
  const stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  assert.equal(app.reads, 2);
  assert.equal(visit.session.get().slots, offers);
  stop();
  const { visit: next } = opened();
  assert.deepEqual(offerIds(next), ["m", "n", "o", "p", "q"]);
});

test("a dismissed or added song isn't offered from saved offers on the next visit", async () => {
  reset();
  await visited();
  const { visit, screen, wanted, sectionSight } = opened();
  const stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  const [first, second] = visit.session.get().slots;
  assert.equal(await visit.session.dismiss(first!.key), true);
  assert.equal(await visit.session.accept(second!.key), true);
  stop();
  const ids = offerIds(opened().visit);
  assert.equal(ids.includes(first!.track.id), false);
  assert.equal(ids.includes(second!.track.id), false);
  assert.equal(ids.length, 5, "spares take their places");
});

test("a song the playlist now holds leaves the first read of its entries, with no reads", async () => {
  reset();
  await visited();
  app.reads = 0;
  const { visit } = opened();
  const held = (id: string) => ({ source: "library", track: { id } }) as never;
  visit.playlistRead([held("c"), held("zz")]);
  assert.deepEqual(offerIds(visit), ["a", "b", "f", "d", "e"]);
  assert.equal(visit.libraryRows.get().get("f")?.id, "f");
  assert.equal(app.reads, 0);
  assert.equal(offerIds(opened().visit).includes("c"), false);
});

test("a failed renewal over saved offers logs a line and shows nothing", async () => {
  reset();
  await visited();
  app.lines = [];
  app.read = async () => {
    throw new Error("no network");
  };
  const { visit, screen, wanted, sectionSight } = opened();
  const offers = visit.session.get();
  const stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  assert.equal(visit.session.get(), offers);
  assert.equal(visit.session.get().error, null);
  assert.ok(app.lines.some((line) => /Playlist suggestions failed renewing/.test(line)));
  stop();
});

test("offers shown at once log a wait of 0 ms and the renewal behind them as a renewal", async () => {
  reset();
  await visited();
  app.lines = [];
  const { visit, screen, wanted, sectionSight } = opened();
  const stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  sectionSight.set(Date.now());
  assert.ok(app.lines.some((line) => /in sight: 5 offers after 0 ms/.test(line)));
  assert.ok(app.lines.some((line) => /Playlist suggestions renewed/.test(line)));
  stop();
});

test("unreadable saved offers count as nothing saved", async () => {
  reset();
  await visited();
  for (const key of app.stored.keys()) app.stored.set(key, "not json");
  const { visit } = opened();
  assert.deepEqual(offerIds(visit), []);
  assert.equal(visit.session.get().loading, true);
});

test("a saved Library offer without a readable row isn't shown", async () => {
  reset();
  await visited();
  for (const [key, text] of app.stored)
    if (text.startsWith("[{"))
      app.stored.set(
        key,
        JSON.stringify(JSON.parse(text).map(({ track }: { track: unknown }) => ({ track }))),
      );
  assert.deepEqual(offerIds(opened().visit), []);
});

test("a saved row an older version wrote, without a field rows now have, isn't shown", async () => {
  reset();
  await visited();
  for (const [key, text] of app.stored)
    if (text.startsWith("[{"))
      app.stored.set(
        key,
        JSON.stringify(
          JSON.parse(text).map((offer: { track: { id: string }; row: { hasLyrics?: boolean } }) => {
            if (offer.track.id === "b") delete offer.row.hasLyrics;
            return offer;
          }),
        ),
      );
  assert.deepEqual(offerIds(opened().visit), ["a", "c", "d", "e", "f"]);
});

test("saved offers keep the latest 200 playlists and drop the rest from the phone", async () => {
  reset();
  for (let id = 1; id <= 201; id++) {
    const { screen, wanted, sectionSight } = opened();
    const visit = createPlaylistSuggestionsVisit(id);
    const stop = visit.follow(screen, wanted, sectionSight);
    await settledFrames();
    stop();
  }
  assert.deepEqual(offerIds(createPlaylistSuggestionsVisit(1)), []);
  assert.equal(offerIds(createPlaylistSuggestionsVisit(2)).length, 5);
  assert.equal(app.stored.size, 201, "200 playlists and their order");
});

test("a Library file gone since it was saved leaves when the read finds it, its slot filling", async () => {
  reset();
  await visited();
  app.letters = "bcdefghijklm";
  const { visit, screen, wanted, sectionSight } = opened();
  const stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  assert.equal(offerIds(visit).includes("a"), false);
  assert.deepEqual(offerIds(visit).slice(1), ["b", "c", "d", "e"]);
  stop();
});

test("offline, saved streamed offers stay hidden, and back online they show again", async () => {
  reset();
  const stream = (id: string) => ({
    id: `yt:${id}`,
    source: "stream",
    videoId: id,
    title: id,
    artists: [`Artist ${id}`],
    album: null,
    albumId: null,
    durationMs: 180000,
    artworkUrl: null,
    explicit: false,
  });
  const row = (id: string) => ({
    id,
    path: `/${id}`,
    title: id,
    artist: id,
    album: "",
    durationMs: 180000,
    thumbPath: null,
    artworkPath: null,
    titleSort: id,
    artistSort: id,
    albumSort: id,
    addedAt: 0,
    albumId: 1,
    artistId: 1,
    artistIds: [1],
    discNumber: null,
    trackNumber: null,
    year: null,
    genre: null,
    hasLyrics: false,
    explicit: "unknown",
  });
  const library = (id: string) => ({ ...stream(id), id, source: "library", videoId: "" });
  app.stored.set(
    "playlistSuggestions.savedOffers.7",
    JSON.stringify([
      { track: stream("v") },
      { track: library("a"), row: row("a") },
      { track: stream("w") },
    ]),
  );
  app.online = false;
  const { visit, screen, wanted, sectionSight } = opened();
  assert.deepEqual(offerIds(visit), ["a"]);
  const stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  assert.deepEqual(offerIds(visit), ["a"]);
  stop();
  app.online = true;
  assert.deepEqual(offerIds(opened().visit), ["yt:v", "a", "yt:w"]);
});
