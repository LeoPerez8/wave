import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { routedSystemPath } from "./systemPath.ts";

describe("which path expo-router takes from a link Android hands Wave", () => {
  const link = "https://music.youtube.com/watch?v=dQw4w9WgXcQ&si=abc";

  test("a song link that opened Wave starts it at its root, the inbox playing the song", () => {
    assert.equal(routedSystemPath({ path: link, initial: true }), "/");
    assert.equal(routedSystemPath({ path: "HTTP://open.spotify.com/track/x", initial: true }), "/");
  });

  test("a song link reaching a Wave already open leaves the screen where it is", () => {
    assert.equal(routedSystemPath({ path: link, initial: false }), null);
  });

  test("Wave's own links route as before", () => {
    for (const initial of [true, false]) {
      assert.equal(
        routedSystemPath({ path: "wave://settings/library", initial }),
        "wave://settings/library",
      );
      assert.equal(routedSystemPath({ path: "/settings", initial }), "/settings");
    }
  });
});
