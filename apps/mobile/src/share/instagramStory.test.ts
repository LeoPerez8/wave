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

test("lyrics deliver separate rounded sticker and gradient background images", async () => {
  const frame = lyricStoryFrame(["Face to face"]);
  const background = lyricStoryBackground("#dc2828");
  const calls: unknown[] = [];
  const native: InstagramStoryNative = {
    writeStoryImages: async (...args) => {
      calls.push(args);
      return {
        sticker: "/cache/shared-images/sticker.png",
        background: "/cache/shared-images/background.png",
      };
    },
    shareStoryImages: async (...args) => {
      calls.push(args);
    },
    shareToInstagramStory: async () => {
      throw new Error("Lyrics must send a background image instead of colour extras");
    },
  };

  await deliverInstagramStory(native, "/cache/shared-images/card.png", background, "1234", frame);

  assert.deepEqual(calls, [
    ["/cache/shared-images/card.png", frame, background],
    ["/cache/shared-images/sticker.png", "/cache/shared-images/background.png", "1234"],
  ]);
  assert.notEqual(background.top, background.bottom);
});

test("song and Recap shares keep their existing image and background without lyrics framing", async () => {
  const sent: unknown[] = [];
  const native: InstagramStoryNative = {
    writeStoryImages: async () => {
      throw new Error("Must not frame a song or Recap");
    },
    shareStoryImages: async () => {
      throw new Error("Must not change a song or Recap's delivery");
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
    ["song.png", { top: "#123456", bottom: "#345678" }, "1234"],
    ["recap.png", { top: "#345678", bottom: "#345678" }, "1234"],
  ]);
});

test("a failed native Story export never sends the original unframed card", async () => {
  let sent = false;
  const native: InstagramStoryNative = {
    writeStoryImages: async () => {
      throw new Error("PNG write failed");
    },
    shareStoryImages: async () => {
      sent = true;
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
