import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resolveRecognizedSong,
  writeRecognizeMatch,
  type RecognizedSong,
  type RecognizeMatch,
  type RecognizeResolution,
  type RecognizeResult,
  type RecognizeTileFavorite,
} from "@wave/core";

import {
  followRecognizeTileFavorites,
  type RecognizeTileFavoriteNative,
} from "./recognizeTileFavorite.ts";

const SONG: RecognizedSong = {
  title: "I Will Survive",
  artist: "Gloria Gaynor",
  album: "Love Tracks",
  coverUrl: "https://example.com/cover.jpg",
  isrc: null,
  releaseYear: 1978,
};

const RESULT = (resolveRecognizedSong(SONG, [], "disabled") as RecognizeResolution).result;
const KEPT = writeRecognizeMatch(SONG, RESULT);

const settle = () => new Promise<void>((resolve) => setImmediate(resolve));

/** Android's half: taps on the notification's star waiting in native, and what JS answers. */
const fakeNative = () => {
  const taps: { match: string; on: boolean }[] = [];
  let requested: (() => void) | null = null;
  const native = {
    done: [] as { match: string; favorite: RecognizeTileFavorite | null }[],
    take: () => taps.shift() ?? null,
    onRequested: (listener: () => void) => {
      requested = listener;
      return () => void (requested = null);
    },
    favoriteDone: (match: string, favorite: RecognizeTileFavorite | null) =>
      void native.done.push({ match, favorite }),
    /** A tap reaches JS, which is already running. */
    tap: (match: string, on: boolean) => {
      taps.push({ match, on });
      requested?.();
    },
    /** A tap made before JS was running. */
    waiting: (match: string, on: boolean) => void taps.push({ match, on }),
  } satisfies RecognizeTileFavoriteNative & Record<string, unknown>;
  return native;
};

const setup = (
  options: {
    star?: (result: RecognizeResult, on: boolean) => Promise<void>;
    favorite?: (result: RecognizeResult) => Promise<RecognizeTileFavorite | null>;
  } = {},
) => {
  const stars: { result: RecognizeResult; on: boolean }[] = [];
  const read: RecognizeMatch[] = [];
  const logs: { level: string; line: string }[] = [];
  let starred = false;
  const deps = {
    result: async (match: RecognizeMatch) => {
      read.push(match);
      return RESULT;
    },
    star:
      options.star ??
      (async (result: RecognizeResult, on: boolean) => {
        stars.push({ result, on });
        starred = on;
      }),
    favorite:
      options.favorite ??
      (async () =>
        starred ? { label: "Remove from Favorites", on: false } : { label: "Favorite", on: true }),
    log: (level: "warn" | "info", line: string) => void logs.push({ level, line }),
  };
  return { deps, stars, read, logs };
};

test("Favorite on the notification stars the kept match's song, and the button turns to Remove", async () => {
  const world = setup();
  const native = fakeNative();
  followRecognizeTileFavorites(native, world.deps);
  native.tap(KEPT, true);
  await settle();
  assert.deepEqual(
    world.read.map((match) => match.song.title),
    [SONG.title],
  );
  assert.deepEqual(world.stars, [{ result: RESULT, on: true }]);
  assert.deepEqual(native.done, [
    { match: KEPT, favorite: { label: "Remove from Favorites", on: false } },
  ]);
});

test("Remove from Favorites unstars it, and the button turns back to Favorite", async () => {
  const world = setup();
  const native = fakeNative();
  followRecognizeTileFavorites(native, world.deps);
  native.tap(KEPT, false);
  await settle();
  assert.deepEqual(world.stars, [{ result: RESULT, on: false }]);
  assert.deepEqual(native.done, [{ match: KEPT, favorite: { label: "Favorite", on: true } }]);
});

test("a tap made before JS was running is answered once JS follows the notification", async () => {
  const world = setup();
  const native = fakeNative();
  native.waiting(KEPT, true);
  followRecognizeTileFavorites(native, world.deps);
  await settle();
  assert.deepEqual(world.stars, [{ result: RESULT, on: true }]);
  assert.equal(native.done.length, 1);
});

test("a write that fails warns without the song, and the button shows the star as it is", async () => {
  const world = setup({ star: () => Promise.reject(new Error(`Disk full: ${SONG.title}`)) });
  const native = fakeNative();
  followRecognizeTileFavorites(native, world.deps);
  native.tap(KEPT, true);
  await settle();
  assert.deepEqual(native.done, [{ match: KEPT, favorite: { label: "Favorite", on: true } }]);
  assert.deepEqual(
    world.logs.map(({ level }) => level),
    ["warn"],
  );
  assert.equal(world.logs[0]!.line.includes(SONG.title), false);
});

test("a kept match that can't be read stars nothing and leaves the button as it is", async () => {
  const world = setup();
  const native = fakeNative();
  followRecognizeTileFavorites(native, world.deps);
  native.tap("{", true);
  await settle();
  assert.deepEqual(world.stars, []);
  assert.deepEqual(native.done, [{ match: "{", favorite: null }]);
});

test("a star that can't be read afterwards leaves the button as it is", async () => {
  const world = setup({ favorite: () => Promise.reject(new Error("closed")) });
  const native = fakeNative();
  followRecognizeTileFavorites(native, world.deps);
  native.tap(KEPT, true);
  await settle();
  assert.deepEqual(world.stars, [{ result: RESULT, on: true }]);
  assert.deepEqual(native.done, [{ match: KEPT, favorite: null }]);
});

test("every waiting tap is answered", async () => {
  const world = setup();
  const native = fakeNative();
  native.waiting(KEPT, true);
  native.waiting(KEPT, false);
  followRecognizeTileFavorites(native, world.deps);
  await settle();
  assert.deepEqual(
    world.stars.map(({ on }) => on),
    [true, false],
  );
  assert.equal(native.done.length, 2);
});
