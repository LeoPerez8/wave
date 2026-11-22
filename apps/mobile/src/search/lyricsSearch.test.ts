import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { createElement, useLayoutEffect } from "react";
import { act, create } from "react-test-renderer";

import type { SongRow } from "@wave/client";

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
  export const reads = [];
  export let answer = () => Promise.resolve([]);
  export const answerWith = (next) => { answer = next; };
  export const LibraryStore = Effect.succeed({
    searchLyrics: (query) => Effect.promise(() => { reads.push(query); return answer(query); }),
    searchSavedLyrics: () => Effect.succeed([]),
    streamedSongsByIds: () => Effect.succeed(new Map()),
    songsWithVideos: () => Effect.succeed(new Set()),
  });
  export const appRuntime = { runPromise: Effect.runPromise };
`)}`;
const hooks = registerHooks({
  resolve(specifier, context, next) {
    if (specifier === "@/lib/storeWhile") return next("../lib/storeWhile.ts", context);
    if (specifier.startsWith("@/")) return { url: boundary, shortCircuit: true };
    if (specifier === "./lyricsQueries") return next("./lyricsQueries.ts", context);
    return next(specifier, context);
  },
});
const { useLocalLyricsSearch } = await import("./lyricsSearch.ts");
const { LYRICS_TYPING_PAUSE_MS } = await import("./lyricsQueries.ts");
const io = await import(boundary);
hooks.deregister();

const song = { id: 1, title: "Song", artist: "Artist" } as unknown as SongRow;
const other = { id: 2, title: "Other", artist: "Artist" } as unknown as SongRow;
const SONGS = [song, other];
const NO_SKIPS = new Set<number>();

type Shown = ReturnType<typeof useLocalLyricsSearch>;
const mount = async (query: string, skipIds: ReadonlySet<number> = NO_SKIPS) => {
  let shown: Shown = { hits: [], submit: () => {} };
  let renders = 0;
  function Lyrics(props: { query: string; skipIds: ReadonlySet<number> }) {
    renders++;
    const value = useLocalLyricsSearch(props.query, SONGS, props.skipIds);
    useLayoutEffect(() => {
      shown = value;
    });
    return null;
  }
  let renderer: ReturnType<typeof create> | undefined;
  await act(async () => {
    renderer = create(createElement(Lyrics, { query, skipIds }));
  });
  return {
    lines: () => shown.hits.map((hit) => hit.line),
    renders: () => renders,
    submit: (q: string) => act(async () => shown.submit(q)),
    update: (q: string, skips: ReadonlySet<number> = NO_SKIPS) =>
      act(async () => renderer?.update(createElement(Lyrics, { query: q, skipIds: skips }))),
    unmount: () => act(() => renderer?.unmount()),
  };
};

test("keystrokes read no lyrics; the read comes once typing pauses", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  io.reads.length = 0;
  io.answerWith(() => Promise.resolve([{ trackId: 1, lyrics: "I love you" }]));
  const view = await mount("l");
  try {
    for (const query of ["lo", "lov", "love"]) await view.update(query);
    assert.deepEqual(io.reads, [], "no read per keystroke");
    assert.deepEqual(view.lines(), []);
    await act(async () => t.mock.timers.tick(LYRICS_TYPING_PAUSE_MS));
    assert.deepEqual(io.reads, ["love"]);
    assert.deepEqual(view.lines(), ["I love you"]);
  } finally {
    await view.unmount();
  }
});

