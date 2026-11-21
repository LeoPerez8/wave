import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { storedHomeSnapshot } from "@wave/core";

import { createFingerDown } from "../lib/fingerDown.ts";
import { reactCompilerBuilds, stubModule } from "../perf/reactCompilerBuilds.ts";
import type { HomeSnapshotSections } from "./homeSnapshot.ts";

// Home's cold-start snapshot as written and as the React Compiler builds it: a section
// drawing the snapshot holds it while a finger is down, and Stats are kept as totals (#1346).

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const seed = (videoId: string) => ({ source: "stream", song: { videoId } });
const kept = [seed("kept")];
const totals = {
  library: { songs: 1200, albums: 90, artists: 40 },
  listening: { minutesListened: 75, songsListened: 300, plays: 2500, lastPlayedAt: 5 },
};

const harness = {
  finger: createFingerDown({ takeoverMs: 3000, schedule: () => () => {} }),
  stored: null as string | null,
  saved: [] as string[],
  appStateListeners: [] as ((state: string) => void)[],
};
Object.assign(globalThis, { __homeSnapshotTest: harness });

type Snapshot = typeof import("./homeSnapshot.ts");
const builds = await reactCompilerBuilds<Snapshot>(
  new URL("./homeSnapshot.ts", import.meta.url).href,
  {
    "expo-sqlite/kv-store": stubModule(
      `const test = globalThis.__homeSnapshotTest;
       export const Storage = {
         getItemSync: () => test.stored,
         setItem: async (_key, value) => { test.saved.push(value); },
         removeItem: async () => {},
       };`,
    ),
    "react-native": stubModule(
      `export const AppState = {
         addEventListener: (_type, listener) => {
           globalThis.__homeSnapshotTest.appStateListeners.push(listener);
         },
       };`,
    ),
    "@/perf/perf": stubModule(`export const registerPerfMeta = () => {};`),
    "@/lib/backgroundWork": stubModule(
      `export const fingerDown = globalThis.__homeSnapshotTest.finger;`,
    ),
  },
);

/** Draws [name] over a read whose answer `answer` sets; `shown` is what the section draws. */
const draw = <K extends keyof HomeSnapshotSections>(snapshot: Snapshot, name: K) => {
  let value: HomeSnapshotSections[K] | undefined;
  let shown: HomeSnapshotSections[K] | undefined;
  function Section({ read }: { read: HomeSnapshotSections[K] | undefined }) {
    shown = snapshot.useSnapshotted(name, read);
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  act(() => {
    renderer = create(createElement(Section, { read: value }));
  });
  return {
    shown: () => shown,
    answer: (read: HomeSnapshotSections[K]) => {
      value = read;
      act(() => renderer!.update(createElement(Section, { read: value })));
    },
    close: () => act(() => renderer!.unmount()),
  };
};

/** Starts [snapshot]'s saving and returns what sends the app to the background, which saves. */
const backgrounding = (snapshot: Snapshot) => {
  snapshot.startSavingHomeSnapshot();
  const listener = harness.appStateListeners.at(-1)!;
  return () => listener("background");
};

for (const [build, snapshot] of Object.entries(builds)) {
  const goToBackground = backgrounding(snapshot);
  harness.stored = storedHomeSnapshot<HomeSnapshotSections>({
    savedAt: 5,
    page: null,
    sections: { orbit: kept as never, stats: totals },
  });

  test(`${build}: a section drawing its snapshot keeps it while a finger is down`, () => {
    const orbit = draw(snapshot, "orbit");
    try {
      assert.deepEqual(orbit.shown(), kept);
      act(() => harness.finger.started());
      const read = [seed("read")] as never;
      orbit.answer(read);
      assert.deepEqual(orbit.shown(), kept, "the rows under the finger stay");
      act(() => harness.finger.ended());
      assert.deepEqual(orbit.shown(), read, "the read shows once the finger lifts");
      goToBackground();
      assert.deepEqual(JSON.parse(harness.saved.at(-1)!).sections.orbit, read);
    } finally {
      orbit.close();
      act(() => harness.finger.ended());
    }
  });

  test(`${build}: a section with no snapshot to draw shows its read under a finger`, () => {
    const playlists = draw(snapshot, "fromYourLibrary");
    try {
      act(() => harness.finger.started());
      const read = [{ id: 1, name: "Mix", trackCount: 3, thumbPaths: [] }] as never;
      playlists.answer(read);
      assert.deepEqual(playlists.shown(), read);
    } finally {
      playlists.close();
      act(() => harness.finger.ended());
    }
  });

  test(`${build}: Stats are kept as totals, for the language of the next start`, () => {
    assert.deepEqual(snapshot.snapshotSection("stats"), totals);
    const stats = draw(snapshot, "stats");
    try {
      const read = { ...totals, listening: { ...totals.listening, plays: 2501 } };
      stats.answer(read);
      goToBackground();
      assert.deepEqual(JSON.parse(harness.saved.at(-1)!).sections.stats, read);
    } finally {
      stats.close();
    }
  });
}
