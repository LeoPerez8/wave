import assert from "node:assert/strict";
import { test } from "node:test";
import { resolveRecognition } from "./resolveRecognition.ts";

const heard = {
  title: "Halo",
  artist: "Beyonce",
  album: null,
  coverUrl: "https://shazam/halo",
  isrc: null,
  releaseYear: null,
};
const track = {
  id: 5,
  title: "Halo",
  artist: "Beyoncé",
  album: "Library album",
  durationMs: 200_000,
};
const song = {
  videoId: "halo",
  title: "HALO",
  artists: ["Beyoncé"],
  album: "Online album",
  albumId: null,
  durationMs: 250_000,
  artworkUrl: "https://youtube/halo",
  explicit: false,
};

test("recognition searches Songs once through Search's shared allowance when the Library has no match", async () => {
  const asked: unknown[] = [];
  let libraryReads = 0;
  const abort = new AbortController();
  const answer = await resolveRecognition(
    {
      library: async () => {
        libraryReads++;
        return [];
      },
      ytMusic: () => true,
      search: async (...args) => {
        asked.push(args);
        return { ok: true, songs: [song] };
      },
    },
    heard,
    abort.signal,
  );
  assert.equal(libraryReads, 1);
  assert.deepEqual(asked, [["search", "Halo Beyonce", abort.signal]]);
  assert.deepEqual(answer, { kind: "resolved", lookup: "match", result: { kind: "stream", song } });
});

test("a rejected Songs search saves an unsearched song instead of calling it unavailable", async () => {
  const answer = await resolveRecognition(
    {
      library: async () => [],
      ytMusic: () => true,
      search: async () => {
        throw new Error("Network lost");
      },
    },
    heard,
    new AbortController().signal,
  );
  assert.deepEqual(answer, {
    kind: "resolved",
    lookup: "failed",
    result: {
      kind: "unsearched",
      song: {
        title: "Halo",
        artists: ["Beyonce"],
        album: null,
        durationMs: null,
        artworkUrl: "https://shazam/halo",
      },
    },
  });
});

test("a Library match and YT Music being off both avoid a network search", async () => {
  for (const [library, enabled, expected] of [
    [[track], true, "library"],
    [[], false, "unsearched"],
  ] as const) {
    const result = await resolveRecognition(
      {
        library: async () => library,
        ytMusic: () => enabled,
        search: async () => {
          assert.fail("This song should need no search");
        },
      },
      heard,
      new AbortController().signal,
    );
    assert.equal(result.result.kind, expected);
  }
});

test("no online match becomes unavailable, and offline or disabled answers stay unsearched", async () => {
  for (const [answer, kind, lookup] of [
    [{ ok: true, songs: [] }, "unavailable", "notFound"],
    [{ ok: false, reason: "offline" }, "unsearched", "failed"],
    [{ ok: false, reason: "disabled" }, "unsearched", "disabled"],
  ] as const) {
    const result = await resolveRecognition(
      { library: async () => [], ytMusic: () => true, search: async () => answer },
      heard,
      new AbortController().signal,
    );
    assert.equal(result.result.kind, kind);
    assert.equal(result.lookup, lookup);
  }
});
