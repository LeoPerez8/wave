import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { catalogueOf, createRelatedSearches, createRelatedSongsSession } from "./index.ts";

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

/** A YouTube Music Songs search held open until the test answers or fails it. */
const searches = () => {
  const asked: string[] = [];
  const pending: { answer: (songs: unknown[]) => void; fail: () => void }[] = [];
  const search = (query: string) => {
    asked.push(query);
    return new Promise<readonly SearchHit[]>((resolve, reject) => {
      pending.push({
        answer: (songs) => resolve(songs as SearchHit[]),
        fail: () => reject(new Error("offline")),
      });
    });
  };
  const settle = () => new Promise((resolve) => setTimeout(resolve, 0));
  return {
    search,
    asked,
    answer: async (songs: readonly SearchHit[]) => {
      pending.shift()!.answer([...songs]);
      await settle();
    },
    fail: async () => {
      pending.shift()!.fail();
      await settle();
    },
  };
};

interface SearchHit {
  readonly videoId: string;
  readonly title: string;
  readonly artists: readonly string[];
  readonly durationMs: number | null;
}

/** A Library song with no YouTube video id: Daft Punk's "Get Lucky", 4:08. */
const lucky = {
  id: 7,
  title: "Get Lucky",
  artists: ["Daft Punk", "Pharrell Williams"],
  durationMs: 248_000,
};
const hit = (videoId: string, title: string, artists: string[], durationMs: number): SearchHit => ({
  videoId,
  title,
  artists,
  durationMs,
});

describe("a Library song without a video id, searched for Related", () => {
  test("is searched by its title and artists, and takes the first result that is the same recording", async () => {
    const youtube = searches();
    const related = createRelatedSearches(youtube.search);
    related.find(lucky);
    assert.equal(related.videoId(lucky.id), undefined, "searching shows loading");
    await youtube.answer([
      hit("cover", "Get Lucky", ["Daft Punk Tribute Band"], 248_000),
      hit("live", "Get Lucky (Live)", ["Daft Punk"], 410_000),
      hit("song", "Get Lucky (feat. Pharrell Williams)", ["Daft Punk"], 249_000),
      hit("video", "Get Lucky", ["Daft Punk"], 248_000),
    ]);
    assert.deepEqual(youtube.asked, ["Get Lucky Daft Punk Pharrell Williams"]);
    assert.equal(related.videoId(lucky.id), "song");
  });

  test("the video id found is kept for the session, so coming back to the song doesn't search again", async () => {
    const youtube = searches();
    const related = createRelatedSearches(youtube.search);
    related.find(lucky);
    await youtube.answer([hit("song", "Get Lucky", ["Daft Punk"], 248_000)]);
    related.find(lucky);
    related.findAgain(lucky);
    assert.equal(youtube.asked.length, 1);
    assert.equal(related.videoId(lucky.id), "song");
  });

  test("no match gives no video id (the error), kept until Try Again searches again", async () => {
    const youtube = searches();
    const related = createRelatedSearches(youtube.search);
    related.find(lucky);
    await youtube.answer([hit("other", "Instant Crush", ["Daft Punk"], 337_000)]);
    assert.equal(related.videoId(lucky.id), null);
    related.find(lucky);
    assert.equal(youtube.asked.length, 1, "coming back keeps the miss");
    related.findAgain(lucky);
    assert.equal(related.videoId(lucky.id), undefined, "Try Again shows loading");
    await youtube.answer([hit("song", "Get Lucky", ["Daft Punk"], 248_000)]);
    assert.equal(youtube.asked.length, 2);
    assert.equal(related.videoId(lucky.id), "song");
  });

  test("a failed search (offline, or YouTube failing) gives the error and isn't kept", async () => {
    const youtube = searches();
    const related = createRelatedSearches(youtube.search);
    related.find(lucky);
    await youtube.fail();
    assert.equal(related.videoId(lucky.id), null);
    related.find(lucky);
    assert.equal(youtube.asked.length, 2, "coming back searches again");
    await youtube.fail();
    related.findAgain(lucky);
    assert.equal(youtube.asked.length, 3, "so does Try Again");
  });

  test("a search on its way isn't asked for twice", () => {
    const youtube = searches();
    const related = createRelatedSearches(youtube.search);
    related.find(lucky);
    related.find(lucky);
    related.findAgain(lucky);
    assert.equal(youtube.asked.length, 1);
  });

  test("a song not searched yet shows loading, and each song keeps its own answer", async () => {
    const youtube = searches();
    const related = createRelatedSearches(youtube.search);
    assert.equal(related.videoId(lucky.id), undefined);
    const crush = { id: 8, title: "Instant Crush", artists: ["Daft Punk"], durationMs: null };
    related.find(lucky);
    related.find(crush);
    assert.deepEqual(youtube.asked, [
      "Get Lucky Daft Punk Pharrell Williams",
      "Instant Crush Daft Punk",
    ]);
    await youtube.answer([hit("song", "Get Lucky", ["Daft Punk"], 248_000)]);
    await youtube.answer([
      hit("crush", "Instant Crush", ["Daft Punk", "Julian Casablancas"], 337_000),
    ]);
    assert.equal(related.videoId(lucky.id), "song");
    assert.equal(related.videoId(crush.id), "crush", "an unknown length still matches");
  });

  test("listeners hear each change of a song's answer", async () => {
    const youtube = searches();
    const related = createRelatedSearches(youtube.search);
    let heard = 0;
    const stop = related.subscribe(() => (heard += 1));
    related.find(lucky);
    await youtube.answer([]);
    assert.equal(heard, 2);
    stop();
    related.findAgain(lucky);
    assert.equal(heard, 2);
  });
});

describe("a related song's + button", () => {
  test("TalkBack reads it as Add to Queue with the song's name, in either language", () => {
    assert.equal(
      catalogueOf("en").playbackText.addValueToQueue("Get Lucky"),
      "Add to Queue, Get Lucky",
    );
    assert.equal(
      catalogueOf("pt-BR").playbackText.addValueToQueue("Get Lucky"),
      "Adicionar à Fila, Get Lucky",
    );
  });
});
