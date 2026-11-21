import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import type {
  BlendedDiscoverMix,
  DiscoverMixesSection,
  MagicQueueSeed,
  YtAlbumSong,
} from "@wave/core";

import { reactCompilerBuilds, stubModule } from "../perf/reactCompilerBuilds.ts";

// Home's Magic Queue row as written and as the React Compiler builds it: both
// keep the songs they show while Home is left and come back to (#1251).

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

interface Focused {
  readonly callback: () => void | (() => void);
  leave: void | (() => void);
}

const song = (videoId: string): YtAlbumSong => ({
  videoId,
  title: `Song ${videoId}`,
  artists: ["a"],
  album: null,
  albumId: null,
  durationMs: 200_000,
  artworkUrl: null,
  explicit: false,
});

const harness = {
  /** The screen's focus effects, as the navigator holds them. */
  focused: new Set<Focused>(),
  /** The key of every pool read the row asked for, in order, each once. */
  loads: [] as string[],
  /** Whether the pool has songs: without them the row shows the mixes' songs. */
  pool: true,
  answers: new Map<string, readonly (readonly MagicQueueSeed<never>[])[]>(),
  toasts: 0,
};
Object.assign(globalThis, { __magicQueueSectionTest: harness });

/** Another screen covers Home (Settings pushed over it, another tab), then Home is back. */
const leaveAndReturn = () =>
  act(() => {
    for (const entry of harness.focused) {
      if (typeof entry.leave === "function") entry.leave();
      entry.leave = entry.callback();
    }
  });

const react = JSON.stringify(import.meta.resolve("react"));
const effect = JSON.stringify(import.meta.resolve("effect/Effect"));
const unused = (...names: string[]) =>
  stubModule(
    names.map((name) => `export const ${name} = () => { throw new Error("unused"); };`).join("\n"),
  );
type Section = typeof import("./magicQueueSection.ts");
const builds = await reactCompilerBuilds<Section>(
  new URL("./magicQueueSection.ts", import.meta.url).href,
  {
    "expo-router": stubModule(
      `import { useEffect } from ${react};
       const { focused } = globalThis.__magicQueueSectionTest;
       export const useFocusEffect = (callback) => useEffect(() => {
         const entry = { callback, leave: callback() };
         focused.add(entry);
         return () => {
           focused.delete(entry);
           if (typeof entry.leave === "function") entry.leave();
         };
       }, [callback]);`,
    ),
    "@/library/sharedQueries": stubModule(
      `const test = globalThis.__magicQueueSectionTest;
       export const libraryQuery = (key, reads, read) => ({ key, reads, read });
       export const useLibraryQuery = (query, initial) => {
         if (query === null) return initial;
         if (!test.answers.has(query.key)) {
           test.loads.push(query.key);
           test.answers.set(
             query.key,
             test.pool ? [[{ source: "stream", song: { videoId: query.key } }]] : [],
           );
         }
         return test.answers.get(query.key);
       };`,
    ),
    "@/localisation/localisation": stubModule(
      `export const currentLocalisation = () => ({
         strings: { discover: { newSongs: "", undo: "" } },
       });`,
    ),
    "@/overlay/toast": stubModule(
      `export const showToast = async () => { globalThis.__magicQueueSectionTest.toasts++; };`,
    ),
    "@/lib/backgroundWork": stubModule(`export const freeTurnEffect = undefined;`),
    "@/lib/recommendationWork": stubModule(`export const recommendationTurnEffect = undefined;`),
    "./magicQueuePopularity": stubModule(
      `import * as Effect from ${effect};
       export const magicQueuePopularity = () => Effect.die("unused");`,
    ),
    "@/lib/discoverSettings": stubModule(
      `export const discoverLevel = { get: () => 3 };
       export const discoverSliders = { get: () => ({ faithfulness: 3, popularity: 3 }) };`,
    ),
    "./recommendationSnapshot": stubModule(
      `import * as Effect from ${effect};
       export const recommendationSnapshot = { library: Effect.die("unused"), catalog: Effect.die("unused") };`,
    ),
    "@/library/libraryChanges": stubModule(`export const onLibraryChange = () => {};`),
    // No song is disliked here; the set is the store's, which isn't run.
    "@/library/dislikes": stubModule(
      `const none = new Set();
       export const currentDislikedSongs = async () => none;
       export const useDislikedSongs = () => none;`,
    ),
    "@/library/LibraryStore": stubModule(
      `import * as Effect from ${effect};
       export const LibraryStore = Effect.die("unused");`,
    ),
    "@/library/runtime": stubModule(`export const appRuntime = {};`),
    "@wave/client": stubModule(``),
    "@/playback/MagicQueue": unused("startMagicQueue"),
    "@/playback/magicQueueStart": unused("runMagicQueueStart", "startMagicQueueFromStream"),
    "./streamedMagicQueueStart": unused("startFromLibraryMatch"),
    "./playlistSeedIds": stubModule(
      `import * as Effect from ${effect};
       export const readPlaylistSeedIds = () => Effect.succeed([]);
       export const createPlaylistSeedIdsRead = () => ({
         change: () => {},
         get: Effect.succeed([]),
       });`,
    ),
  },
);

