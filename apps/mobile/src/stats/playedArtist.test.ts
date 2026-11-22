import assert from "node:assert/strict";
import { test } from "node:test";
import { createElement } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";

import { loadWithStubs, nativeStubs, stubModule } from "../perf/renderHarness.ts";

// A played artist is drawn on Home's DJ card and Most played artists: a visit
// elsewhere and back, or a screen settling, changes nothing it draws, so it
// isn't drawn again for them (#1439). An online artist still gets its photo
// once Home is in sight and settled.

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const harness = {
  visible: true,
  settled: false,
  sightListeners: new Set<(visible: boolean) => void>(),
  settleListeners: new Set<() => void>(),
  loads: [] as string[],
};
Object.assign(globalThis, { __playedArtistTest: harness });

const show = (visible: boolean): void => {
  harness.visible = visible;
  for (const listener of harness.sightListeners) listener(visible);
};
const settle = (settled: boolean): void => {
  harness.settled = settled;
  for (const listener of harness.settleListeners) listener();
};

const react = JSON.stringify(import.meta.resolve("react"));
const t = "globalThis.__playedArtistTest";
const component = (name: string) => stubModule(`export const ${name} = "${name}";`);
const [{ usePlayedArtist }] = await loadWithStubs<[typeof import("./PlayedEntityViews.tsx")]>(
  [import.meta.resolve("./PlayedEntityViews.tsx")],
  {
    ...nativeStubs(),
    "@/lib/screenSight": stubModule(
      `const sight = {
         visible: () => ${t}.visible,
         subscribe: (listener) => {
           ${t}.sightListeners.add(listener);
           return () => ${t}.sightListeners.delete(listener);
         },
       };
       export const useScreenSight = () => sight;`,
    ),
    "@/lib/timing": stubModule(
      `export const isScreenSettled = () => ${t}.settled;
       export const onScreenSettled = (listener) => {
         ${t}.settleListeners.add(listener);
         return () => ${t}.settleListeners.delete(listener);
       };`,
    ),
    // As the app has it: settled while in sight and the screen's timing settled.
    "@/lib/screenTiming": stubModule(
      `import { useCallback, useSyncExternalStore } from ${react};
       import { useScreenSight } from "@/lib/screenSight";
       import { isScreenSettled, onScreenSettled } from "@/lib/timing";
       export const useScreenSettled = () => {
         const sight = useScreenSight();
         const subscribe = useCallback((listener) => {
           const stopSettled = onScreenSettled(listener);
           const stopSight = sight.subscribe(listener);
           return () => { stopSettled(); stopSight(); };
         }, [sight]);
         return useSyncExternalStore(subscribe, () => sight.visible() && isScreenSettled());
       };`,
    ),
    "@/native/waveNative": stubModule(`export const online = () => true;`),
    "./playedEntityOpening": stubModule(
      `export const loadPlayedArtistImage = async (name) => {
         ${t}.loads.push(name);
         return "photo:" + name;
       };
       export const openPlayedRelease = async () => "opened";`,
    ),
    "@wave/client/artworkUri": stubModule(`export const artworkUri = () => undefined;`),
    "@/catalog/cards/AlbumCard": component("AlbumCard"),
    "@/catalog/cards/ArtistCard": component("ArtistCard"),
    "@/catalog/NameRow": component("NameRow"),
    "@/search/ArtworkRow": component("ArtworkRow"),
    "@/library/routes": stubModule(`export const openAlbum = () => {}, openArtist = () => {};`),
    "@/library/runtime": stubModule(`export const appRuntime = { runPromise: async () => [] };`),
    "@/localisation/localisation": stubModule(`export const currentLocalisation = () => ({});`),
    "@/overlay/alert": stubModule(`export const showMessage = async () => {};`),
    "@/playback/ActionsMenu": stubModule(
      `export const openAlbumActions = () => {}, openArtistActions = () => {};`,
    ),
    "@/settings/ytMusic": stubModule(
      `export const useYtMusicEnabled = () => true, ytMusicEnabled = () => true;`,
    ),
    "@/ytmusic/routes": stubModule(
      `export const openYtAlbum = () => {}, openYtArtistNamed = () => {};`,
    ),
    "@/ytmusic/YtMusic": stubModule(`export const YtMusic = {};`),
  },
);

type Artist = Parameters<typeof usePlayedArtist>[0];

/** Draws [artist] as a played artist; counts its renders and keeps what it last drew. */
const draw = async (artist: Artist) => {
  let renders = 0;
  let image: ReturnType<typeof usePlayedArtist>["image"] | undefined;
  const drew = (drawn: typeof image) => {
    image = drawn;
  };
  function Face() {
    renders++;
    drew(usePlayedArtist(artist).image);
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  await act(() => {
    renderer = create(createElement(Face));
  });
  return {
    renders: () => renders,
    image: () => image,
    close: () => act(() => renderer!.unmount()),
  };
};

/** Lets a started photo lookup answer and its result render. */
const answered = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)));

/** Hides Home and shows it again, as a Settings push and pop or a tab switch does. */
const visit = async () => {
  await act(() => show(false));
  await act(() => show(true));
};

test("a Library artist isn't drawn again on a visit elsewhere or as Home settles", async () => {
  const library = { id: 3, name: "Library Artist" } as unknown as Artist;
  const face = await draw(library);
  try {
    const drawn = face.renders();
    await act(() => settle(true));
    await visit();
    await act(() => settle(false));
    await act(() => settle(true));
    assert.equal(face.renders(), drawn);
  } finally {
    await face.close();
    settle(false);
  }
});

test("an online artist gets its photo once settled, then isn't drawn again for a visit", async () => {
  const streamed = { name: "Online Artist", online: true } as unknown as Artist;
  const face = await draw(streamed);
  try {
    await answered();
    assert.deepEqual(harness.loads, [], "no lookup before Home settles");
    await act(() => settle(true));
    await answered();
    assert.deepEqual(harness.loads, ["Online Artist"]);
    assert.equal((face.image() as { imageUrl: string | null }).imageUrl, "photo:Online Artist");
    const drawn = face.renders();
    await visit();
    await answered();
    await act(() => settle(false));
    await act(() => settle(true));
    await answered();
    assert.equal(face.renders(), drawn);
    assert.equal((face.image() as { imageUrl: string | null }).imageUrl, "photo:Online Artist");
  } finally {
    await face.close();
    settle(false);
  }
});
