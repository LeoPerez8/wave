import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  matchSharedSongs,
  sharedPlaylistChanges,
  sharedPlaylistMoves,
  sharedSongsLine,
  PLAYLIST_SHARE_LABELS,
  playlistShareServices,
  shareSignInAlert,
  sharedEditBatches,
  spotifyPlaylistUrl,
  ytMusicPlaylistUrl,
  ytShareMatch,
  ytShareSong,
  type YtSong,
} from "./index.ts";

const lucky = { title: "Get Lucky", artists: ["Daft Punk"], album: "RAM", durationMs: 369_000 };

const ytSong = (videoId: string, over: Partial<YtSong> = {}): YtSong => ({
  videoId,
  title: "Get Lucky",
  artists: ["Daft Punk"],
  album: "Random Access Memories",
  durationMs: 368_000,
  artworkUrl: null,
  explicit: false,
  ...over,
});

describe("ytShareSong", () => {
  test("shares a song by its YouTube video id when Wave knows it", () => {
    assert.deepEqual(ytShareSong({ source: "library", videoId: "v1", song: lucky }), { id: "v1" });
    assert.deepEqual(ytShareSong({ source: "stream", song: ytSong("v2") }), { id: "v2" });
  });

  test("searches a Library song without one, and an unsearched entry, by title and artists", () => {
    assert.deepEqual(ytShareSong({ source: "library", videoId: null, song: lucky }), {
      id: null,
      search: lucky,
    });
    assert.deepEqual(ytShareSong({ source: "unsearched", song: { ...lucky, artworkUrl: null } }), {
      id: null,
      search: { ...lucky, artworkUrl: null },
    });
  });

  test("leaves out an unavailable entry: YouTube Music already didn't have it", () => {
    const song = { ...lucky, artworkUrl: null, reason: "notFound" as const };
    assert.deepEqual(ytShareSong({ source: "unavailable", song }), { id: null });
  });
});

describe("ytShareMatch", () => {
  test("takes the first result that is the same recording", () => {
    const results = [ytSong("live", { title: "Get Lucky (Live)" }), ytSong("studio")];
    assert.equal(ytShareMatch(lucky, results), "studio");
  });

  test("finds nothing when no result is the song", () => {
    assert.equal(ytShareMatch(lucky, [ytSong("other", { artists: ["Someone Else"] })]), null);
  });
});

describe("matchSharedSongs", () => {
  test("takes known ids as they are and searches the songs without one, in order", async () => {
    const asked: string[] = [];
    const found: Record<string, string> = { "Get Lucky Daft Punk": "yt-lucky" };
    const shared = await matchSharedSongs(
      [
        { id: "yt-one" },
        { id: null, search: "Get Lucky Daft Punk" },
        { id: null, search: "Nothing Anyone" },
        { id: null },
        { id: "yt-two" },
      ],
      (query: string) => {
        asked.push(query);
        return Promise.resolve(found[query] ?? null);
      },
    );
    assert.deepEqual(asked, ["Get Lucky Daft Punk", "Nothing Anyone"]);
    assert.deepEqual(shared, { ids: ["yt-one", "yt-lucky", "yt-two"], found: 3, total: 5 });
  });

  test("puts a song listed twice in once, counting both as found", async () => {
    const shared = await matchSharedSongs([{ id: "a" }, { id: "b" }, { id: "a" }], () =>
      Promise.resolve(null),
    );
    assert.deepEqual(shared, { ids: ["a", "b"], found: 3, total: 3 });
  });

  test("stops when a search fails", async () => {
    await assert.rejects(
      matchSharedSongs([{ id: null, search: "x" }], () => Promise.reject(new Error("offline"))),
      /offline/u,
    );
  });
});

describe("sharedSongsLine", () => {
  test("says how many of the playlist's songs were found", () => {
    assert.equal(sharedSongsLine({ found: 12, total: 15 }), "12 of 15 songs found");
    assert.equal(sharedSongsLine({ found: 1, total: 1 }), "1 of 1 song found");
    assert.equal(sharedSongsLine({ found: 1200, total: 1500 }), "1,200 of 1,500 songs found");
  });
});

/** A shared playlist's entry: song [id] in the place called [entryId]. */
const entry = (id: string, entryId = `place-${id}`) => ({ id, entryId });