const chartMix: BlendedDiscoverMix = {
  id: "artist:a",
  seed: { kind: "artist", name: "a", from: "chart" },
  songs: Array.from({ length: 40 }, (_, place) => ({
    source: "stream" as const,
    song: song(`a${place + 1}`),
  })),
};
const MIXES: DiscoverMixesSection = {
  kind: "mixes",
  mixes: [chartMix],
  updating: false,
  failed: false,
};
const NO_MIXES: DiscoverMixesSection = { kind: "hidden", failed: false };

/** Renders the row over [artistMixes] and hands back what it shows now. */
const open = (hooks: Section, artistMixes: DiscoverMixesSection) => {
  let section: ReturnType<Section["useMagicQueueSection"]> | undefined;
  function Row() {
    section = hooks.useMagicQueueSection(true, artistMixes);
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(createElement(Row));
  });
  return {
    section: () => section!,
    close: () => act(() => renderer?.unmount()),
  };
};

for (const [build, hooks] of Object.entries(builds)) {
  test(`${build}: coming back to Home keeps the pool's songs and starts no new read`, () => {
    harness.pool = true;
    harness.loads.length = 0;
    const row = open(hooks, NO_MIXES);
    try {
      const before = row.section().shown;
      assert.equal(before.kind, "pages");
      assert.equal(harness.loads.length, 1);

      leaveAndReturn();
      leaveAndReturn();

      assert.equal(harness.loads.length, 1, "no new read");
      const after = row.section().shown;
      assert.equal(after.kind, "pages");
      assert.equal(
        after.kind === "pages" && after.pages,
        before.kind === "pages" && before.pages,
        "the same songs",
      );
    } finally {
      row.close();
    }
  });

  test(`${build}: coming back to Home keeps the songs picked from the mixes`, () => {
    harness.pool = false;
    harness.loads.length = 0;
    const row = open(hooks, MIXES);
    try {
      const before = row.section().shown;
      assert.equal(before.kind, "mixes");
      assert.equal(harness.loads.length, 1);

      leaveAndReturn();
      leaveAndReturn();

      assert.equal(harness.loads.length, 1, "no new read");
      const after = row.section().shown;
      assert.equal(
        after.kind === "mixes" && after.songs,
        before.kind === "mixes" && before.songs,
        "the same songs",
      );
    } finally {
      row.close();
    }
  });

  test(`${build}: the owner's refresh still draws other songs`, () => {
    harness.pool = true;
    harness.loads.length = 0;
    harness.toasts = 0;
    const row = open(hooks, NO_MIXES);
    try {
      const before = row.section().shown;
      act(() => row.section().refresh(0));
      assert.equal(harness.loads.length, 2, "a new read");
      assert.notDeepEqual(row.section().shown, before);
      assert.equal(harness.toasts, 1);
    } finally {
      row.close();
    }
  });
}
