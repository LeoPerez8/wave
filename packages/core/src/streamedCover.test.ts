import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { sizedCoverUrls, streamedCoverUrl, streamedCoverUrls } from "./index.ts";

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

describe("a stored cover at the size on screen", () => {
  test("YouTube Music's image server is asked for the size, with the stored cover last", () => {
    assert.deepEqual(
      sizedCoverUrls("https://lh3.googleusercontent.com/abc=w120-h120-l90-rj", 900),
      [
        "https://lh3.googleusercontent.com/abc=w900-h900-l90-rj",
        "https://lh3.googleusercontent.com/abc=w120-h120-l90-rj",
      ],
    );
    assert.deepEqual(sizedCoverUrls("https://yt3.ggpht.com/abc=s120-c-k", 240), [
      "https://yt3.ggpht.com/abc=s240-c-k",
      "https://yt3.ggpht.com/abc=s120-c-k",
    ]);
  });

  test("a stored cover as large as the screen needs asks for nothing more", () => {
    const cover = "https://lh3.googleusercontent.com/abc=w120-h120-l90-rj";
    assert.deepEqual(sizedCoverUrls(cover, 120), [cover]);
    assert.deepEqual(sizedCoverUrls(cover, 90), [cover]);
    assert.deepEqual(sizedCoverUrls("https://yt3.ggpht.com/abc=s544", 300), [
      "https://yt3.ggpht.com/abc=s544",
    ]);
  });

  test("no screen asks for more than a download embeds, nor for a fraction of a pixel", () => {
    assert.equal(
      sizedCoverUrls("https://lh3.googleusercontent.com/abc=w120-h120", 2160)[0],
      "https://lh3.googleusercontent.com/abc=w1200-h1200",
    );
    assert.equal(
      sizedCoverUrls("https://lh3.googleusercontent.com/abc=w120-h120", 300.5)[0],
      "https://lh3.googleusercontent.com/abc=w301-h301",
    );
  });

  test("anything else stays as it is", () => {
    for (const url of [
      "https://example.com/cover=w120-h120",
      "https://example.com/cover.jpg",
      "/data/user/0/dev.leoperez.wave/files/artwork/a=s120.jpg",
    ]) {
      assert.deepEqual(sizedCoverUrls(url, 900), [url]);
    }
  });

  test("a video thumbnail is asked for from the smallest that covers the size down to the one every video has", () => {
    const thumbnail = "https://i.ytimg.com/vi/a-b_c/hqdefault.jpg?sqp=abc&rs=def";
    const large = "https://i.ytimg.com/vi/a-b_c/maxresdefault.jpg";
    const standard = "https://i.ytimg.com/vi/a-b_c/sddefault.jpg";
    const high = "https://i.ytimg.com/vi/a-b_c/hqdefault.jpg";
    assert.deepEqual(sizedCoverUrls(thumbnail, 1080), [large, standard, high, thumbnail]);
    assert.deepEqual(sizedCoverUrls(thumbnail, 720), [large, standard, high, thumbnail]);
    assert.deepEqual(sizedCoverUrls(thumbnail, 480), [standard, high, thumbnail]);
    assert.deepEqual(sizedCoverUrls(thumbnail, 360), [high, thumbnail]);
  });

  test("a list row keeps the video thumbnail it has", () => {
    const thumbnail = "https://i.ytimg.com/vi/a-b_c/hqdefault.jpg?sqp=abc&rs=def";
    assert.deepEqual(sizedCoverUrls(thumbnail, 120), [thumbnail]);
    assert.deepEqual(sizedCoverUrls(thumbnail, 180), [thumbnail]);
  });

  test("a stored 300 px Spotify album cover is asked for at 640 px when the screen needs more", () => {
    const stored = "https://i.scdn.co/image/ab67616d00001e0224cd1f5c32aa1f9ce1d1d0b0";
    assert.deepEqual(sizedCoverUrls(stored, 900), [
      "https://i.scdn.co/image/ab67616d0000b27324cd1f5c32aa1f9ce1d1d0b0",
      stored,
    ]);
    assert.deepEqual(sizedCoverUrls(stored, 301), [
      "https://i.scdn.co/image/ab67616d0000b27324cd1f5c32aa1f9ce1d1d0b0",
      stored,
    ]);
    assert.deepEqual(sizedCoverUrls(stored, 300), [stored]);
  });

  test("other Spotify images stay as they are", () => {
    for (const url of [
      "https://i.scdn.co/image/ab67616d0000485124cd1f5c32aa1f9ce1d1d0b0",
      "https://i.scdn.co/image/ab67616d0000b27324cd1f5c32aa1f9ce1d1d0b0",
      "https://i.scdn.co/image/ab6761610000e5eb24cd1f5c32aa1f9ce1d1d0b0",
      "https://image-cdn-ak.spotifycdn.com/image/ab67616d00001e0224cd1f5c32aa1f9ce1d1d0b0",
    ]) {
      assert.deepEqual(sizedCoverUrls(url, 900), [url]);
    }
  });
});
