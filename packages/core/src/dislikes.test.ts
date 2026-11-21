import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  dislikeKey,
  dislikeKeys,
  dislikedSongs,
  dislikesToForget,
  dislikeSongs,
  dislikeToast,
  favoriteSongs,
  isDisliked,
  NO_DISLIKES,
  noMarkChanges,
  withoutDisliked,
} from "./index.ts";

const song = (name: string, favorite: boolean, disliked: boolean) => ({
  song: name,
  favorite,
  disliked,
});

describe("disliking songs", () => {
  test("a disliked favorite leaves Favorites", () => {
    const { changes } = dislikeSongs([song("a", true, false), song("b", false, false)], true);
    assert.deepEqual(changes.dislike, ["a", "b"]);
    assert.deepEqual(changes.unfavorite, ["a"]);
    assert.deepEqual(changes.favorite, []);
    assert.deepEqual(changes.removeDislike, []);
  });

  test("Undo restores what was there before, the favorite included", () => {
    const { undo } = dislikeSongs(
      [song("starred", true, false), song("plain", false, false), song("already", false, true)],
      true,
    );
    assert.deepEqual(undo.favorite, ["starred"]);
    assert.deepEqual(undo.removeDislike, ["starred", "plain"]);
    assert.deepEqual(undo.dislike, []);
    assert.deepEqual(undo.unfavorite, []);
  });

  test("a song already disliked is written nothing", () => {
    const { changes, undo } = dislikeSongs([song("already", false, true)], true);
    assert.equal(noMarkChanges(changes), true);
    assert.equal(noMarkChanges(undo), true);
  });

  test("removing a dislike leaves the star alone, and Undo dislikes it again", () => {
    const { changes, undo } = dislikeSongs([song("a", false, true), song("b", true, false)], false);
    assert.deepEqual(changes.removeDislike, ["a"]);
    assert.deepEqual(changes.unfavorite, []);
    assert.deepEqual(changes.favorite, []);
    assert.deepEqual(undo.dislike, ["a"]);
  });
});

describe("favoriting songs", () => {
  test("a favorited disliked song loses its dislike", () => {
    const { changes } = favoriteSongs([song("a", false, true), song("b", false, false)], true);
    assert.deepEqual(changes.favorite, ["a", "b"]);
    assert.deepEqual(changes.removeDislike, ["a"]);
    assert.deepEqual(changes.dislike, []);
  });

  test("unstarring leaves a dislike alone", () => {
    const { changes } = favoriteSongs([song("a", true, false), song("b", false, true)], false);
    assert.deepEqual(changes.unfavorite, ["a"]);
    assert.deepEqual(changes.removeDislike, []);
  });
});

describe("the songs Wave picks on its own", () => {
  const disliked = new Set(["7", "yt:abc"]);

  test("a song is kept by its video, and by its Track id only when it has none", () => {
    assert.equal(dislikeKey({ id: 7 }), "7");
    assert.equal(dislikeKey({ videoId: "abc" }), "yt:abc");
    assert.equal(dislikeKey({ id: 7, videoId: "abc" }), "yt:abc");
    assert.equal(dislikeKey({ id: null, videoId: null }), null);
    assert.deepEqual(dislikeKeys({ id: 7, videoId: "abc" }), ["yt:abc", "7"]);
  });

  test("a song is disliked under either identity it has", () => {
    assert.equal(isDisliked(disliked, { id: 7 }), true);
    assert.equal(isDisliked(disliked, { id: "7" }), true);
    assert.equal(isDisliked(disliked, { videoId: "abc" }), true);
    assert.equal(isDisliked(disliked, { id: 8, videoId: "abc" }), true);
    assert.equal(isDisliked(disliked, { id: 8, videoId: "xyz" }), false);
    assert.equal(isDisliked(disliked, {}), false);
  });

  test("a pool loses its disliked songs and keeps its order", () => {
    const pool = [
      { name: "kept", id: 1 },
      { name: "library", id: 7 },
      { name: "stream", videoId: "abc" },
      { name: "last", videoId: "def" },
    ];
    assert.deepEqual(
      withoutDisliked(pool, disliked, (entry) => entry).map((entry) => entry.name),
      ["kept", "last"],
    );
    assert.deepEqual(
      withoutDisliked(pool, NO_DISLIKES, (entry) => entry),
      pool,
    );
  });
});

describe("a song that moves between the Library and YT Music", () => {
  const lucky = { id: 42, videoId: "abc" };

  test("disliked while streamed, it is disliked as the Library's song once downloaded", () => {
    const disliked = dislikedSongs(["yt:abc"], [lucky]);
    assert.equal(isDisliked(disliked, { id: 42 }), true);
    assert.equal(disliked.has("42"), true);
    assert.equal(isDisliked(disliked, { videoId: "abc" }), true);
    assert.equal(isDisliked(disliked, { id: 43 }), false);
  });

  test("disliked as the Library's song, it stays disliked once deleted from the Library", () => {
    // Kept by its video, so the dislike doesn't go with the Track.
    const kept = [dislikeKey(lucky)!];
    assert.equal(isDisliked(dislikedSongs(kept, []), { videoId: "abc" }), true);
  });

  test("a dislike another device kept by the Track reaches the song's video too", () => {
    const disliked = dislikedSongs(["42"], [lucky]);
    assert.equal(isDisliked(disliked, { videoId: "abc" }), true);
  });

  test("two Library songs of one video are one disliked song", () => {
    const disliked = dislikedSongs(["42"], [lucky, { id: 43, videoId: "abc" }]);
    assert.deepEqual([...disliked].sort(), ["42", "43", "yt:abc"]);
  });

  test("songs no dislike is about stay out, and a song without a video adds nothing", () => {
    const disliked = dislikedSongs(["yt:abc", "7"], [{ id: 8, videoId: "xyz" }, { id: 7 }]);
    assert.deepEqual([...disliked].sort(), ["7", "yt:abc"]);
    assert.equal(dislikedSongs([], [lucky]).size, 0);
  });

  test("removing a dislike forgets every key the song has", () => {
    assert.deepEqual(dislikesToForget(["42"], [lucky]).sort(), ["42", "yt:abc"]);
    assert.deepEqual(dislikesToForget(["yt:abc"], [lucky]).sort(), ["42", "yt:abc"]);
    assert.deepEqual(dislikesToForget(["yt:def", "9"], [lucky]).sort(), ["9", "yt:def"]);
    assert.deepEqual(dislikesToForget([], [lucky]), []);
  });

  test("a second dislike of it is no second song: the first key answers for both", () => {
    const disliked = dislikedSongs(["yt:abc"], [lucky]);
    const { changes } = dislikeSongs(
      [{ song: lucky, favorite: false, disliked: isDisliked(disliked, lucky) }],
      true,
    );
    assert.equal(noMarkChanges(changes), true);
  });
});

describe("dislikeToast", () => {
  test("a dislike is confirmed in both languages", () => {
    assert.equal(dislikeToast(true, 1), "Song disliked");
    assert.equal(dislikeToast(true, 3), "3 songs disliked");
    assert.equal(dislikeToast(true, 1, "pt-BR"), "Marcada como não gostei");
    assert.equal(dislikeToast(true, 3, "pt-BR"), "3 músicas marcadas como não gostei");
  });

  test("removing a dislike has no toast", () => {
    assert.equal(dislikeToast(false, 1), null);
    assert.equal(dislikeToast(true, 0), null);
  });
});
