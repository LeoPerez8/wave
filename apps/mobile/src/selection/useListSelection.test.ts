import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createElement, Fragment, useLayoutEffect, useMemo } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { ytArtistPageOpening, type YtArtistSection } from "@wave/core";
import type { NativeYtSong } from "../native/waveYtMusic.ts";
import type { ActionItems } from "../playback/actionTargets.ts";
import type { ListSelection } from "./useListSelection.ts";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    // Android Back is the only native boundary needed by the selection hook.
    if (specifier === "@/overlay/back")
      return {
        url: "data:text/javascript,export const addScreenBackHandler = () => () => {};",
        shortCircuit: true,
      };
    if (specifier.startsWith("@/"))
      specifier = new URL(`../${specifier.slice(2)}.ts`, import.meta.url).href;
    if (specifier.startsWith(".") && existsSync(new URL(`${specifier}.ts`, context.parentURL)))
      specifier += ".ts";
    return nextResolve(specifier, context);
  },
});
const { useListSelection } = await import("./useListSelection.ts");
const { endSelection, selectAllInList, useSelectedTarget, useSelectionSummary } =
  await import("./selection.ts");
hooks.deregister();

const song = (videoId: string): NativeYtSong => ({
  videoId,
  title: videoId,
  artists: ["Artist"],
  album: null,
  durationMs: 180000,
  artworkUrl: null,
  albumId: null,
  explicit: false,
});
const songs = [song("first"), song("second")];
const state: YtArtistSection<NativeYtSong> = {
  status: "ready",
  failure: null,
  saved: {
    outcome: "found",
    checkedAt: 1000,
    browseId: "artist",
    page: { name: "Artist", songs, allSongs: songs, albums: [], singles: [] },
  },
};
const context = {
  enabled: true,
  now: 1000,
  settled: true,
  online: true,
  librarySong: () => null,
  libraryAlbum: () => null,
};
type Item = { readonly ytSong: NativeYtSong };
const keyOf = (item: Item) => item.ytSong.videoId;
const target = (items: readonly Item[]): ActionItems => ({ kind: "track", items });

test("selecting online artist songs settles when the page rebuilds its selection source", () => {
  let selection: ListSelection<Item>;
  let renders = 0;
  function Songs() {
    // The artist page derives its selectable items from this fresh view.
    const { view } = ytArtistPageOpening(state, context);
    const items = useMemo(() => view.songs.map(({ song: ytSong }) => ({ ytSong })), [view]);
    const current = useListSelection({ items, keyOf, target });
    useLayoutEffect(() => {
      selection = current;
      assert.ok(++renders < 20, "selection source updates must not keep rendering the list");
    });
    return null;
  }
  let selected: ActionItems | null = null;
  let summary: ReturnType<typeof useSelectionSummary> = null;
  function Chrome() {
    const current = useSelectedTarget();
    const currentSummary = useSelectionSummary();
    useLayoutEffect(() => {
      selected = current;
      summary = currentSummary;
    });
    return null;
  }
  let renderer: ReactTestRenderer | undefined;
  try {
    act(() => {
      renderer = create(createElement(Fragment, null, createElement(Songs), createElement(Chrome)));
    });
    act(() => selection.start({ ytSong: songs[0]! }));
    assert.equal(selection!.selecting, true);
    assert.equal(selection!.isChecked({ ytSong: songs[0]! }), true);
    assert.deepEqual(selected, { kind: "track", items: [{ ytSong: songs[0] }] });
    assert.deepEqual(summary, { count: 1, all: false });

    act(() => selectAllInList());
    assert.equal(selection!.isChecked({ ytSong: songs[1]! }), true);
    assert.deepEqual(summary, { count: 2, all: true });

    act(() => selection.toggle({ ytSong: songs[0]! }));
    assert.deepEqual(selected, { kind: "track", items: [{ ytSong: songs[1] }] });
    act(() => selection.toggle({ ytSong: songs[1]! }));
    assert.equal(selection!.selecting, false);
    assert.equal(selected, null);
  } finally {
    act(() => renderer?.unmount());
    act(() => endSelection());
  }
});

test("refreshing the source keeps checks and updates the bar's songs and order", () => {
  let selection: ListSelection<Item>;
  let renders = 0;
  function Songs({ items }: { items: readonly Item[] }) {
    const current = useListSelection({
      items,
      keyOf: (item) => item.ytSong.videoId,
      target: (checked) => ({ kind: "track", items: checked }),
    });
    useLayoutEffect(() => {
      selection = current;
      assert.ok(++renders < 20, "new source callbacks must not keep rendering the list");
    });
    return null;
  }
  let selected: ActionItems | null = null;
  function Chrome() {
    const current = useSelectedTarget();
    useLayoutEffect(() => {
      selected = current;
    });
    return null;
  }
  const page = (items: readonly Item[]) =>
    createElement(Fragment, null, createElement(Songs, { items }), createElement(Chrome));
  let renderer: ReactTestRenderer | undefined;
  try {
    act(() => {
      renderer = create(page(songs.map((ytSong) => ({ ytSong }))));
    });
    act(() => selection.start({ ytSong: songs[0]! }));
    act(() => selection.toggle({ ytSong: songs[1]! }));
    const checked = selection!.selection;
    const updated = { ...songs[0]!, title: "Updated title" };
    const reordered = [{ ytSong: songs[1]! }, { ytSong: updated }];
    act(() => renderer!.update(page(reordered)));
    assert.equal(selection!.selection, checked);
    assert.equal(selection!.isChecked({ ytSong: updated }), true);
    assert.deepEqual(selected, { kind: "track", items: reordered });

    act(() => renderer!.update(createElement(Fragment, null, null, createElement(Chrome))));
    assert.equal(selected, null);
  } finally {
    act(() => renderer?.unmount());
    act(() => endSelection());
  }
});
