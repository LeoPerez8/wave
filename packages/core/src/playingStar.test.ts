import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { playingStarSubject } from "./index.ts";

describe("whose stars Now Playing's favorite star follows", () => {
  test("a Library song not read yet is followed by its own track, so its star shows on the first frame", () => {
    assert.deepEqual(playingStarSubject("7", undefined), {
      track: 7,
      video: null,
      saved: { favorite: false, pendingFavorite: false },
    });
  });

  test("a YT Music song not read yet is followed by its video, for its pending favorite", () => {
    assert.deepEqual(playingStarSubject("yt:one", undefined), {
      track: null,
      video: "one",
      saved: { favorite: false, pendingFavorite: false },
    });
  });

  test("once read, a YT Music song is also followed by the Library song it is by now", () => {
    const answer = { track: { id: 12 }, favorite: true, pendingFavorite: false };
    assert.deepEqual(playingStarSubject("yt:one", answer), {
      track: 12,
      video: "one",
      saved: { favorite: true, pendingFavorite: false },
    });
  });

  test("a Library song read as gone from the Library has no track to follow", () => {
    const answer = { track: null, favorite: false, pendingFavorite: false };
    assert.deepEqual(playingStarSubject("7", answer), {
      track: null,
      video: null,
      saved: { favorite: false, pendingFavorite: false },
    });
  });

  test("with nothing playing there is nothing to follow", () => {
    assert.deepEqual(playingStarSubject(null, undefined), {
      track: null,
      video: null,
      saved: { favorite: false, pendingFavorite: false },
    });
  });
});
