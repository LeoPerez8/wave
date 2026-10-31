import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";

import { goToSuggestionsOffered } from "@wave/core";

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
  storageReads: 0,
  letters: "abcdefghijkl",
  radio: "abcdefghijkl",
  seeds: ["seed"],
  radios: new Map<string, string>(),
  radioWait: async (_seed: string): Promise<void> => {},
  playlist: ["seed"],
  retitled: new Map<string, string>(),
  /** One Library array across reads, as reads between Library changes give; else one per read. */
  sameLibrary: false,
  theLibrary: null as unknown,
  /** Whether someone waited at the start of each ranking. */
  rankings: [] as { readonly awaited: boolean }[],
};
Object.assign(globalThis, { playlistVisitApp: app });

const boundary = `data:text/javascript,${encodeURIComponent(`
  import * as Effect from ${JSON.stringify(import.meta.resolve("effect/Effect"))};
  import * as Context from ${JSON.stringify(import.meta.resolve("effect/Context"))};
  const app = globalThis.playlistVisitApp;
  const song = (id) => ({ id, source: "library", videoId: "", title: app.retitled.get(id) ?? id, artists: ["Artist " + id],
    album: null, albumId: null, durationMs: 180000, artworkUrl: null, explicit: false, genre: "Rock" });
  const row = (id) => ({ id, path: "/" + id, title: app.retitled.get(id) ?? id, artist: "Artist " + id, album: "",
    durationMs: 180000, thumbPath: null, artworkPath: null, titleSort: id, artistSort: id, albumSort: id,
    addedAt: 0, albumId: 1, artistId: 1, artistIds: [1], discNumber: null, trackNumber: null, year: null,
    genre: "Rock", hasLyrics: false, explicit: "unknown" });
  const seed = song("seed");
  const freshLibrary = () => [seed, ...app.letters.split("").map(song)];
  const libraryNow = () => {
    if (!app.sameLibrary) return freshLibrary();
    return (app.theLibrary ??= freshLibrary());
  };
  export class LibraryStore extends Context.Service()("test/LibraryStore") {}
  const store = {
    dismissPlaylistRecommendation: () => Effect.void,
    acceptPlaylistRecommendation: (_id, offer) => Effect.sync(() => {
      app.playlist = [...app.playlist, offer.track.id];
      return true;
    }),
  };
  export const Storage = {
    getItemSync: (key) => { app.storageReads++; return app.stored.get(key) ?? null; },
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
  export const recommendationSteps = (steps, awaited) =>
    Effect.sync(() => {
      app.rankings.push({ awaited: awaited() });
      for (;;) {
        const next = steps.next();
        if (next.done) return next.value;
      }
    });
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
  export const playlistSuggestionSeeds = () => app.seeds.map(song);
  export const playlistSuggestionRadios = (_visit, seeds) =>
    Effect.promise(() => Promise.all(seeds.map(async ({ id }) => {
      await app.radioWait(id);
      return { id: "song:" + id, artists: ["Artist " + id], songs: (app.radios.get(id) ?? app.radio).split("").map(song) };
    })));
`)}`;
const REAL = new Set(["@/lib/externalStore", "@/lib/sight"]);
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
  app.storageReads = 0;
  app.letters = "abcdefghijkl";
  app.radio = "abcdefghijkl";
  app.seeds = ["seed"];
  app.radios = new Map();
  app.radioWait = async () => {};
  app.playlist = ["seed"];
  app.retitled = new Map();
  app.sameLibrary = false;
  app.theLibrary = null;
  app.rankings = [];
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

test("a song the playlist holds, with no spare to take its slot, reads nothing before settling", async () => {
  reset();
  app.radio = "abcde";
  await visited();
  app.reads = 0;
  app.radio = "fghij";
  const settled = Promise.withResolvers<void>();
  app.settle = () => settled.promise;
  const { visit, screen, wanted, sectionSight } = opened();
  const held = (id: string) => ({ source: "library", track: { id } }) as never;
  // The list's first commit with its entries already read: the layout effect before follow's.
  visit.playlistRead([held("c")]);
  const stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  assert.equal(app.reads, 0);
  assert.deepEqual(visit.session.get().pendingSlots, [2]);
  settled.resolve();
  await settledFrames();
  assert.equal(app.reads, 1, "the opening's renewal fills the slot, on its one read");
  assert.deepEqual(visit.session.get().pendingSlots, []);
  assert.deepEqual(offerIds(visit), ["a", "b", "f", "d", "e"]);
  stop();
});

test("opening reads nothing saved until the section is wanted, then shows it at once", async () => {
  reset();
  await visited();
  app.reads = 0;
  app.storageReads = 0;
  const { visit, screen, wanted, sectionSight } = opened();
  wanted.set(false);
  const stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  assert.equal(app.storageReads, 0, "YT Music off, Find or selecting costs no saved read");
  wanted.set(true);
  assert.equal(app.storageReads, 1);
  assert.deepEqual(offerIds(visit), ["a", "b", "c", "d", "e"]);
  assert.equal(visit.session.get().loading, false);
  await settledFrames();
  assert.equal(app.reads, 1);
  stop();
});

test("the visit's saved read happens once, whatever asks first", async () => {
  reset();
  await visited();
  app.storageReads = 0;
  const { visit, screen, wanted, sectionSight } = opened();
  assert.equal(app.storageReads, 0, "creating the visit reads nothing");
  visit.session.get();
  visit.playlistRead([]);
  const stop = visit.follow(screen, wanted, sectionSight);
  assert.equal(app.storageReads, 1);
  stop();
});

test("with no offers to check, the playlist's entries aren't walked", () => {
  reset();
  const { visit } = opened();
  const untouchable = new Proxy([], {
    get: () => {
      throw new Error("walked the entries");
    },
  });
  visit.playlistRead(untouchable);
  assert.equal(visit.session.get().slots.length, 0);
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
  // Free slots take Library files; the streamed ones stay hidden, and saved.
  assert.deepEqual(offerIds(visit), ["a", "b", "c", "d", "e"]);
  stop();
  app.online = true;
  assert.deepEqual(offerIds(opened().visit), ["yt:v", "a", "yt:w"]);
});

test("Find opening over a first load, then clearing, keeps the skeleton and the pill until it renews", async () => {
  reset();
  const held = Promise.withResolvers<void>();
  app.read = () => held.promise;
  const { visit, screen, wanted, sectionSight } = opened();
  const stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  assert.equal(app.reads, 1);
  wanted.set(false);
  await settledFrames();
  const settling = Promise.withResolvers<void>();
  app.settle = () => settling.promise;
  app.read = async () => {};
  wanted.set(true);
  await settledFrames();
  assert.equal(visit.session.get().loading, true, "the section's skeleton stays");
  assert.equal(goToSuggestionsOffered(visit.session.get()), true, "the pill stays");
  settling.resolve();
  await settledFrames();
  assert.equal(visit.session.get().loading, false);
  assert.deepEqual(offerIds(visit), ["a", "b", "c", "d", "e"]);
  stop();
});

test("a spare taking a slot while Find is open has its Library row once Find closes", async () => {
  reset();
  await visited();
  const { visit, screen, wanted, sectionSight } = opened();
  const held = (...ids: string[]) =>
    ids.map((id) => ({ source: "library", track: { id } })) as never;
  // A first spare in sight narrows the rows to what shows, spares out.
  visit.playlistRead(held("c"));
  const stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  wanted.set(false);
  await settledFrames();
  visit.playlistRead(held("c", "d"));
  const spare = offerIds(visit)[3]!;
  assert.notEqual(spare, "d");
  wanted.set(true);
  assert.equal(visit.libraryRows.get().get(spare)?.id, spare);
  stop();
});

test("a tag change reaches a showing offer and its row, even one the renewal didn't rank", async () => {
  reset();
  await visited();
  app.letters = "abcdefghijklmnopqrstuvwx";
  app.radio = "mnopqrstuvwx";
  app.retitled.set("a", "Fixed");
  const { visit, screen, wanted, sectionSight } = opened();
  const key = visit.session.get().slots[0]?.key;
  const stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  assert.deepEqual(offerIds(visit), ["a", "b", "c", "d", "e"]);
  assert.equal(visit.session.get().slots[0]?.key, key);
  assert.equal(visit.session.get().slots[0]?.track.title, "Fixed");
  assert.equal(visit.libraryRows.get().get("a")?.title, "Fixed");
  stop();
});

test("a row changed with no change to its offer's tags still refreshes", async () => {
  reset();
  await visited();
  const { visit, screen, wanted, sectionSight } = opened();
  const saved = visit.libraryRows.get().get("a");
  const stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  assert.notEqual(visit.libraryRows.get().get("a"), saved);
  assert.equal(visit.libraryRows.get().get("a")?.id, "a");
  stop();
});

test("an Add and a Dismiss each fill from a spare, read nothing and write one timing line", async () => {
  reset();
  const { visit, screen, wanted, sectionSight } = opened();
  const stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  const lines = () => app.lines.filter((line) => line.startsWith("Playlist slot wait:"));
  assert.deepEqual(lines(), []);
  const reads = app.reads;
  const [first, second] = visit.session.get().slots;
  await visit.session.accept(first!.key);
  await visit.session.dismiss(second!.key);
  await settledFrames();
  assert.equal(app.reads, reads);
  assert.deepEqual(offerIds(visit).slice(0, 2), ["f", "g"]);
  assert.equal(visit.libraryRows.get().get("f")?.id, "f", "the spare's row is there to list it");
  assert.equal(lines().length, 2);
  assert.match(lines()[0]!, /^Playlist slot wait: Add offer after \d+ ms \(from spare\)$/);
  assert.match(lines()[1]!, /^Playlist slot wait: Dismiss offer after \d+ ms \(from spare\)$/);
  stop();
});

test("a screen that never settles lets the opening read at 600 ms", async (t) => {
  reset();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  app.settle = () => new Promise(() => {});
  const { visit, screen, wanted, sectionSight } = opened();
  const stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  t.mock.timers.tick(599);
  await settledFrames();
  assert.equal(app.reads, 0);
  t.mock.timers.tick(1);
  await settledFrames();
  assert.equal(app.reads, 1);
  assert.deepEqual(offerIds(visit), ["a", "b", "c", "d", "e"]);
  stop();
});

test("leaving within the 600 ms reads nothing, then or later", async (t) => {
  reset();
  t.mock.timers.enable({ apis: ["setTimeout"] });
  app.settle = () => new Promise(() => {});
  const { visit, screen, wanted, sectionSight } = opened();
  const stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  t.mock.timers.tick(300);
  await settledFrames();
  stop();
  t.mock.timers.tick(5000);
  await settledFrames();
  assert.equal(app.reads, 0);
});

test("a fresh suggestion shows from the first radio to answer, and a later radio's offer has its Library row", async () => {
  reset();
  app.seeds = ["one", "two", "three"];
  app.radios = new Map([
    ["one", "de"],
    ["two", "ab"],
    ["three", "fg"],
  ]);
  const slow = Promise.withResolvers<void>();
  app.radioWait = async (seed) => {
    if (seed !== "two") await slow.promise;
  };
  const { visit, screen, wanted, sectionSight } = opened();
  const stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  assert.deepEqual(offerIds(visit), ["a", "b", null, null, null]);
  assert.equal(visit.session.get().loading, false);
  assert.ok(visit.libraryRows.get().has("a"));
  assert.match(app.lines.find((line) => line.includes("Playlist suggestions:")) ?? "", /2 offers/);

  slow.resolve();
  await settledFrames();
  // The two that answered together interleave by position, as radios do.
  assert.deepEqual(offerIds(visit), ["a", "b", "d", "f", "e"]);
  assert.ok(visit.libraryRows.get().has("f"), "a later radio's offer keeps its row");
  stop();
});

test("the first radio's ranking is awaited; the later radios' isn't", async () => {
  reset();
  app.seeds = ["one", "two"];
  app.radios = new Map([
    ["one", "abcde"],
    ["two", "fghij"],
  ]);
  const slow = Promise.withResolvers<void>();
  app.radioWait = async (seed) => {
    if (seed === "two") await slow.promise;
  };
  const { visit, screen, wanted, sectionSight } = opened();
  const stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  assert.deepEqual(app.rankings, [{ awaited: true }]);
  slow.resolve();
  await settledFrames();
  assert.deepEqual(app.rankings, [{ awaited: true }, { awaited: false }]);
  stop();
});

test("a ranking on a Library read before still finds its rows, once the reads have moved on", async () => {
  reset();
  app.sameLibrary = true;
  app.seeds = ["one"];
  app.radios = new Map([["one", "ab"]]);
  const { visit, screen, wanted, sectionSight } = opened();
  const stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  assert.deepEqual(offerIds(visit), ["a", "b", null, null, null]);
  // A tap frees a slot: a second read of the same Library array ranks a new radio's offer.
  app.radios = new Map([["one", "c"]]);
  await visit.session.dismiss(visit.session.get().slots[0]!.key);
  await settledFrames();
  assert.deepEqual(offerIds(visit), ["c", "b", null, null, null]);
  assert.ok(visit.libraryRows.get().has("c"), "the new offer's row comes from the earlier read");
  stop();
});

test("a tap that finds the reserve low within the settle wait reads nothing until it ends", async () => {
  reset();
  // Saved by an older version: ten offers, so one tap leaves 4 spares.
  app.radio = "abcdefghij";
  await visited();
  app.reads = 0;
  app.radio = "abcdefghijkl";
  app.letters = "abcdefghijkl";
  const settled = Promise.withResolvers<void>();
  app.settle = () => settled.promise;
  const { visit, screen, wanted, sectionSight } = opened();
  const stop = visit.follow(screen, wanted, sectionSight);
  await visit.session.dismiss(visit.session.get().slots[0]!.key);
  await settledFrames();
  assert.equal(offerIds(visit)[0], "f");
  assert.equal(app.reads, 0);
  settled.resolve();
  await settledFrames();
  assert.ok(app.reads >= 1);
  stop();
});

test("leaving as a fresh read's radios start leaves no rejection unhandled", async () => {
  reset();
  app.seeds = ["one", "two", "three"];
  const unhandled: unknown[] = [];
  const heard = (reason: unknown) => unhandled.push(reason);
  process.on("unhandledRejection", heard);
  const { visit, screen, wanted, sectionSight } = opened();
  let stop = () => {};
  app.radioWait = async () => {
    stop();
    await new Promise(() => {});
  };
  stop = visit.follow(screen, wanted, sectionSight);
  await settledFrames();
  process.off("unhandledRejection", heard);
  assert.deepEqual(unhandled, []);
});
