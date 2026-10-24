import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { createSongRadioReaders } from "./songRadioReaders.ts";
import type { SongRadioPage, SongRadioSeed } from "./songRadioSession.ts";

const seed = (id: string): SongRadioSeed => ({
  id,
  title: id,
  artists: [`${id} artist`],
  durationMs: null,
});
const pageOf = (videoId: string): SongRadioPage => ({
  songs: [
    {
      videoId,
      title: videoId,
      artists: ["A"],
      album: null,
      albumId: null,
      durationMs: 1,
      artworkUrl: null,
      explicit: false,
    },
  ],
  continuation: null,
});

/** Readers that record what was created and read, each answering with a page named after its radio. */
const recording = () => {
  const created: string[] = [];
  const reads: string[] = [];
  const readers = createSongRadioReaders((radio: SongRadioSeed) => {
    created.push(radio.id);
    let page: SongRadioPage | null = null;
    return {
      current: () => page,
      read: () =>
        Effect.sync(() => {
          reads.push(radio.id);
          page = pageOf(`${radio.id} page`);
          return page;
        }),
    };
  });
  return { readers, created, reads };
};

test("a batch reads each of its radios, keeping one reader per session and radio", async () => {
  const { readers, created, reads } = recording();
  const pages = await Effect.runPromise(
    readers.read("s1", [seed("song:1"), seed("song:2")], { online: true, low: false }),
  );
  assert.deepEqual(
    pages.map(({ seed: radio, page }) => [radio.id, page?.songs[0]?.videoId]),
    [
      ["song:1", "song:1 page"],
      ["song:2", "song:2 page"],
    ],
  );
  await Effect.runPromise(
    readers.read("s1", [seed("song:2"), seed("song:3")], { online: true, low: false }),
  );
  for (let i = 0; i < 20 && reads.length < 4; i++)
    await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(created, ["song:1", "song:2", "song:3"]);
  assert.deepEqual(reads, ["song:1", "song:2", "song:2", "song:3"]);
  await Effect.runPromise(readers.read("s2", [seed("song:1")], { online: true, low: false }));
  assert.deepEqual(created, ["song:1", "song:2", "song:3", "song:1"]);
  assert.deepEqual(
    readers.current("s1", [seed("song:3"), seed("song:9")]).map(({ page }) => page !== null),
    [true, false],
  );
});

test("a batch's radios are read at once, not one after another", async () => {
  const started: string[] = [];
  const finishers: (() => void)[] = [];
  const readers = createSongRadioReaders((radio: SongRadioSeed) => ({
    current: () => null,
    read: () =>
      Effect.promise(
        () =>
          new Promise<SongRadioPage>((resolve) => {
            started.push(radio.id);
            finishers.push(() => resolve(pageOf(radio.id)));
          }),
      ),
  }));
  const reading = Effect.runPromise(
    readers.read("s", [seed("song:1"), seed("song:2"), seed("song:3")], {
      online: true,
      low: false,
    }),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(started, ["song:1", "song:2", "song:3"]);
  for (const finish of finishers) finish();
  assert.equal((await reading).length, 3);
});

test("only the latest sessions keep their readers", async () => {
  const { readers, created } = recording();
  for (let index = 0; index <= 20; index++)
    await Effect.runPromise(
      readers.read(`s${index}`, [seed("song:1")], { online: true, low: false }),
    );
  await Effect.runPromise(readers.read("s20", [seed("song:1")], { online: true, low: false }));
  assert.equal(created.length, 21);
  await Effect.runPromise(readers.read("s0", [seed("song:1")], { online: true, low: false }));
  assert.equal(created.length, 22);
});

test("a radio not read yet already shows the page its new reader starts from", () => {
  const readers = createSongRadioReaders((radio: SongRadioSeed) => ({
    current: () => (radio.id === "song:cached" ? pageOf("kept") : null),
    read: () => Effect.succeed(null),
  }));
  assert.deepEqual(
    readers.current("s", [seed("song:cached"), seed("song:new")]).map(({ page }) => page !== null),
    [true, false],
  );
});
test("one cached radio supplies the first batch while uncached radios finish in the background", async () => {
  let finish!: (page: SongRadioPage) => void;
  const pending = new Promise<SongRadioPage>((resolve) => {
    finish = resolve;
  });
  const readers = createSongRadioReaders((radio: SongRadioSeed) => {
    let page = radio.id === "cached" ? pageOf("cached song") : null;
    return {
      current: () => page,
      read: () =>
        radio.id === "cached"
          ? Effect.succeed(page)
          : Effect.promise(() => pending).pipe(
              Effect.tap((received) =>
                Effect.sync(() => {
                  page = received;
                }),
              ),
            ),
    };
  });
  const seeds = [seed("cached"), seed("cold")];
  const immediate = await Promise.race([
    Effect.runPromise(readers.read("s", seeds, { online: true, low: false })),
    new Promise<null>((resolve) => setTimeout(() => resolve(null), 50)),
  ]);
  finish(pageOf("live song"));
  assert.deepEqual(
    immediate?.map(({ page }) => page?.songs[0]?.videoId ?? null),
    ["cached song", null],
  );
  for (let i = 0; i < 20 && readers.current("s", seeds)[1]?.page === null; i++)
    await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(readers.current("s", seeds)[1]?.page?.songs[0]?.videoId, "live song");
});
