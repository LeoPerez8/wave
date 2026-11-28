import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import type { PlaybackState } from "./playbackStores.ts";
import { loadWithStubs, nativeStubs, stubModule } from "../perf/renderHarness.ts";

// What a song change renders in the mini player (#1533): only the playing song's part (its
// cover, title, artist and play button); the pill's glass, its gestures and its frame stay.

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const react = JSON.stringify(import.meta.resolve("react"));
const core = JSON.stringify(import.meta.resolve("@wave/core"));

/** What the stubs count and hold, by name; and the playback store the mini player reads. */
interface Scope {
  renders: Record<string, number>;
  /** What the cover, the button and the lines last showed. */
  shown: Record<string, unknown>;
  playback: { state: PlaybackState; listeners: Set<() => void> };
}
const SCOPE_KEY = "__waveMiniPlayerRenders";
const idle: PlaybackState = {
  status: "idle",
  isPlaying: false,
  playWhenReady: false,
  waitingForConnection: false,
  waitRanOut: false,
  item: null,
  error: null,
  errorCode: null,
  loadingSince: null,
};
const scope = (): Scope => {
  const global = globalThis as unknown as Record<string, Scope | undefined>;
  return (global[SCOPE_KEY] ??= {
    renders: {},
    shown: {},
    playback: { state: idle, listeners: new Set() },
  });
};
scope();
const shared = `globalThis.${SCOPE_KEY}`;
const count = (name: string) =>
  `(${shared}.renders[${name}] = (${shared}.renders[${name}] ?? 0) + 1)`;

const [{ MiniPlayer }] = await loadWithStubs<[typeof import("./MiniPlayer.tsx")]>(
  [import.meta.resolve("./MiniPlayer.tsx")],
  {
    ...nativeStubs(),
    "react-native-gesture-handler": stubModule(`
      export const GestureDetector = ({ children }) => children;
      export const usePanGesture = () => { ${count(`"usePanGesture"`)}; return {}; };
    `),
    "react-native-worklets": stubModule(
      `export const scheduleOnRN = (work, ...args) => work(...args);`,
    ),
    "@tabler/icons-react-native": stubModule(`
      export const IconPlayerPauseFilled = "pause", IconPlayerPlayFilled = "play";
      export const IconPlayerTrackNextFilled = "next";
    `),
    "@/lib/renderCost": stubModule(`
      export const useRenderCost = () => {};
      export const useOwnRenderCost = () => null;
    `),
    "@/perf/perf": stubModule(`export const useRenderCount = (name) => { ${count("name")}; };`),
    "@/localisation/localisation": stubModule(`
      import { catalogueOf } from ${core};
      const localisation = { language: "en", strings: catalogueOf("en") };
      export const useLocalisation = () => localisation;
    `),
    "@/catalog/Artwork": stubModule(`
      export const Artwork = ({ uri }) => { ${count(`"Artwork"`)}; ${shared}.shown.artwork = uri; return null; };
    `),
    "@/catalog/grid": stubModule(`export const CELL = 8; export const grid = { margin: 16 };`),
    "@/chrome/chrome": stubModule(`
      export const chrome = { miniPlayer: 64 };
      export const useTabBarTop = () => 80;
    `),
    "@/chrome/onFloatingChrome": stubModule(
      `export const OnFloatingChrome = ({ children }) => children;`,
    ),
    "@/components/IconButton": stubModule(`
      export const IconButton = ({ icon, label }) => {
        ${count("`IconButton(${icon})`")};
        ${shared}.shown[icon] = label;
        return null;
      };
    `),
    "@/glass/Glass": stubModule(
      `export const Glass = () => { ${count(`"Glass"`)}; return null; };`,
    ),
    "@/glass/waveGlass": stubModule(`export const NativeWaveGhost = () => null;`),
    "@/theme/useThemeColor": stubModule(`export const useThemeColor = () => "#ffffff";`),
    "@/motion/bounce": stubModule(`
      const spring = { damping: 20 };
      export const useBounceSpring = () => spring;
    `),
    "@/motion/Press": stubModule(`
      import { createElement } from ${react};
      export const Press = ({ children, accessibilityLabel }) => {
        ${count(`"Press"`)};
        ${shared}.shown.label = accessibilityLabel;
        return createElement("pressable", null, children);
      };
    `),
    "@/motion/heldTouch": stubModule(`
      const owner = { held: false, revision: 0 };
      export const menuTouchOwnership = { get: () => owner, allows: () => true };
      export const observeMenuTouchOwnership = () => () => {};
    `),
    "@/nowPlaying/sheet": stubModule(`
      export const beginNowPlayingDrag = () => {}, endNowPlayingDrag = () => {};
      export const sheetHeight = { get: () => 800 }, sheetOffset = { set: () => {} };
    `),
    "./actions": stubModule(`
      export const skipToNext = async () => {}, skipToPrevious = async () => {};
      export const togglePlayPause = () => {};
    `),
    "./Player": stubModule(`
      const { playback } = ${shared};
      export const playbackState = {
        get: () => playback.state,
        subscribe: (listener) => { playback.listeners.add(listener); return () => playback.listeners.delete(listener); },
      };
    `),
    "./networkSignal": stubModule(`
      const shown = { signal: "online" };
      export const useNetworkSignal = () => shown;
    `),
    "./ActionsMenu": stubModule(`export const openPlayingActions = () => {};`),
  },
);

