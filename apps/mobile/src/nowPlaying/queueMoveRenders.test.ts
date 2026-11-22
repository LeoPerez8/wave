import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import type { QueueState } from "@wave/core";

import {
  countingReanimated,
  loadWithStubs,
  nativeStubs,
  stubModule,
} from "../perf/renderHarness.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const react = JSON.stringify(import.meta.resolve("react"));
const core = JSON.stringify(import.meta.resolve("@wave/core"));
const reanimated = JSON.stringify(countingReanimated);

/** What the stubs count and hold: each song row's renders by row key, and the queue shown. */
interface Scope {
  rows: string[];
  queue: { state: QueueState | null; listeners: Set<() => void> };
}
const SCOPE_KEY = "__waveQueueMoveRenders";
const scope = (): Scope => {
  const global = globalThis as unknown as Record<string, Scope | undefined>;
  return (global[SCOPE_KEY] ??= { rows: [], queue: { state: null, listeners: new Set() } });
};
const shared = `(globalThis.${SCOPE_KEY} ??= { rows: [], queue: { state: null, listeners: new Set() } })`;

const nothing = (names: string) =>
  names
    .split(" ")
    .map((name) => `export const ${name} = () => null;`)
    .join("\n");

const [{ UpNextList }] = await loadWithStubs<[typeof import("./QueueView.tsx")]>(
  [import.meta.resolve("./QueueView.tsx")],
  {
    ...nativeStubs(),
    "react-native": stubModule(`
      export const Text = "text", View = "view", Pressable = "pressable";
      export const StyleSheet = { hairlineWidth: 1, absoluteFill: {}, create: styles => styles };
      const window = { width: 400, height: 800 };
      export const useWindowDimensions = () => window;
    `),
    "react-native-reanimated": stubModule(`
      export * from ${reanimated};
      import Animated from ${reanimated};
      export default Animated;
      export const useAnimatedReaction = () => {};
      export const useFrameCallback = () => ({ setActive() {} });
      export const scrollTo = () => {};
      import { useRef } from ${react};
      export const useAnimatedRef = () => useRef(null);
      export { useSharedValue as useScrollOffset } from ${reanimated};
    `),
    "react-native-worklets": stubModule(`
      export const scheduleOnUI = (work, ...args) => work(...args);
      export const scheduleOnRN = (work, ...args) => work(...args);
    `),
    "react-native-gesture-handler": stubModule(`
      export const GestureDetector = ({ children }) => children;
      export const usePanGesture = () => ({});
    `),
    "@tabler/icons-react-native": stubModule(`
      export const IconArrowDown = "i", IconArrowUp = "i", IconMenu2 = "i", IconRepeat = "i";
      export const IconRepeatOnce = "i", IconX = "i";
    `),
    "@legendapp/list/reanimated": stubModule(`
      import { createElement, Fragment } from ${react};
      // Every row drawn, as Legend List draws the ones on screen: each item through renderItem.
      export const AnimatedLegendList = ({ data, keyExtractor, renderItem, ListFooterComponent }) =>
        createElement("view", null,
          data.map(item => createElement(Fragment, { key: keyExtractor(item) }, renderItem({ item }))),
          ListFooterComponent);
    `),
    "@/songs/SongRow": stubModule(`
      import { createElement } from ${react};
      const scope = ${shared};
      export const SongRow = ({ rowKey, accessory }) => {
        scope.rows.push(rowKey);
        return createElement("view", null, accessory);
      };
    `),
    "@/playback/hooks": stubModule(`
      import { useSyncExternalStore } from ${react};
      import { upNext } from ${core};
      const { queue } = ${shared};
      const subscribe = listener => { queue.listeners.add(listener); return () => queue.listeners.delete(listener); };
      export const useQueue = () => useSyncExternalStore(subscribe, () => queue.state);
      export const useUpNextCount = () => useSyncExternalStore(subscribe, () => upNext(queue.state).length);
      export const useQueueContext = () => null;
      export const useQueueRepeat = () => "off";
      export const useQueueShuffle = () => false;
      export const useUpNextReshuffles = () => 0;
    `),
    "@/playback/Queue": stubModule(`
      const { queue } = ${shared};
      export const queueState = { get: () => queue.state };
    `),
    "@/localisation/localisation": stubModule(`
      import { catalogueOf } from ${core};
      const localisation = { language: "en", strings: catalogueOf("en") };
      export const useLocalisation = () => localisation;
    `),
    "@/playback/MagicQueue": stubModule(`
      export const retryMagicBatch = () => {};
      export const useMagicBatchEmptySeed = () => null;
      export const useMagicBatchFailed = () => false;
      export const useMagicBatchLoading = () => false;
      export const useMagicQueueFootnote = () => false;
      export const useMagicQueueLabel = () => null;
    `),
    "@/playback/actions": stubModule(`
      export const cycleRepeat = () => {}, toggleShuffle = () => {}, playQueueEntry = () => {};
      export const removeQueueEntry = () => {}, moveQueueEntry = async () => {};
    `),
    "@/playback/ActionsMenu": stubModule(`export const openQueuedSongActions = () => {};`),
    "@/library/hooks": stubModule(`const none = []; export const useMissingSongs = () => none;`),
    "./hooks": stubModule(`const none = new Map(); export const useQueueTracks = () => none;`),
    "@/lib/renderCost": stubModule(`export const useRenderCost = () => {};`),
    "@/perf/perf": stubModule(`
      export const useRenderCount = () => {}, usePerfVisible = () => {}, perfCount = () => {};
    `),
    "@/theme/useThemeColor": stubModule(`export const useThemeColor = () => "#888888";`),
    "@/catalog/CatalogLine": stubModule(
      `${nothing("CatalogLine SectionHead")} export const SECTION_HEAD = 56;`,
    ),
    "@/catalog/Hairline": stubModule(nothing("Hairline")),
    "@/catalog/Skeletons": stubModule(nothing("TrackSkeletons")),
    "@/components/RecommendationsFailed": stubModule(nothing("RecommendationsFailed")),
    "@/components/IconButton": stubModule(nothing("IconButton")),
    "@/components/FloatingPill": stubModule(
      `${nothing("FloatingPillLook")} export const FLOATING_PILL_ROOM = 64;`,
    ),
    "./Background": stubModule(nothing("Background")),
    "./ShuffleMenu": stubModule(nothing("useShuffleControl")),
    "./TrackHeader": stubModule(nothing("TrackHeader")),
  },
);