describe("sharedPlaylistChanges", () => {
  test("removes the entries no longer wanted and adds the new songs, in the playlist's order", () => {
    const changes = sharedPlaylistChanges(
      [entry("a"), entry("b"), entry("c")],
      ["d", "a", "c", "e"],
    );
    assert.deepEqual(changes, { removes: [entry("b")], adds: ["d", "e"] });
  });

  test("removes a song's second entry, as Wave shares each song once", () => {
    const changes = sharedPlaylistChanges(
      [entry("a", "1"), entry("b"), entry("a", "2")],
      ["a", "b"],
    );
    assert.deepEqual(changes, { removes: [entry("a", "2")], adds: [] });
  });

  test("changes nothing on a playlist that holds the wanted songs", () => {
    assert.deepEqual(sharedPlaylistChanges([entry("a"), entry("b")], ["b", "a"]), {
      removes: [],
      adds: [],
    });
  });
});

/**
 * What [moves] do to [entries], as the service applies them one after
 * another: each entry goes right before its `before`, or to the end.
 */
const applyMoves = (
  entries: readonly { id: string; entryId: string }[],
  moves: readonly { entryId: string; before: string | null }[],
): string[] => {
  const list = [...entries];
  for (const { entryId, before } of moves) {
    const moved = list.splice(
      list.findIndex((e) => e.entryId === entryId),
      1,
    );
    const at = before === null ? list.length : list.findIndex((e) => e.entryId === before);
    list.splice(at, 0, ...moved);
  }
  return list.map(({ id }) => id);
};

describe("sharedPlaylistMoves", () => {
  test("moves nothing in a playlist already in order", () => {
    assert.deepEqual(sharedPlaylistMoves([entry("a"), entry("b")], ["a", "b"]), []);
  });

  test("moves only the songs out of place", () => {
    const entries = [entry("b"), entry("c"), entry("d"), entry("a")];
    const moves = sharedPlaylistMoves(entries, ["a", "b", "c", "d"]);
    assert.deepEqual(moves, [{ entryId: "place-a", before: "place-b" }]);
  });

  test("moves a song to the end with no entry after it", () => {
    const moves = sharedPlaylistMoves([entry("a"), entry("b"), entry("c")], ["b", "c", "a"]);
    assert.deepEqual(moves, [{ entryId: "place-a", before: null }]);
  });

  test("puts a reversed playlist in order", () => {
    const entries = ["e", "d", "c", "b", "a"].map((id) => entry(id));
    const wanted = ["a", "b", "c", "d", "e"];
    const moves = sharedPlaylistMoves(entries, wanted);
    assert.deepEqual(applyMoves(entries, moves), wanted);
    assert.equal(moves.length, 4);
  });

  test("puts shuffled playlists in order", () => {
    const wanted = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const shuffles = [
      ["h", "a", "c", "b", "e", "d", "g", "f"],
      ["b", "d", "f", "h", "a", "c", "e", "g"],
      ["c", "a", "b", "f", "d", "e", "h", "g"],
    ];
    for (const shuffle of shuffles) {
      const entries = shuffle.map((id) => entry(id));
      assert.deepEqual(applyMoves(entries, sharedPlaylistMoves(entries, wanted)), wanted);
    }
  });
});

describe("sharedEditBatches", () => {
  test("sends edits a hundred at a time, in order", () => {
    const edits = Array.from({ length: 250 }, (_, index) => index);
    const batches = sharedEditBatches(edits);
    assert.deepEqual(
      batches.map((batch) => batch.length),
      [100, 100, 50],
    );
    assert.equal(batches[2]?.[0], 200);
    assert.deepEqual(sharedEditBatches([]), []);
  });
});

describe("playlistShareServices", () => {
  test("offers Spotify always, and YT Music before it while YT Music is on", () => {
    assert.deepEqual(playlistShareServices({ ytMusic: true }), ["ytMusic", "spotify"]);
    assert.deepEqual(playlistShareServices({ ytMusic: false }), ["spotify"]);
    assert.equal(PLAYLIST_SHARE_LABELS.ytMusic, "YT Music");
    assert.equal(PLAYLIST_SHARE_LABELS.spotify, "Spotify");
  });

  test("asks to sign in before sharing signed out", () => {
    assert.deepEqual(shareSignInAlert("ytMusic"), {
      title: "Sign In to YT Music",
      message:
        "Sharing a playlist makes an unlisted copy of it on your YouTube Music account, with a link anyone can open.",
      action: { label: "Sign In" },
    });
    assert.deepEqual(shareSignInAlert("spotify"), {
      title: "Sign In to Spotify",
      message:
        "Sharing a playlist makes a public copy of it on your Spotify account, with a link anyone can open.",
      action: { label: "Sign In" },
    });
  });

  test("links to a YT Music playlist by its id", () => {
    assert.equal(ytMusicPlaylistUrl("PLabc"), "https://music.youtube.com/playlist?list=PLabc");
  });

  test("links to a Spotify playlist by its URI", () => {
    assert.equal(
      spotifyPlaylistUrl("spotify:playlist:37i9dQZF1DXcBWIGoYBM5M"),
      "https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M",
    );
  });
});
