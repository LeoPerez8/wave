/// <reference types="node" />
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  lyricStoryBackground,
  lyricStoryFrame,
  recapStoryBackground,
  songCardColours,
} from "@wave/core";

import { deliverInstagramStory, type InstagramStoryNative } from "./instagramStory.ts";

test("lyrics deliver the native padded rounded sticker and selected colour's gradient", async () => {
  const frame = lyricStoryFrame(["Face to face"]);
  const background = lyricStoryBackground("#dc2828");
  const calls: unknown[] = [];
  const native: InstagramStoryNative = {
    writeStorySticker: async (...args) => {
      calls.push(args);
      return "/cache/shared-images/story.png";
    },
    shareToInstagramStory: async (...args) => {
      calls.push(args);
    },
  };

  await deliverInstagramStory(native, "/cache/shared-images/card.png", background, "1234", frame);

  assert.deepEqual(calls, [
    ["/cache/shared-images/card.png", frame],
    ["/cache/shared-images/story.png", background.top, background.bottom, "1234"],
  ]);
  assert.notEqual(background.top, background.bottom);
});

test("song and Recap shares keep their existing image and background without lyrics framing", async () => {
  const sent: unknown[] = [];
  const native: InstagramStoryNative = {
    writeStorySticker: async () => {
      throw new Error("Must not frame a song or Recap");
    },
    shareToInstagramStory: async (...args) => {
      sent.push(args);
    },
  };
  await deliverInstagramStory(
    native,
    "song.png",
    songCardColours({ dominant: "#123456", darkMuted: "#345678" }).story,
    "1234",
  );
  await deliverInstagramStory(native, "recap.png", recapStoryBackground("#345678"), "1234");
  assert.deepEqual(sent, [
    ["song.png", "#123456", "#345678", "1234"],
    ["recap.png", "#345678", "#345678", "1234"],
  ]);
});

test("a failed native sticker export never sends the original unframed card", async () => {
  let sent = false;
  const native: InstagramStoryNative = {
    writeStorySticker: async () => {
      throw new Error("PNG write failed");
    },
    shareToInstagramStory: async () => {
      sent = true;
    },
  };
  await assert.rejects(
    deliverInstagramStory(
      native,
      "card.png",
      lyricStoryBackground("#1c2628"),
      "1234",
      lyricStoryFrame(["Words"]),
    ),
    /PNG write failed/,
  );
  assert.equal(sent, false);
});
