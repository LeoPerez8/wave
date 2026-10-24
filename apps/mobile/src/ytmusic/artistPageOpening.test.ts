import assert from "node:assert/strict";
import test from "node:test";
import { createElement, useLayoutEffect } from "react";
import { act, create, type ReactTestRenderer } from "react-test-renderer";
import { artistPageOpening, useArtistPageOpening } from "./artistPageOpening.ts";

test("an offline artist destination has first-frame content and starts no request, even with no Library finder", () => {
  const page = artistPageOpening({ online: false, enabled: true });
  assert.equal(page.request, false);
  assert.equal(page.view?.note, "offline");
  assert.deepEqual(page.view?.songs, []);
  assert.equal(artistPageOpening({ online: true, enabled: true }).view, null);
});

test("selection renders keep the artist page's data and do not repeat matching", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const state = {
    status: "ready" as const,
    failure: null,
    saved: {
      outcome: "found" as const,
      checkedAt: 1000,
      browseId: "artist",
      page: {
        name: "Artist",
        songs: [],
        allSongs: [
          {
            videoId: "song",
            title: "Song",
            artists: ["Artist"],
            album: null,
            durationMs: 180000,
            artworkUrl: null,
            explicit: false,
          },
        ],
        albums: [],
        singles: [],
      },
    },
  };
  let matches = 0;
  const librarySong = () => {
    matches++;
    return null;
  };
  const libraryAlbum = () => null;
  let shown: ReturnType<typeof useArtistPageOpening>;
  function Page({ checked }: { checked: boolean }) {
    const current = useArtistPageOpening(state, {
      enabled: true,
      now: 1000,
      settled: true,
      online: true,
      retry: false,
      librarySong,
      libraryAlbum,
    });
    useLayoutEffect(() => {
      shown = current;
    });
    return createElement("row", { checked });
  }
  let renderer: ReactTestRenderer | undefined;
  try {
    act(() => {
      renderer = create(createElement(Page, { checked: false }));
    });
    const first = shown!;
    const before = matches;
    act(() => renderer!.update(createElement(Page, { checked: true })));
    assert.equal(shown!, first);
    assert.equal(shown!.view.songs, first.view.songs);
    assert.equal(shown!.view.shelves, first.view.shelves);
    assert.equal(matches, before);
  } finally {
    act(() => renderer?.unmount());
  }
});
