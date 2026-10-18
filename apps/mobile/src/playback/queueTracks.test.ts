/// <reference types="node" />
import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";

import type { QueueEntry, YtSong } from "@wave/core";
import * as Effect from "effect/Effect";

import type { PlayableSongRow } from "../library/LibraryStore.ts";
import {
  YT_COVERS_AT_ONCE,
  cacheYtCoversLater,
  learnQueueTracks,
  learnUnknownQueueTracks,
  lookupFailed,
  queueTracks,
  toQueueTrack,
  toUnsearchedQueueTrack,
  toYtQueueTrack,
  tracksToLookUp,
} from "./queueTracks.ts";

const song = (
  id: number,
  thumbPath: string | null = `/covers/${id}.thumb.jpg`,
): PlayableSongRow => ({
  id,
  path: `/music/${id}.flac`,
  title: `Song ${id}`,
  artist: `Artist ${id}`,
  album: `Album ${id}`,
  durationMs: 180_000,
  thumbPath,
  artworkPath: thumbPath === null ? null : `/covers/${id}.jpg`,
  titleSort: `song ${id}`,
  artistSort: `artist ${id}`,
  albumSort: `album ${id}`,
  addedAt: 0,
  albumId: id,
  artistId: id,
  artistIds: [id],
  discNumber: null,
  trackNumber: null,
  year: null,
  genre: null,
  hasLyrics: false,
  explicit: "unknown",
});

const ytSong = (videoId: string): YtSong => ({
  videoId,
  title: `Song ${videoId}`,
  artists: ["Artist"],
  album: null,
  durationMs: null,
  artworkUrl: `https://covers/${videoId}`,
  explicit: false,
});

const cover = (url: string) => ({
  path: `${url}.jpg`,
  thumbPath: `${url}.thumb.jpg`,
  palette: { dominant: "#000" },
});

/** Caches a cover while a new play replaces the queue. */
const cacheAfterNewPlay = (url: string) =>
  Effect.sync(() => {
    learnQueueTracks([song(1)].map(toQueueTrack), { forgetOthers: true });
    return cover(url);
  });

const entry = (trackId: string, key = `k${trackId}`): QueueEntry => ({
  key,
  trackId,
  contextIndex: null,
});

beforeEach(() => learnQueueTracks([], { forgetOthers: true }));

