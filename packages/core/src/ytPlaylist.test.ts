import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { readYtPlaylist, ytPlaylistRestLine } from "./index.ts";
import type { YtPlaylistFirstPage, YtPlaylistPage, YtSong } from "./index.ts";

const song = (videoId: string): YtSong => ({
  videoId,
  title: videoId,
  artists: ["Artist"],
  album: null,
  durationMs: 200_000,
  artworkUrl: null,
  explicit: false,
});

const ids = (songs: readonly YtSong[]): string[] => songs.map((s) => s.videoId);

const head = { title: "Road Trip", author: "Ana", artworkUrl: "https://cover" };

const firstPage = (videoIds: string[], continuation: string | null): YtPlaylistFirstPage => ({
  ...head,
  songs: videoIds.map(song),
  continuation,
});

const page = (videoIds: string[], continuation: string | null): YtPlaylistPage => ({
  songs: videoIds.map(song),
  continuation,
});

/** Answers each continuation from [pages]; a token it doesn't know rejects. [asked] collects the tokens. */
const pagesFrom = (pages: Record<string, YtPlaylistPage>, asked: string[] = []) => {
  return async (token: string): Promise<YtPlaylistPage> => {
    asked.push(token);
    const answer = pages[token];
    if (answer === undefined) throw new Error(`unexpected continuation ${token}`);
    return answer;
  };
};

/** [count] distinct ids starting at [from]. */
const run = (from: number, count: number): string[] =>
  Array.from({ length: count }, (_, i) => `v${from + i}`);

describe("readYtPlaylist", () => {
  test("follows every page to the last, in order", async () => {
    const asked: string[] = [];
    const read = await readYtPlaylist(
      async () => firstPage(["a", "b"], "p2"),
      pagesFrom({ p2: page(["c", "d"], "p3"), p3: page(["e"], null) }, asked),
    );
    assert.deepEqual(asked, ["p2", "p3"]);
    assert.equal(read.title, "Road Trip");
    assert.equal(read.author, "Ana");
    assert.equal(read.artworkUrl, "https://cover");
    assert.deepEqual(ids(read.songs), ["a", "b", "c", "d", "e"]);
    assert.equal(read.truncated, false);
  });

  test("a playlist of one page asks for nothing more", async () => {
    const asked: string[] = [];
    const read = await readYtPlaylist(async () => firstPage(["a"], null), pagesFrom({}, asked));
    assert.deepEqual(asked, []);
    assert.deepEqual(ids(read.songs), ["a"]);
    assert.equal(read.truncated, false);
  });

  test("keeps a song listed twice once, at its first place", async () => {
    const read = await readYtPlaylist(
      async () => firstPage(["a", "b", "a"], "p2"),
      pagesFrom({ p2: page(["c", "b"], null) }),
    );
    assert.deepEqual(ids(read.songs), ["a", "b", "c"]);
    assert.deepEqual(ids(read.repeats), ["a", "b"], "the rows listed again, in their order");
  });

  test("stops at 5,000 songs and says the playlist goes on", async () => {
    // Pages of 100 songs that go on to a 60th page.
    const asked: string[] = [];
    const pages: Record<string, YtPlaylistPage> = {};
    for (let n = 2; n <= 60; n++) pages[`p${n}`] = page(run(n * 100, 100), `p${n + 1}`);
    const read = await readYtPlaylist(
      async () => firstPage(run(100, 100), "p2"),
      pagesFrom(pages, asked),
    );
    assert.equal(read.songs.length, 5000);
    assert.equal(read.songs[4999]?.videoId, "v5099");
    assert.equal(read.truncated, true);
    assert.equal(asked.length, 49, "no page asked for past the cap");
  });

  test("a page that goes past 5,000 is cut there", async () => {
    const pages: Record<string, YtPlaylistPage> = {};
    for (let n = 2; n <= 50; n++) pages[`p${n}`] = page(run(n * 100, 100), `p${n + 1}`);
    pages["p50"] = page(run(5000, 150), null);
    const read = await readYtPlaylist(async () => firstPage(run(100, 100), "p2"), pagesFrom(pages));
    assert.equal(read.songs.length, 5000);
    assert.equal(read.truncated, true);
  });

  test("stops a playlist whose pages never end after 100 pages", async () => {
    // A continuation that points back at itself: the same songs, page after page.
    const asked: string[] = [];
    const read = await readYtPlaylist(
      async () => firstPage(["a"], "loop"),
      pagesFrom({ loop: page(["b", "c"], "loop") }, asked),
    );
    assert.equal(asked.length, 99);
    assert.deepEqual(ids(read.songs), ["a", "b", "c"]);
    assert.equal(read.truncated, true);
  });

  test("a page that fails fails the whole read", async () => {
    const reset = new Error("reset");
    await assert.rejects(
      readYtPlaylist(
        async () => firstPage(["a"], "p2"),
        async () => {
          throw reset;
        },
      ),
      reset,
    );
  });

  test("hears the playlist grow page by page, and keeps what came before a page fails", async () => {
    const heard: { songs: string[]; done: boolean }[] = [];
    await assert.rejects(
      readYtPlaylist(
        async () => firstPage(["a", "b"], "p2"),
        pagesFrom({ p2: page(["c", "a"], "p3") }),
        {
          onPage: (playlist, done) => heard.push({ songs: ids(playlist.songs), done }),
        },
      ),
    );
    assert.deepEqual(heard, [
      { songs: ["a", "b"], done: false },
      { songs: ["a", "b", "c"], done: false },
    ]);
  });

  test("the last page is heard as done", async () => {
    const heard: boolean[] = [];
    await readYtPlaylist(async () => firstPage(["a"], "p2"), pagesFrom({ p2: page(["b"], null) }), {
      onPage: (_, done) => heard.push(done),
    });
    assert.deepEqual(heard, [false, true]);
  });

  test("asks for nothing more once cancelled", async () => {
    const asked: string[] = [];
    const cancel = new AbortController();
    await assert.rejects(
      readYtPlaylist(
        async () => firstPage(["a"], "p2"),
        pagesFrom({ p2: page(["b"], "p3"), p3: page(["c"], null) }, asked),
        { signal: cancel.signal, onPage: () => cancel.abort() },
      ),
    );
    assert.deepEqual(asked, []);
  });
});

describe("ytPlaylistRestLine", () => {
  test("says more songs are coming while the pages are read", () => {
    assert.equal(ytPlaylistRestLine("reading"), "Loading more songs…");
  });

  test("says nothing once every page is in", () => {
    assert.equal(ytPlaylistRestLine("read"), null);
  });

  test("says the rest didn't load when a later page fails, and why", () => {
    assert.equal(
      ytPlaylistRestLine("offline"),
      "You're offline, so the rest of this playlist didn't load.",
    );
    assert.equal(
      ytPlaylistRestLine("failed"),
      "The rest of this playlist didn't load. Go back and open it again to try once more.",
    );
  });
});
