import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { reactCompilerBuilds, stubModule } from "../perf/reactCompilerBuilds.ts";

// The Stats hooks as written and as the React Compiler builds them: an
// artist's block reads Stats again on the same changes, and the rankings draw
// the shared queries `readyScreens.ts` keeps from startup.

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/** Every Stats read the hooks start, as `method args`. */
const reads: string[] = [];
const stats = {
  topGenres: (period: string) =>
    Effect.sync(() => {
      reads.push(`topGenres ${period}`);
      return [];
    }),
  artist: (artistId: number) =>
    Effect.sync(() => {
      reads.push(`artist ${artistId}`);
      return { played: false };
    }),
  topSongs: (period: string, limit: number) =>
    Effect.sync(() => {
      reads.push(`topSongs ${period} ${limit}`);
      return [];
    }),
  topAlbums: (period: string, limit: number) =>
    Effect.sync(() => {
      reads.push(`topAlbums ${period} ${limit}`);
      return [];
    }),
  topArtists: (period: string, limit: number) =>
    Effect.sync(() => {
      reads.push(`topArtists ${period} ${limit}`);
      return [];
    }),
};
/** The shared queries' results, by key, and the keys the hooks drew. */
const results = new Map<string, unknown>();
const drawn: string[] = [];
let resultsVersion = 0;
const resultListeners = new Set<() => void>();
const answer = (key: string, value: unknown): void => {
  results.set(key, value);
  resultsVersion++;
  for (const listener of resultListeners) listener();
};
const statsHooksTest = {
  stats,
  language: "en",
  results,
  drawn,
  version: () => resultsVersion,
  subscribe: (listener: () => void) => {
    resultListeners.add(listener);
    return () => resultListeners.delete(listener);
  },
};
Object.assign(globalThis, { __statsHooksTest: statsHooksTest });

const react = JSON.stringify(import.meta.resolve("react"));
const externalStore = JSON.stringify(import.meta.resolve("@wave/client/externalStore"));
const playHistory = stubModule(
  `import { makeExternalStore } from ${externalStore};
   export const playHistoryVersion = makeExternalStore(0);`,
);
type Hooks = typeof import("./hooks.ts");
const builds = await reactCompilerBuilds<Hooks>(new URL("./hooks.ts", import.meta.url).href, {
  // The screen is focused for the whole test.
  "expo-router": stubModule(
    `import { useEffect } from ${react};
       export const useFocusEffect = (callback) => useEffect(() => callback(), [callback]);`,
  ),
  "react-native": stubModule(
    `export const AppState = { currentState: "active", addEventListener: () => ({ remove() {} }) };`,
  ),
  "@/library/runtime": stubModule(
    `import * as Effect from ${JSON.stringify(import.meta.resolve("effect/Effect"))};
       export const appRuntime = { runPromise: (effect) => Effect.runPromise(effect) };`,
  ),
  "./Stats": stubModule(
    `export const Stats = { use: (read) => read(globalThis.__statsHooksTest.stats) };`,
  ),
  "@/playback/PlayHistory": playHistory,
  "@/nowPlaying/sheet": stubModule(
    `export const isNowPlayingShown = () => false;
       export const onNowPlayingShownChange = () => () => {};`,
  ),
  "@/lib/screenSight": stubModule(
    `export const useScreenSight = () => { throw new Error("unused"); };`,
  ),
  "@/localisation/localisation": stubModule(
    `export const useLocalisation = () => ({ language: globalThis.__statsHooksTest.language });`,
  ),
  "@/library/sharedQueries": stubModule(
    `import { useSyncExternalStore } from ${react};
       const t = () => globalThis.__statsHooksTest;
       export const libraryQuery = (key, reads, read, traits = {}) => ({ key, reads, read, traits });
       export const useLibraryQuery = (query, initial) => {
         useSyncExternalStore(t().subscribe, t().version);
         if (query === null) return initial;
         t().drawn.push(query.key);
         return t().results.has(query.key) ? t().results.get(query.key) : initial;
       };
       export const libraryQueryResult = async (query) => t().results.get(query.key);`,
  ),
  "./openedRecaps": stubModule(`export const getOpenedRecaps = () => [];`),
  "./recapAvailabilityLive": stubModule(
    `export const knownRecaps = () => [];
       export const useRecapAvailability = () => undefined;`,
  ),
});

function Block({ hooks, artistId, songs }: { hooks: Hooks; artistId: number; songs: unknown[] }) {
  hooks.useArtistStats(artistId, songs);
  return null;
}

function Ranking({
  hooks,
  period,
  limit,
}: {
  hooks: Hooks;
  period: "month" | "week";
  limit: number;
}) {
  const top = hooks.useTopSongs(period, limit);
  return top === undefined ? null : createElement("ranking", { first: top[0] });
}

/** Lets started reads finish and their results render. */
const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

