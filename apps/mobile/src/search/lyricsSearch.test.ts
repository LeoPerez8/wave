import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createElement, useLayoutEffect } from "react";
import { act, create } from "react-test-renderer";

import type { SongRow } from "@/library/LibraryStore";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const boundary = `data:text/javascript,${encodeURIComponent(`
  import * as Effect from ${JSON.stringify(import.meta.resolve("effect/Effect"))};
  let version = 0;
  const listeners = new Set();
  export const lyricsSearchIndexVersion = {
    get: () => version,
    subscribe: (f) => { listeners.add(f); return () => listeners.delete(f); },
  };
  export const bumpVersion = () => { version++; for (const f of listeners) f(); };
  export let answer = () => Promise.resolve([]);
  export const answerWith = (next) => { answer = next; };
  export const LibraryStore = Effect.succeed({
    searchLyrics: () => Effect.promise(() => answer()),
    searchSavedLyrics: () => Effect.succeed([]),
    streamedSongsByIds: () => Effect.succeed(new Map()),
    songsWithVideos: () => Effect.succeed(new Set()),
  });
  export const appRuntime = { runPromise: Effect.runPromise };
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier.startsWith("@/")) return { url: boundary, shortCircuit: true };
    return next(specifier, context);
  },
});
const { useLocalLyricsSearch } = await import("./lyricsSearch.ts");
const io = await import(boundary);
hooks.deregister();

const song = { id: 1, title: "Song", artist: "Artist" } as unknown as SongRow;
const SONGS = [song];
const NO_SKIPS = new Set<number>();

test("a query's Lyrics results stay shown while the filling index is read again", async () => {
  let hits: ReturnType<typeof useLocalLyricsSearch> = [];
  function Lyrics() {
    const value = useLocalLyricsSearch("love you", SONGS, NO_SKIPS);
    useLayoutEffect(() => {
      hits = value;
    });
    return null;
  }
  io.answerWith(() => Promise.resolve([{ trackId: 1, lyrics: "I love you" }]));
  let renderer: ReturnType<typeof create> | undefined;
  try {
    await act(async () => {
      renderer = create(createElement(Lyrics));
    });
    assert.deepEqual(
      hits.map((hit) => hit.line),
      ["I love you"],
    );

    let finish: (candidates: unknown[]) => void = () => {};
    io.answerWith(() => new Promise((resolve) => (finish = resolve)));
    await act(async () => {
      io.bumpVersion();
    });
    assert.deepEqual(
      hits.map((hit) => hit.line),
      ["I love you"],
      "the index changing keeps the last answer until the new one arrives",
    );

    await act(async () => {
      finish([{ trackId: 1, lyrics: "I love you more" }]);
    });
    assert.deepEqual(
      hits.map((hit) => hit.line),
      ["I love you more"],
    );
  } finally {
    act(() => renderer?.unmount());
  }
});
