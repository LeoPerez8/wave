import assert from "node:assert/strict";
import { test } from "node:test";
import { readYtPlaylistGuarded } from "./playlistRead.ts";

test("a full artist playlist checks consent and validated connectivity before every native page", async () => {
  let connected = false;
  const calls: string[] = [];
  const first = async () => {
    calls.push("first");
    connected = false;
    return {
      title: "Artist songs",
      author: null,
      artworkUrl: null,
      songs: [
        {
          videoId: "one",
          title: "One",
          artists: ["Justice"],
          album: null,
          durationMs: 180000,
          artworkUrl: null,
          explicit: false,
        },
      ],
      continuation: "next",
    };
  };
  const more = async () => {
    calls.push("more");
    return { songs: [], continuation: null };
  };
  const options = { canSend: () => connected };
  await assert.rejects(readYtPlaylistGuarded(first, more, options), { code: "ERR_YT_OFFLINE" });
  assert.deepEqual(calls, []);
  connected = true;
  await assert.rejects(readYtPlaylistGuarded(first, more, options), { code: "ERR_YT_OFFLINE" });
  assert.deepEqual(calls, ["first"], "no continuation after connectivity or consent is lost");
});
