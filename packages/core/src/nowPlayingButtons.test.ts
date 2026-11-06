import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  NOW_PLAYING_ACTIONS,
  NOW_PLAYING_BUTTONS_KEY,
  editNowPlayingButtons,
  nowPlayingSlotShow,
  readNowPlayingButtons,
  readNowPlayingSlotRoute,
  storedNowPlayingButtons,
} from "./index.ts";

describe("the saved Now Playing buttons", () => {
  test("with nothing stored, the slots hold the default row: Lyrics, Add to Playlist, Download, Song menu", () => {
    assert.deepEqual(readNowPlayingButtons(null), [
      "lyrics",
      "addToPlaylist",
      "download",
      "songMenu",
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

  test("the default row is stored as nothing, so a reset row reads as the defaults of any later Wave", () => {
    assert.equal(
      storedNowPlayingButtons(["lyrics", "addToPlaylist", "download", "songMenu"]),
      null,
    );
  });

  test("the row from before, with Sleep timer, is an edit like any other and is stored", () => {
    const before = ["lyrics", "sleepTimer", "addToPlaylist", "download"] as const;
    assert.deepEqual(readNowPlayingButtons(storedNowPlayingButtons(before)), before);
  });

  test("a stored value that isn't four known slots falls back to the default row", () => {
    const defaultRow = ["lyrics", "addToPlaylist", "download", "songMenu"];
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
      assert.deepEqual(readNowPlayingButtons(stored), defaultRow, stored);
    }
  });
});

describe("where the Now Playing buttons are stored", () => {
  test("under a key of their own, never the one rows were kept under before the default changed", () => {
    // Every phone moves to the new default once: a row stored under the old key is never read.
    assert.notEqual(NOW_PLAYING_BUTTONS_KEY, "settings.nowPlayingButtons");
    // Renaming it again would reset every edited row, so it stays as it is.
    assert.equal(NOW_PLAYING_BUTTONS_KEY, "settings.nowPlayingRow");
  });
});

describe("setting the Now Playing buttons", () => {
  const row = ["lyrics", "sleepTimer", "addToPlaylist", "download"] as const;

  test("a slot set to an action no other slot holds takes it, the rest unchanged", () => {
    assert.deepEqual(editNowPlayingButtons(row, { slot: 1, action: "shuffle" }), [
      "lyrics",
      "shuffle",
      "addToPlaylist",
      "download",
    ]);
  });

  test("a slot set to an action another slot holds swaps the two, so none shows twice", () => {
    assert.deepEqual(editNowPlayingButtons(row, { slot: 0, action: "download" }), [
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
    assert.deepEqual(editNowPlayingButtons(row, { slot: 2, action: "addToPlaylist" }), row);
  });

  test("a slot set to None loses its button, and several slots can be None", () => {
    const one = editNowPlayingButtons(row, { slot: 1, action: null });
    assert.deepEqual(one, ["lyrics", null, "addToPlaylist", "download"]);
    assert.deepEqual(editNowPlayingButtons(one, { slot: 3, action: null }), [
      "lyrics",
      null,
      "addToPlaylist",
      null,
    ]);
  });

  test("Reset to Default brings back the default row: Lyrics, Add to Playlist, Download, Song menu", () => {
    assert.deepEqual(editNowPlayingButtons(["share", null, "repeat", "shuffle"], "reset"), [
      "lyrics",
      "addToPlaylist",
      "download",
      "songMenu",
    ]);
    assert.deepEqual(editNowPlayingButtons(row, "reset"), [
      "lyrics",
      "addToPlaylist",
      "download",
      "songMenu",
    ]);
  });

  test("a reset row stores as nothing, which is what turns Reset to Default off", () => {
    assert.equal(storedNowPlayingButtons(editNowPlayingButtons(row, "reset")), null);
    assert.notEqual(storedNowPlayingButtons(row), null);
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

describe("a slot picker's route", () => {
  test("slots 1 to 4 are slots 0 to 3, left to right", () => {
    assert.deepEqual(["1", "2", "3", "4"].map(readNowPlayingSlotRoute), [0, 1, 2, 3]);
  });

  test("anything else names no slot", () => {
    for (const param of ["0", "5", "01", " 1", "1.0", "one", "", undefined, ["1"], ["1", "2"]])
      assert.equal(readNowPlayingSlotRoute(param), null, String(param));
  });
});