describe("queue tracks", () => {
  test("a queued song carries its thumbnail for the queue rows", () => {
    assert.deepEqual(toQueueTrack(song(7)), {
      id: "7",
      path: "/music/7.flac",
      title: "Song 7",
      artist: "Artist 7",
      album: "Album 7",
      artworkPath: "/covers/7.jpg",
      thumbPath: "/covers/7.thumb.jpg",
      explicit: false,
    });
    assert.equal(toQueueTrack(song(8, null)).thumbPath, null);
  });

  test("a queued song carries whether it's explicit, unknown counting as clean", () => {
    assert.equal(toQueueTrack({ ...song(1), explicit: "explicit" }).explicit, true);
    assert.equal(toQueueTrack({ ...song(2), explicit: "clean" }).explicit, false);
    assert.equal(toQueueTrack(song(3)).explicit, false);
    assert.equal(toYtQueueTrack({ ...ytSong("x"), explicit: true }, null).explicit, true);
  });

  test("a YT Music song plays by its track id, with its credit and cached artwork", () => {
    const track = toYtQueueTrack(
      {
        videoId: "kJQP7kiw5Fk",
        title: "Despacito",
        artists: ["Luis Fonsi", "Daddy Yankee"],
        album: "VIDA",
        durationMs: 229_000,
        artworkUrl: "https://lh3.googleusercontent.com/despacito=w544-h544",
        explicit: false,
      },
      {
        path: "/files/artwork/abc.jpg",
        thumbPath: "/files/artwork/abc_thumb.jpg",
        palette: { dominant: "#203040" },
      },
    );
    assert.deepEqual(track, {
      id: "yt:kJQP7kiw5Fk",
      path: "yt:kJQP7kiw5Fk",
      title: "Despacito",
      artist: "Luis Fonsi & Daddy Yankee",
      artists: ["Luis Fonsi", "Daddy Yankee"],
      album: "VIDA",
      artworkPath: "/files/artwork/abc.jpg",
      thumbPath: "/files/artwork/abc_thumb.jpg",
      palette: { dominant: "#203040" },
      explicit: false,
      durationMs: 229_000,
    });
  });

  test("without cached artwork, a YT Music song shows YouTube's cover at the large size", () => {
    const track = toYtQueueTrack(
      {
        videoId: "kJQP7kiw5Fk",
        title: "Despacito",
        artists: ["Luis Fonsi"],
        album: null,
        durationMs: null,
        artworkUrl: "https://lh3.googleusercontent.com/despacito=w120-h120-l90-rj",
        explicit: false,
      },
      null,
    );
    assert.equal(
      track.artworkPath,
      "https://lh3.googleusercontent.com/despacito=w1200-h1200-l90-rj",
    );
    assert.equal(track.thumbPath, null);
    assert.equal(track.palette, null);
  });

  test("learned tracks are there to read straight away, and tell subscribers", () => {
    let told = 0;
    const stop = queueTracks.subscribe(() => told++);
    learnQueueTracks([song(1), song(2)].map(toQueueTrack));
    learnQueueTracks([song(3)].map(toQueueTrack));
    stop();
    assert.equal(told, 2);
    assert.deepEqual([...queueTracks.get().keys()], ["1", "2", "3"]);
    assert.equal(queueTracks.get().get("2")?.title, "Song 2");
  });

  test("a new play forgets the old queue's tracks", () => {
    learnQueueTracks([song(1)].map(toQueueTrack));
    learnQueueTracks([song(2)].map(toQueueTrack), { forgetOthers: true });
    assert.deepEqual([...queueTracks.get().keys()], ["2"]);
  });

  test("covers cached after a play starts fill in the queued YT Music songs, a few at a time", async () => {
    const songs = ["a", "b", "c", "d", "e"].map(ytSong);
    learnQueueTracks(
      songs.map((s) => toYtQueueTrack(s, null)),
      { forgetOthers: true },
    );
    let caching = 0;
    let most = 0;
    const cache = (url: string) =>
      Effect.gen(function* () {
        caching += 1;
        most = Math.max(most, caching);
        yield* Effect.sleep(5);
        caching -= 1;
        return cover(url);
      });

    await Effect.runPromise(cacheYtCoversLater(songs, cache));

    assert.equal(most, YT_COVERS_AT_ONCE);
    assert.equal(queueTracks.get().get("yt:c")?.thumbPath, "https://covers/c.thumb.jpg");
    assert.equal(queueTracks.get().get("yt:e")?.artworkPath, "https://covers/e.jpg");
  });

  test("a cover cached after its song left the queue doesn't bring it back", async () => {
    learnQueueTracks([toYtQueueTrack(ytSong("a"), null)], { forgetOthers: true });
    await Effect.runPromise(cacheYtCoversLater([ytSong("a")], cacheAfterNewPlay));

    assert.deepEqual([...queueTracks.get().keys()], ["1"]);
  });

  test("covers landing together reach subscribers in one change", async () => {
    const songs = Array.from({ length: 50 }, (_, i) => ytSong(`s${i}`));
    learnQueueTracks(
      songs.map((s) => toYtQueueTrack(s, null)),
      { forgetOthers: true },
    );
    let told = 0;
    const stop = queueTracks.subscribe(() => told++);
    await Effect.runPromise(cacheYtCoversLater(songs, (url) => Effect.succeed(cover(url))));
    stop();

    assert.equal(told, 1);
    for (const s of songs) {
      const track = queueTracks.get().get(`yt:${s.videoId}`);
      assert.equal(track?.thumbPath, `https://covers/${s.videoId}.thumb.jpg`);
      assert.deepEqual(track?.palette, { dominant: "#000" });
    }
  });

  test("the playing song's cover shows at once, while the others' wait for company", async () => {
    const songs = ["a", "b", "c"].map(ytSong);
    learnQueueTracks(
      songs.map((s) => toYtQueueTrack(s, null)),
      { forgetOthers: true },
    );
    let release = (): void => {};
    const later = new Promise<void>((resolve) => {
      release = resolve;
    });
    const seen: (string | null | undefined)[][] = [];
    const cache = (url: string) =>
      url.endsWith("/b")
        ? Effect.succeed(cover(url))
        : Effect.promise(() => later).pipe(Effect.as(cover(url)));
    const stop = queueTracks.subscribe(() =>
      seen.push(["a", "b", "c"].map((id) => queueTracks.get().get(`yt:${id}`)?.thumbPath)),
    );
    const caching = Effect.runPromise(
      cacheYtCoversLater(songs, cache, (trackId) => trackId === "yt:b"),
    );
    await new Promise((resolve) => setTimeout(resolve, 0));
    release();
    await caching;
    stop();

    assert.deepEqual(seen, [
      [null, "https://covers/b.thumb.jpg", null],
      ["https://covers/a.thumb.jpg", "https://covers/b.thumb.jpg", "https://covers/c.thumb.jpg"],
    ]);
  });

  test("a song that left the queue before its turn isn't cached", async () => {
    const songs = ["a", "b", "c", "d"].map(ytSong);
    learnQueueTracks(
      songs.map((s) => toYtQueueTrack(s, null)),
      { forgetOthers: true },
    );
    const cached: string[] = [];
    const cache = (url: string) =>
      Effect.sync(() => {
        cached.push(url);
        // A new play takes over while the first covers are cached.
        learnQueueTracks([song(1)].map(toQueueTrack), { forgetOthers: true });
        return cover(url);
      });
    await Effect.runPromise(cacheYtCoversLater(songs, cache));

    // Those already under way when it took over may finish; none starts after.
    assert.ok(cached.length <= YT_COVERS_AT_ONCE);
    assert.ok(!cached.includes("https://covers/c") && !cached.includes("https://covers/d"));
    assert.deepEqual([...queueTracks.get().keys()], ["1"]);
  });

  test("a cover that can't be cached leaves YouTube's", async () => {
    learnQueueTracks([toYtQueueTrack(ytSong("a"), null)], { forgetOthers: true });

    await Effect.runPromise(cacheYtCoversLater([ytSong("a")], () => Effect.fail("offline")));

    assert.equal(queueTracks.get().get("yt:a")?.artworkPath, "https://covers/a");
  });

  test("a YT Music row's small cover is cached at the large size", async () => {
    const small = {
      ...ytSong("a"),
      artworkUrl: "https://lh3.googleusercontent.com/a=w120-h120-l90-rj",
    };
    learnQueueTracks([toYtQueueTrack(small, null)], { forgetOthers: true });
    const cached: string[] = [];
    const cache = (url: string) => Effect.sync(() => (cached.push(url), cover(url)));

    await Effect.runPromise(cacheYtCoversLater([small], cache));

    assert.deepEqual(cached, ["https://lh3.googleusercontent.com/a=w1200-h1200-l90-rj"]);
  });

  test("a video thumbnail is cached at the largest size the video has", async () => {
    const video = {
      ...ytSong("a"),
      artworkUrl: "https://i.ytimg.com/vi/vid/hqdefault.jpg?sqp=abc",
    };
    learnQueueTracks([toYtQueueTrack(video, null)], { forgetOthers: true });
    const asked: string[] = [];
    const cache = (url: string) =>
      Effect.suspend(() => {
        asked.push(url);
        return url.includes("maxres") ? Effect.fail("HTTP 404") : Effect.succeed(cover(url));
      });

    await Effect.runPromise(cacheYtCoversLater([video], cache));

    assert.deepEqual(asked, [
      "https://i.ytimg.com/vi/vid/maxresdefault.jpg",
      "https://i.ytimg.com/vi/vid/sddefault.jpg",
    ]);
    assert.equal(
      queueTracks.get().get("yt:a")?.artworkPath,
      "https://i.ytimg.com/vi/vid/sddefault.jpg.jpg",
    );
  });

  test("nothing to learn leaves the tracks as they were", () => {
    learnQueueTracks([song(1)].map(toQueueTrack));
    const before = queueTracks.get();
    learnQueueTracks([]);
    assert.equal(queueTracks.get(), before);
  });
});