/** A queue of ten songs, "k0" to "k9", playing the one at [index]. */
const queueAt = (index: number, keys = [...Array(10).keys()].map((n) => `k${n}`)): QueueState => ({
  context: { kind: "album", id: "1" },
  entries: keys.map((key, contextIndex) => ({ key, trackId: `t${key.slice(1)}`, contextIndex })),
  index,
  shuffle: false,
  repeat: "off",
  nextKey: 10,
});

const show = (state: QueueState) => {
  scope().queue.state = state;
  for (const listener of scope().queue.listeners) listener();
};

const rowsFor = async (change: () => void): Promise<string[]> => {
  scope().rows = [];
  await act(change);
  return [...scope().rows].sort();
};

test("a position change re-renders only the Queue rows whose state changed (#1441)", async () => {
  show(queueAt(0));
  let renderer: ReactTestRenderer | undefined;
  await act(() => {
    renderer = create(
      createElement(UpNextList, { bottomInset: 0, ground: {} as never, paneTop: 0 }),
    );
  });
  try {
    assert.equal(scope().rows.length, 9, "Up Next's nine rows drew");

    // The next song plays: every Up Next row moves up a place.
    const next = await rowsFor(() => show(queueAt(1)));
    console.log(`[1441] next song, 9 Up Next rows: rows ${JSON.stringify(next)}`);
    assert.deepEqual(
      next,
      ["k0", "k2"],
      "the song that played goes to History, the new first row loses Move Up, the rest keep their render",
    );

    // A song in the middle of Up Next is removed: the rows after it move up a place.
    const removed = await rowsFor(() =>
      show(queueAt(1, ["k0", "k1", "k2", "k3", "k5", "k6", "k7", "k8", "k9"])),
    );
    console.log(`[1441] k4 removed: rows ${JSON.stringify(removed)}`);
    assert.deepEqual(removed, [], "no row shows anything new");

    // The last song moves to the top of Up Next: it gains Move Up and loses Move Down,
    // the old first row gains Move Up, and the new last row loses Move Down.
    const moved = await rowsFor(() =>
      show(queueAt(1, ["k0", "k1", "k9", "k2", "k3", "k5", "k6", "k7", "k8"])),
    );
    console.log(`[1441] k9 moved to the top: rows ${JSON.stringify(moved)}`);
    assert.deepEqual(moved, ["k2", "k8", "k9"]);

    // k5 last rendered fourth in Up Next and is fourth again (index 3) after two moves it
    // didn't render for: the drag knows it there. Lifted from index 3, its row sits under the
    // finger (no shift) only if the drag placed it at 3.
    const row = renderer!.root.find(
      (node) => (node.props as { shown?: { rowKey?: string } }).shown?.rowKey === "k5",
    );
    const { drag } = row.props as {
      drag: { begin: (key: string, index: number, base: number) => void };
    };
    await act(() => drag.begin("k5", 3, 0));
    const rowView = row.findByType("view" as never);
    const [, style] = rowView.props.style as [unknown, { transform: { translateY: number }[] }];
    assert.equal(style.transform[0]!.translateY, 0, "the row's place followed the queue");
  } finally {
    await act(() => renderer?.unmount());
  }
});