test("the last answer stays while a newer query waits, and a stale one is dropped", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  io.reads.length = 0;
  const finish = new Map<string, (c: unknown[]) => void>();
  io.answerWith((query: string) => new Promise((resolve) => finish.set(query, resolve)));
  const view = await mount("love");
  try {
    await view.submit("love");
    await act(async () => finish.get("love")?.([{ trackId: 1, lyrics: "I love you" }]));
    assert.deepEqual(view.lines(), ["I love you"]);

    await view.update("love m");
    await view.submit("love m");
    await view.update("love me");
    await act(async () => t.mock.timers.tick(LYRICS_TYPING_PAUSE_MS));
    assert.deepEqual(io.reads, ["love", "love m", "love me"]);
    assert.deepEqual(view.lines(), ["I love you"], "the section keeps its rows meanwhile");

    await act(async () => finish.get("love me")?.([{ trackId: 1, lyrics: "Love me do" }]));
    await act(async () => finish.get("love m")?.([{ trackId: 1, lyrics: "Love me tender" }]));
    assert.deepEqual(view.lines(), ["Love me do"], "the older answer, arriving late, is dropped");
  } finally {
    await view.unmount();
  }
});

test("what Songs shows changing reads nothing again", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  io.reads.length = 0;
  io.answerWith(() =>
    Promise.resolve([
      { trackId: 1, lyrics: "I love you" },
      { trackId: 2, lyrics: "love is all" },
    ]),
  );
  const view = await mount("love");
  try {
    await view.submit("love");
    assert.deepEqual(view.lines(), ["I love you", "love is all"]);
    await view.update("love", new Set([1]));
    assert.deepEqual(view.lines(), ["love is all"]);
    assert.deepEqual(io.reads, ["love"]);
  } finally {
    await view.unmount();
  }
});

test("a query's Lyrics results stay shown while the filling index is read again", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  io.answerWith(() => Promise.resolve([{ trackId: 1, lyrics: "I love you" }]));
  const view = await mount("love you");
  try {
    await act(async () => t.mock.timers.tick(LYRICS_TYPING_PAUSE_MS));
    assert.deepEqual(view.lines(), ["I love you"]);

    let finish: (candidates: unknown[]) => void = () => {};
    io.answerWith(() => new Promise((resolve) => (finish = resolve)));
    await act(async () => {
      io.bumpVersion();
    });
    assert.deepEqual(
      view.lines(),
      ["I love you"],
      "the index changing keeps the last answer until the new one arrives",
    );

    await act(async () => {
      finish([{ trackId: 1, lyrics: "I love you more" }]);
    });
    assert.deepEqual(view.lines(), ["I love you more"]);
  } finally {
    await view.unmount();
  }
});

test("clearing the field clears Lyrics", async (t) => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  io.answerWith(() => Promise.resolve([{ trackId: 1, lyrics: "I love you" }]));
  const view = await mount("love");
  try {
    await view.submit("love");
    assert.deepEqual(view.lines(), ["I love you"]);
    await view.update("");
    assert.deepEqual(view.lines(), []);
    await view.update("x");
    assert.deepEqual(view.lines(), [], "an old query's answer doesn't come back for a new one");
  } finally {
    await view.unmount();
  }
});

test("with nothing typed, the filling index changing renders nothing", async (t) => {
  // A scan bumps the index's version every 350 ms: an empty field has nothing to read again,
  // so Search doesn't render for it (#1438).
  t.mock.timers.enable({ apis: ["setTimeout"] });
  io.reads.length = 0;
  io.answerWith(() => Promise.resolve([{ trackId: 1, lyrics: "I love you" }]));
  const view = await mount("");
  try {
    const before = view.renders();
    for (let bump = 0; bump < 3; bump++)
      await act(async () => {
        io.bumpVersion();
      });
    assert.equal(view.renders(), before, "no render per version bump");

    await view.update("love");
    await act(async () => t.mock.timers.tick(LYRICS_TYPING_PAUSE_MS));
    assert.deepEqual(io.reads, ["love"], "typing then reads once, after the pause");
    assert.deepEqual(view.lines(), ["I love you"]);
    await act(async () => {
      io.bumpVersion();
    });
    assert.deepEqual(io.reads, ["love", "love"], "with a query, a bump reads it again");
  } finally {
    await view.unmount();
  }
});
