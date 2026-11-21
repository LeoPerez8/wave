import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { dislikeSkipsPlaying } from "./index.ts";

describe("whether a dislike skips the song playing", () => {
  test("disliking the Library song that plays skips it", () => {
    assert.equal(dislikeSkipsPlaying("12", [{ id: 12 }]), true);
  });

  test("disliking the YT Music song that plays skips it", () => {
    assert.equal(dislikeSkipsPlaying("yt:abc", [{ videoId: "abc" }]), true);
  });

  test("a streamed song disliked as the Library song it is by now is still the one playing", () => {
    assert.equal(dislikeSkipsPlaying("yt:abc", [{ id: 12, videoId: "abc" }]), true);
    assert.equal(dislikeSkipsPlaying("12", [{ id: 12, videoId: "abc" }]), true);
  });

  test("disliking other songs leaves the one playing on", () => {
    assert.equal(dislikeSkipsPlaying("12", [{ id: 13 }, { videoId: "12" }]), false);
    assert.equal(dislikeSkipsPlaying("yt:abc", [{ videoId: "abd" }, { id: 7 }]), false);
  });

  test("the song playing among several disliked together is skipped", () => {
    assert.equal(dislikeSkipsPlaying("yt:abc", [{ id: 3 }, { videoId: "abc" }]), true);
  });

  test("with nothing playing, or nothing disliked, there is nothing to skip", () => {
    assert.equal(dislikeSkipsPlaying(null, [{ id: 12 }]), false);
    assert.equal(dislikeSkipsPlaying("12", []), false);
  });
});
