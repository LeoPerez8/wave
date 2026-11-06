import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createRelatedSongsSession } from "./index.ts";

/** A read held open until the test answers or fails it, counting the reads asked for. */
const reads = () => {
  const asked: string[] = [];
  const pending = new Map<string, { answer: (songs: string[]) => void; fail: () => void }>();
  const read = (videoId: string): Promise<string[]> => {
    asked.push(videoId);
    return new Promise((resolve, reject) => {
      pending.set(videoId, { answer: resolve, fail: () => reject(new Error("offline")) });
    });
  };
  /** Lets the session hear a settled read. */
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    read,
    asked,
    answer: async (videoId: string, songs: string[]) => {
      pending.get(videoId)!.answer(songs);
      await settle();
    },
    fail: async (videoId: string) => {
      pending.get(videoId)!.fail();
      await settle();
    },
  };
};

describe("the related songs a session keeps", () => {
  test("a song's related songs load, then show once read", async () => {
    const youtube = reads();
    const session = createRelatedSongsSession(youtube.read);
    session.read("song-a");
    assert.deepEqual(session.shown("song-a"), { status: "loading" });
    await youtube.answer("song-a", ["x", "y"]);
    assert.deepEqual(session.shown("song-a"), { status: "loaded", answer: ["x", "y"] });
  });

  test("coming back to a song read in the session shows its answer without reading again", async () => {
    const youtube = reads();
    const session = createRelatedSongsSession(youtube.read);
    session.read("song-a");
    await youtube.answer("song-a", ["x"]);
    session.read("song-b");
    await youtube.answer("song-b", ["z"]);
    session.read("song-a");
    assert.deepEqual(youtube.asked, ["song-a", "song-b"]);
    assert.deepEqual(session.shown("song-a"), { status: "loaded", answer: ["x"] });
  });

  test("a read on its way isn't asked for twice", () => {
    const youtube = reads();
    const session = createRelatedSongsSession(youtube.read);
    session.read("song-a");
    session.read("song-a");
    assert.deepEqual(youtube.asked, ["song-a"]);
  });

  test("an answer that comes after the song changed is kept for that song", async () => {
    const youtube = reads();
    const session = createRelatedSongsSession(youtube.read);
    session.read("song-a");
    session.read("song-b");
    await youtube.answer("song-a", ["x"]);
    assert.deepEqual(session.shown("song-a"), { status: "loaded", answer: ["x"] });
    assert.deepEqual(session.shown("song-b"), { status: "loading" });
  });

  test("a failed read (offline, or YouTube failing) shows the error, and Try Again reads again", async () => {
    const youtube = reads();
    const session = createRelatedSongsSession(youtube.read);
    session.read("song-a");
    await youtube.fail("song-a");
    assert.deepEqual(session.shown("song-a"), { status: "failed" });
    session.read("song-a");
    assert.deepEqual(session.shown("song-a"), { status: "loading" });
    await youtube.answer("song-a", ["x"]);
    assert.deepEqual(session.shown("song-a"), { status: "loaded", answer: ["x"] });
    assert.deepEqual(youtube.asked, ["song-a", "song-a"]);
  });

  test("a song with no video id shows the error; one whose id isn't known yet shows loading", () => {
    const session = createRelatedSongsSession(reads().read);
    assert.deepEqual(session.shown(null), { status: "failed" });
    assert.deepEqual(session.shown(undefined), { status: "loading" });
  });

  test("what a song shows stays the same object until it changes, and listeners hear each change", async () => {
    const youtube = reads();
    const session = createRelatedSongsSession(youtube.read);
    let heard = 0;
    const stop = session.subscribe(() => (heard += 1));
    session.read("song-a");
    assert.equal(session.shown("song-a"), session.shown("song-a"));
    await youtube.answer("song-a", ["x"]);
    assert.equal(session.shown("song-a"), session.shown("song-a"));
    assert.equal(heard, 2);
    stop();
    session.read("song-b");
    assert.equal(heard, 2);
  });
});
