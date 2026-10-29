import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  NOW_PLAYING_ACTIONS,
  editNowPlayingButtons,
  nowPlayingSlotShow,
  readNowPlayingButtons,
  storedNowPlayingButtons,
} from "./index.ts";

describe("the saved Now Playing buttons", () => {
  test("with nothing stored, the slots hold today's row: Lyrics, Sleep timer, Add to Playlist, Download", () => {
    assert.deepEqual(readNowPlayingButtons(null), [
      "lyrics",
      "sleepTimer",
      "addToPlaylist",
      "download",
    ]);
  });

  test("a saved row comes back as saved, None slots included", () => {
    assert.deepEqual(
      readNowPlayingButtons(storedNowPlayingButtons(["shuffle", null, "repeat", null])),
      ["shuffle", null, "repeat", null],
    );
    assert.deepEqual(readNowPlayingButtons(storedNowPlayingButtons([null, null, null, null])), [
      null,
      null,
      null,
      null,
    ]);
  });

  test("today's row is stored as nothing, so a reset row reads as the defaults of any later Wave", () => {
    assert.equal(
      storedNowPlayingButtons(["lyrics", "sleepTimer", "addToPlaylist", "download"]),
      null,
    );
  });

  test("a stored value that isn't four known slots falls back to today's row", () => {
    const today = ["lyrics", "sleepTimer", "addToPlaylist", "download"];
    for (const stored of [
      "",
      "not json",
      "{}",
      "null",
      '"shuffle"',
      '["shuffle","repeat","share"]',
      '["shuffle","repeat","share","songMenu","lyrics"]',
      '["shuffle","repeat","karaoke","songMenu"]',
      '["shuffle",1,"share","songMenu"]',
      '["shuffle","shuffle","share","songMenu"]',
    ]) {
      assert.deepEqual(readNowPlayingButtons(stored), today, stored);
    }
  });
});

describe("setting the Now Playing buttons", () => {
  const today = ["lyrics", "sleepTimer", "addToPlaylist", "download"] as const;

  test("a slot set to an action no other slot holds takes it, the rest unchanged", () => {
    assert.deepEqual(editNowPlayingButtons(today, { slot: 1, action: "shuffle" }), [
      "lyrics",
      "shuffle",
      "addToPlaylist",
      "download",
    ]);
  });

  test("a slot set to an action another slot holds swaps the two, so none shows twice", () => {
    assert.deepEqual(editNowPlayingButtons(today, { slot: 0, action: "download" }), [
      "download",
      "sleepTimer",
      "addToPlaylist",
      "lyrics",
    ]);
  });

  test("an action taken from a None slot's neighbour leaves None where it was", () => {
    assert.deepEqual(
      editNowPlayingButtons([null, "repeat", "share", null], { slot: 0, action: "share" }),
      ["share", "repeat", null, null],
    );
  });

  test("a slot set to the action it holds stays as it is", () => {
    assert.deepEqual(editNowPlayingButtons(today, { slot: 2, action: "addToPlaylist" }), today);
  });

  test("a slot set to None loses its button, and several slots can be None", () => {
    const one = editNowPlayingButtons(today, { slot: 1, action: null });
    assert.deepEqual(one, ["lyrics", null, "addToPlaylist", "download"]);
    assert.deepEqual(editNowPlayingButtons(one, { slot: 3, action: null }), [
      "lyrics",
      null,
      "addToPlaylist",
      null,
    ]);
  });

  test("Reset to Default brings back today's row", () => {
    assert.deepEqual(editNowPlayingButtons(["share", null, "repeat", "shuffle"], "reset"), today);
  });
});

describe("how a Now Playing slot shows", () => {
  test("with a song on, every action's button shows and runs", () => {
    for (const action of NOW_PLAYING_ACTIONS)
      assert.equal(nowPlayingSlotShow(action, "song"), "on");
  });

  test("with nothing playing, the slots that need a song stay empty and the others show", () => {
    const shown = NOW_PLAYING_ACTIONS.filter(
      (action) => nowPlayingSlotShow(action, "nothing") !== "hidden",
    );
    assert.deepEqual(shown, ["lyrics", "sleepTimer", "shuffle", "repeat"]);
    assert.equal(nowPlayingSlotShow("lyrics", "nothing"), "on");
  });

  test("while an unsearched entry's search runs, Song menu shows off and the rest run", () => {
    assert.equal(nowPlayingSlotShow("songMenu", "unsearched"), "off");
    for (const action of NOW_PLAYING_ACTIONS.filter((other) => other !== "songMenu"))
      assert.equal(nowPlayingSlotShow(action, "unsearched"), "on");
  });
});
