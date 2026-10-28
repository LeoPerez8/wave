import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import type { ExternalStore } from "../lib/externalStore.ts";
import { reactCompilerBuilds, stubModule } from "../perf/reactCompilerBuilds.ts";

// The Stats hooks as written and as the React Compiler builds them: both read
// Stats again on the same changes.

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

/** Every Stats read the hooks start, as `method args`. */
const reads: string[] = [];
const stats = {
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
};
Object.assign(globalThis, { __statsHooksTest: { stats } });

const react = JSON.stringify(import.meta.resolve("react"));
const externalStore = JSON.stringify(new URL("../lib/externalStore.ts", import.meta.url).href);
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
  "./openedRecaps": stubModule(`export const getOpenedRecaps = () => [];`),
  "./recapAvailabilityLive": stubModule(
    `export const knownRecaps = () => [];
       export const useRecapAvailability = () => undefined;`,
  ),
});
const { playHistoryVersion } = (await import(playHistory)) as {
  playHistoryVersion: ExternalStore<number>;
};

function Block({ hooks, artistId, songs }: { hooks: Hooks; artistId: number; songs: unknown[] }) {
  hooks.useArtistStats(artistId, songs);
  return null;
}

function Ranking({ hooks, tick }: { hooks: Hooks; tick: number }) {
  const top = hooks.useTopSongs("month", 10);
  return top === undefined ? null : createElement("ranking", { tick });
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

  test(`${build}: a ranking is read again when a play starts or ends, and not on other renders`, async () => {
    reads.length = 0;
    let renderer: ReactTestRenderer | undefined;
    try {
      await act(() => {
        renderer = create(createElement(Ranking, { hooks, tick: 0 }));
      });
      await settle();
      assert.deepEqual(reads, ["topSongs month 10"]);

      await act(() => renderer!.update(createElement(Ranking, { hooks, tick: 1 })));
      await settle();
      assert.deepEqual(reads, ["topSongs month 10"]);

      await act(() => playHistoryVersion.update((version) => version + 1));
      await settle();
      assert.deepEqual(reads, ["topSongs month 10", "topSongs month 10"], "a play re-reads");
    } finally {
      await act(() => renderer?.unmount());
    }
  });
}