describe("tracksToLookUp", () => {
  test("asks only for tracks the queue doesn't know, each once", () => {
    learnQueueTracks([song(1)].map(toQueueTrack));
    const entries = [entry("1"), entry("2"), entry("3"), entry("2", "again")];
    assert.deepEqual(tracksToLookUp(entries), ["2", "3"]);
    // Asked already: opening the queue again doesn't ask again, even before the answer.
    assert.deepEqual(tracksToLookUp(entries), []);
  });

  test("a failed lookup is asked again next time", () => {
    assert.deepEqual(tracksToLookUp([entry("40")]), ["40"]);
    lookupFailed(["40"]);
    assert.deepEqual(tracksToLookUp([entry("40")]), ["40"]);
  });
});

describe("learnUnknownQueueTracks", () => {
  test("looks up the unknown tracks once and learns them", async () => {
    learnQueueTracks([song(1)].map(toQueueTrack));
    const asked: number[][] = [];
    const songsByIds = (ids: readonly number[]) =>
      Effect.sync(() => {
        asked.push([...ids]);
        return ids.map((id) => song(id));
      });
    await Effect.runPromise(learnUnknownQueueTracks([entry("1"), entry("5")], songsByIds));
    await Effect.runPromise(learnUnknownQueueTracks([entry("1"), entry("5")], songsByIds));
    assert.deepEqual(asked, [[5]]);
    assert.equal(queueTracks.get().get("5")?.title, "Song 5");
  });

  test("a YT Music song is never looked up in the Library", async () => {
    const asked: number[][] = [];
    const songsByIds = (ids: readonly number[]) =>
      Effect.sync(() => {
        asked.push([...ids]);
        return ids.map((id) => song(id));
      });
    await Effect.runPromise(
      learnUnknownQueueTracks([entry("yt:dQw4w9WgXcQ"), entry("9")], songsByIds),
    );
    assert.deepEqual(asked, [[9]]);
  });

  test("a YT Music song the queue doesn't know is learned from the details saved with the queue", async () => {
    const saved = toYtQueueTrack(
      {
        videoId: "dQw4w9WgXcQ",
        title: "Never Gonna Give You Up",
        artists: ["Rick Astley"],
        album: "Whenever You Need Somebody",
        durationMs: 213_000,
        artworkUrl: "https://lh3.googleusercontent.com/cover=w544-h544",
        explicit: false,
      },
      null,
    );
    const none = () => Effect.succeed([] as PlayableSongRow[]);
    await Effect.runPromise(
      learnUnknownQueueTracks([entry("yt:dQw4w9WgXcQ")], none, () => [saved]),
    );
    assert.equal(queueTracks.get().get("yt:dQw4w9WgXcQ")?.title, "Never Gonna Give You Up");
  });

  test("an unsearched song is learned from the details saved with the queue, never looked up", async () => {
    const saved = toUnsearchedQueueTrack({
      title: "Touch",
      artists: ["Daft Punk", "Paul Williams"],
      album: "Random Access Memories",
      durationMs: 498_000,
      artworkUrl: "https://i.scdn.co/image/ram",
    });
    assert.deepEqual(
      [saved.artist, saved.artworkPath, saved.thumbPath],
      ["Daft Punk & Paul Williams", "https://i.scdn.co/image/ram", null],
    );
    const asked: number[][] = [];
    const songsByIds = (ids: readonly number[]) => {
      asked.push([...ids]);
      return Effect.succeed([] as PlayableSongRow[]);
    };
    await Effect.runPromise(learnUnknownQueueTracks([entry(saved.id)], songsByIds, () => [saved]));
    assert.equal(queueTracks.get().get(saved.id)?.title, "Touch");
    assert.deepEqual(asked, []);
  });

  test("a failed lookup is tried again next time", async () => {
    const failing = () => Effect.fail("no database");
    await Effect.runPromise(learnUnknownQueueTracks([entry("6")], failing));
    const found = (ids: readonly number[]) => Effect.succeed(ids.map((id) => song(id)));
    await Effect.runPromise(learnUnknownQueueTracks([entry("6")], found));
    assert.equal(queueTracks.get().get("6")?.title, "Song 6");
  });
});