const song = (id: string): NonNullable<PlaybackState["item"]> => ({
  id,
  title: `Song ${id}`,
  artist: `Artist ${id}`,
  album: null,
  artworkUri: `file:///covers/${id}.jpg`,
});

const report = async (next: Partial<PlaybackState>) => {
  const { playback } = scope();
  await act(() => {
    playback.state = { ...playback.state, ...next };
    for (const listener of playback.listeners) listener();
  });
};

const onOpen = () => {};

const mount = async (): Promise<ReactTestRenderer> => {
  scope().playback.state = {
    ...idle,
    status: "ready",
    isPlaying: true,
    playWhenReady: true,
    item: song("a"),
  };
  let renderer: ReactTestRenderer | undefined;
  await act(() => {
    renderer = create(createElement(MiniPlayer, { backdropId: "tabs", onOpen }));
  });
  scope().renders = {};
  return renderer!;
};

test("a song change renders only the song's part: cover, lines and play button (#1533)", async () => {
  const renderer = await mount();
  try {
    await report({ item: song("b") });
    const { renders, shown } = scope();
    assert.equal(renders.MiniPlayer, undefined, "the pill's frame and gestures don't render");
    assert.equal(renders.usePanGesture, undefined, "its gestures aren't set up again");
    assert.equal(renders.Glass, undefined, "its glass doesn't render");
    assert.equal(renders.MiniPlayerSong, 1);
    assert.equal(renders.Artwork, 1);
    assert.equal(renders["IconButton(next)"], undefined, "Next stays as it was");
    assert.equal(shown.artwork, "file:///covers/b.jpg");
    assert.equal(shown.pause, "Pause Song b");
    assert.match(String(shown.label), /Song b/);
    assert.match(String(shown.label), /Artist b/);
  } finally {
    await act(() => renderer.unmount());
  }
});

test("play and pause render only the song's part", async () => {
  const renderer = await mount();
  try {
    await report({ playWhenReady: false, isPlaying: false });
    const { renders, shown } = scope();
    assert.equal(renders.MiniPlayer, undefined);
    assert.equal(renders.MiniPlayerSong, 1);
    assert.equal(shown.play, "Play Song a");
  } finally {
    await act(() => renderer.unmount());
  }
});

test("a report that changes nothing shown renders nothing", async () => {
  const renderer = await mount();
  try {
    // The player buffers and resumes: the same song, playing, with no notice to show.
    await report({ status: "buffering", isPlaying: false });
    await report({ status: "ready", isPlaying: true });
    assert.deepEqual(scope().renders, {});
  } finally {
    await act(() => renderer.unmount());
  }
});

test("the mini player shows nothing until something plays, and leaves when it stops", async () => {
  scope().playback.state = idle;
  let renderer: ReactTestRenderer | undefined;
  await act(() => {
    renderer = create(createElement(MiniPlayer, { backdropId: "tabs", onOpen }));
  });
  try {
    assert.equal(renderer!.toJSON(), null);
    await report({ status: "ready", item: song("a"), playWhenReady: true });
    assert.notEqual(renderer!.toJSON(), null);
    assert.equal(scope().shown.artwork, "file:///covers/a.jpg");
    await report({ status: "idle", item: null, playWhenReady: false });
    assert.equal(renderer!.toJSON(), null);
  } finally {
    await act(() => renderer?.unmount());
  }
});
