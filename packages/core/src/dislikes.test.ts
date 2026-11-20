import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  dislikeKey,
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

  test("a Library song is kept by its Track id, a YT Music song by its video", () => {
    assert.equal(dislikeKey({ id: 7 }), "7");
    assert.equal(dislikeKey({ videoId: "abc" }), "yt:abc");
    assert.equal(dislikeKey({ id: 7, videoId: "abc" }), "7");
    assert.equal(dislikeKey({ id: null, videoId: null }), null);
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