for (const [build, hooks] of Object.entries(builds)) {
  test(`${build}: an artist's stats are read again when the page's songs or the artist change`, async () => {
    reads.length = 0;
    const first = [{ id: 1 }];
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(createElement(Block, { hooks, artistId: 7, songs: first }));
      });
      await settle();
      assert.deepEqual(reads, ["artist 7"]);

      await act(() => renderer!.update(createElement(Block, { hooks, artistId: 7, songs: first })));
      await settle();
      assert.deepEqual(reads, ["artist 7"], "the same songs aren't read again");

      await act(() =>
        renderer!.update(createElement(Block, { hooks, artistId: 7, songs: [{ id: 1 }] })),
      );
      await settle();
      assert.deepEqual(reads, ["artist 7", "artist 7"], "a scan's new songs re-read the stats");

      await act(() => renderer!.update(createElement(Block, { hooks, artistId: 8, songs: first })));
      await settle();
      assert.deepEqual(reads, ["artist 7", "artist 7", "artist 8"]);
    } finally {
      await act(() => renderer?.unmount());
    }
  });

  test(`${build}: an artist's stats are read again in the app's new language`, async () => {
    reads.length = 0;
    const songs = [{ id: 1 }];
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(createElement(Block, { hooks, artistId: 7, songs }));
      });
      await settle();
      statsHooksTest.language = "pt-BR";
      await act(() => renderer!.update(createElement(Block, { hooks, artistId: 7, songs })));
      await settle();
      assert.deepEqual(reads, ["artist 7", "artist 7"]);
    } finally {
      statsHooksTest.language = "en";
      await act(() => renderer?.unmount());
    }
  });
}

function Genres({ hooks, period }: { hooks: Hooks; period: "week" | "all" }) {
  const genres = hooks.useTopGenres(period);
  return genres === undefined ? null : createElement("genres", { first: genres[0] });
}

const shownFirst = (renderer: ReactTestRenderer | undefined): unknown => {
  const json = renderer?.toJSON();
  return json === null || json === undefined || Array.isArray(json) ? undefined : json.props.first;
};

const reset = (): void => {
  results.clear();
  drawn.length = 0;
};

for (const [build, hooks] of Object.entries(builds)) {
  test(`${build}: Stats draws the queries kept at startup, re-read on plays and songs`, async () => {
    reset();
    answer("stats:topSongs:month:10", ["kept"]);
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(createElement(Ranking, { hooks, period: "month", limit: 10 }));
      });
      assert.equal(shownFirst(renderer), "kept", "the first frame draws what memory holds");
      const kept = new Map(hooks.statsOpeningQueries().map((query) => [query.key, query]));
      assert.ok(kept.has("stats:topSongs:month:10"), "the drawn query is the one kept");
      assert.deepEqual(kept.get("stats:topSongs:month:10")?.reads, { plays: true, tracks: true });
      reads.length = 0;
      await Effect.runPromise(kept.get("stats:topSongs:month:10")!.read as Effect.Effect<unknown>);
      assert.deepEqual(reads, ["topSongs month 10"]);
    } finally {
      await act(() => renderer?.unmount());
    }
  });

  test(`${build}: See all draws Stats' top until its own ranking answers`, async () => {
    reset();
    answer("stats:topSongs:month:10", ["top"]);
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(createElement(Ranking, { hooks, period: "month", limit: 100 }));
      });
      assert.equal(shownFirst(renderer), "top");
      await act(() => answer("stats:topSongs:month:100", ["all"]));
      assert.equal(shownFirst(renderer), "all");
    } finally {
      await act(() => renderer?.unmount());
    }
  });

  test(`${build}: a period just chosen keeps the last ranking until its own answers`, async () => {
    reset();
    answer("stats:topSongs:month:10", ["month"]);
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(createElement(Ranking, { hooks, period: "month", limit: 10 }));
      });
      await act(() =>
        renderer!.update(createElement(Ranking, { hooks, period: "week", limit: 10 })),
      );
      assert.equal(shownFirst(renderer), "month");
      await act(() => answer("stats:topSongs:week:10", ["week"]));
      assert.equal(shownFirst(renderer), "week");
    } finally {
      await act(() => renderer?.unmount());
    }
  });

  test(`${build}: genre stats follow the selected period, keeping the last until it answers`, async () => {
    reset();
    answer("stats:topGenres:week", ["rock"]);
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(createElement(Genres, { hooks, period: "week" }));
      });
      assert.equal(shownFirst(renderer), "rock");
      await act(() => renderer!.update(createElement(Genres, { hooks, period: "all" })));
      assert.equal(shownFirst(renderer), "rock");
      assert.ok(drawn.includes("stats:topGenres:all"));
      await act(() => answer("stats:topGenres:all", ["jazz"]));
      assert.equal(shownFirst(renderer), "jazz");
    } finally {
      await act(() => renderer?.unmount());
    }
  });
}
