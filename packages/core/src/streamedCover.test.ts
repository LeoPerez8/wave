import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { streamedCoverUrl, streamedCoverUrls } from "./index.ts";

describe("a streamed song's cover for playback", () => {
  test("a YT Music cover is asked for at the size downloads embed", () => {
    assert.deepEqual(streamedCoverUrls("https://lh3.googleusercontent.com/abc=w120-h120-l90-rj"), [
      "https://lh3.googleusercontent.com/abc=w1200-h1200-l90-rj",
    ]);
    assert.equal(
      streamedCoverUrl("https://lh3.googleusercontent.com/abc=w120-h120-l90-rj"),
      "https://lh3.googleusercontent.com/abc=w1200-h1200-l90-rj",
    );
  });

  test("a video thumbnail is asked for at the largest the video offers, down to the one every video has", () => {
    const thumbnail =
      "https://i.ytimg.com/vi/0fllyJTBsRU/hqdefault.jpg?sqp=-oaymwEWCJADEOEBIAQqCggAEOADGC0guwJIWg&rs=AMzJL3n9";
    assert.deepEqual(streamedCoverUrls(thumbnail), [
      "https://i.ytimg.com/vi/0fllyJTBsRU/maxresdefault.jpg",
      "https://i.ytimg.com/vi/0fllyJTBsRU/sddefault.jpg",
      "https://i.ytimg.com/vi/0fllyJTBsRU/hqdefault.jpg",
    ]);
    assert.equal(streamedCoverUrl(thumbnail), "https://i.ytimg.com/vi/0fllyJTBsRU/hqdefault.jpg");
    assert.deepEqual(streamedCoverUrls("https://i.ytimg.com/vi_webp/a-b_c/hq720.webp"), [
      "https://i.ytimg.com/vi/a-b_c/maxresdefault.jpg",
      "https://i.ytimg.com/vi/a-b_c/sddefault.jpg",
      "https://i.ytimg.com/vi/a-b_c/hqdefault.jpg",
    ]);
  });

  test("a cover sized by its side is asked for at the large size", () => {
    assert.deepEqual(streamedCoverUrls("https://yt3.ggpht.com/abc=s120-c-k"), [
      "https://yt3.ggpht.com/abc=s1200-c-k",
    ]);
  });

  test("any other cover stays as it is", () => {
    const spotify = "https://i.scdn.co/image/ab67616d00001e02";
    assert.deepEqual(streamedCoverUrls(spotify), [spotify]);
    assert.equal(streamedCoverUrl(spotify), spotify);
  });
});
