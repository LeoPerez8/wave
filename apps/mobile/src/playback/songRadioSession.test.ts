import assert from "node:assert/strict";
import { test } from "node:test";
import * as Effect from "effect/Effect";
import { createSongRadioSession, type SongRadioPage } from "./songRadioSession.ts";
const song = {
  videoId: "v",
  title: "Seed",
  artists: ["Seed artist"],
  album: null,
  albumId: null,
  durationMs: 180000,
  artworkUrl: null,
  explicit: false,
};
const seed = {
  id: "track:1",
  title: "Seed",
  artists: ["Seed artist"],
  videoId: "seed",
  durationMs: 180000,
};
const page: SongRadioPage = { songs: [song], continuation: "next" };
test("reads the song radio once, and its continuation only when low", async () => {
  const reads: string[] = [];
  const session = createSongRadioSession(seed, {
    cached: null,
    radio: (id) =>
      Effect.sync(() => {
        reads.push(id);
        return page;
      }),
    search: () => Effect.succeed([]),
    artist: () => Effect.succeed(null),
    more: (token) =>
      Effect.sync(() => {
        reads.push(token);
        return { songs: [{ ...song, videoId: "v2" }], continuation: null };
      }),
    save: () => Effect.void,
    fallback: () => {},
  });
  await Effect.runPromise(session.read({ online: true, low: false }));
  await Effect.runPromise(session.read({ online: true, low: false }));
  assert.deepEqual(reads, ["seed"]);
  const grown = await Effect.runPromise(session.read({ online: true, low: true }));
  assert.deepEqual(reads, ["seed", "next"]);
  assert.deepEqual(
    grown?.songs.map((s) => s.videoId),
    ["v", "v2"],
  );
});
test("a cached first batch returns while the live first page is pending", async () => {
  let finish!: (value: typeof page) => void;
  const pending = new Promise<typeof page>((resolve) => {
    finish = resolve;
  });
  const saved: string[] = [];
  const session = createSongRadioSession(seed, {
    cached: page,
    radio: () => Effect.promise(() => pending),
    search: () => Effect.succeed([]),
    artist: () => Effect.succeed(null),
    more: () => Effect.die("not low"),
    save: (p) =>
      Effect.sync(() => {
        saved.push(p.songs[0]!.videoId);
      }),
    fallback: () => {},
  });
  assert.equal(await Effect.runPromise(session.read({ online: true, low: false })), page);
  finish({ songs: [{ ...song, videoId: "live" }], continuation: null });
  for (let i = 0; i < 20 && saved.length === 0; i++)
    await new Promise((resolve) => setTimeout(resolve, 0));
  assert.deepEqual(saved, ["live"]);
  assert.equal(session.current()?.songs[0]?.videoId, "live");
});
test("search matches a Library seed, and no match falls back to its main artist with a log", async () => {
  for (const match of [true, false]) {
    const reads: string[] = [];
    const session = createSongRadioSession(
      { ...seed, videoId: undefined },
      {
        cached: null,
        search: (query) =>
          Effect.sync(() => {
            reads.push(query);
            return match ? [song] : [];
          }),
        radio: (id) =>
          Effect.sync(() => {
            reads.push(`song:${id}`);
            return page;
          }),
        artist: (name) =>
          Effect.sync(() => {
            reads.push(`artist:${name}`);
            return page;
          }),
        more: () => Effect.die("not low"),
        save: () => Effect.void,
        fallback: (name) => reads.push(`fallback:${name}`),
      },
    );
    assert.ok(await Effect.runPromise(session.read({ online: true, low: false })));
    assert.deepEqual(
      reads,
      match
        ? ["Seed Seed artist", "song:v"]
        : ["Seed Seed artist", "fallback:Seed artist", "artist:Seed artist"],
    );
  }
});
test("offline uses the cached radio without any network read", async () => {
  const session = createSongRadioSession(seed, {
    cached: page,
    radio: () => Effect.die("offline"),
    search: () => Effect.die("offline"),
    artist: () => Effect.die("offline"),
    more: () => Effect.die("offline"),
    save: () => Effect.void,
    fallback: () => {
      assert.fail("offline");
    },
  });
  assert.equal(await Effect.runPromise(session.read({ online: false, low: true })), page);
});
test("the network deadline cancels a stalled first read", async () => {
  let cancelled = false;
  const session = createSongRadioSession(seed, {
    cached: null,
    deadlineMs: 5,
    radio: () =>
      Effect.never.pipe(
        Effect.ensuring(
          Effect.sync(() => {
            cancelled = true;
          }),
        ),
      ),
    search: () => Effect.succeed([]),
    artist: () => Effect.succeed(null),
    more: () => Effect.die("no continuation"),
    save: () => Effect.void,
    fallback: () => {},
  });
  assert.equal(await Effect.runPromise(session.read({ online: true, low: false })), null);
  assert.equal(cancelled, true);
});
