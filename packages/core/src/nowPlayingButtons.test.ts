import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  NOW_PLAYING_ACTIONS,
  NOW_PLAYING_BUTTONS_KEY,
  editNowPlayingButtons,
  nowPlayingRelatedChevronShown,
  nowPlayingSlotChoices,
  nowPlayingSlotShow,
  nowPlayingSongMenuShow,
  readNowPlayingButtons,
  readNowPlayingSlotRoute,
  storedNowPlayingButtons,
} from "./index.ts";

describe("the saved Now Playing buttons", () => {
  test("with nothing stored, the slots hold the default row: Lyrics, Add to Playlist, Download, Shuffle", () => {
    assert.deepEqual(readNowPlayingButtons(null), [
      "lyrics",
      "addToPlaylist",
      "download",
      "shuffle",
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
    assert.equal(storedNowPlayingButtons(["lyrics", "addToPlaylist", "download", "shuffle"]), null);
  });

  test("the row from before, with Sleep timer, is an edit like any other and is stored", () => {
    const before = ["lyrics", "sleepTimer", "addToPlaylist", "download"] as const;
    assert.deepEqual(readNowPlayingButtons(storedNowPlayingButtons(before)), before);
  });

  test("a stored value that isn't four known slots falls back to the default row", () => {
    const defaultRow = ["lyrics", "addToPlaylist", "download", "shuffle"];
    for (const stored of [
      "",
      "not json",
      "{}",
      "null",
      '"shuffle"',
      '["shuffle","repeat","share"]',
      '["shuffle","repeat","share","sleepTimer","lyrics"]',
      '["shuffle","repeat","karaoke","sleepTimer"]',
      '["shuffle",1,"share","sleepTimer"]',
      '["shuffle","shuffle","share","sleepTimer"]',
    ]) {
      assert.deepEqual(readNowPlayingButtons(stored), defaultRow, stored);
    }
  });

  test("a slot stored holding Related or Song menu, which have fixed places now, reads as empty", () => {
    assert.deepEqual(readNowPlayingButtons('["related","sleepTimer",null,"download"]'), [
      null,
      "sleepTimer",
      null,
      "download",
    ]);
    assert.deepEqual(readNowPlayingButtons('["lyrics","sleepTimer","share","songMenu"]'), [
      "lyrics",
      "sleepTimer",
      "share",
      null,
    ]);
    assert.deepEqual(readNowPlayingButtons('["songMenu","repeat","related","shuffle"]'), [
      null,
      "repeat",
      null,
      "shuffle",
    ]);
  });

  test("the default row from before, stored by a phone on an older Wave, keeps its other three slots", () => {
    assert.deepEqual(readNowPlayingButtons('["lyrics","addToPlaylist","download","songMenu"]'), [
      "lyrics",
      "addToPlaylist",
      "download",
      null,
    ]);
  });

  test("a row read without its Related and Song menu is stored without them", () => {
    const read = readNowPlayingButtons('["related","sleepTimer","songMenu","download"]');
    assert.equal(storedNowPlayingButtons(read), '[null,"sleepTimer",null,"download"]');
  });
});

describe("the choices a Now Playing slot offers", () => {
  test("every action a slot can hold, without Related or Song menu, which have fixed places", () => {
    const choices = [
      "lyrics",
      "sleepTimer",
      "addToPlaylist",
      "download",
      "shuffle",
      "repeat",
      "share",
    ];
    assert.deepEqual(nowPlayingSlotChoices(), choices);
    assert.deepEqual(NOW_PLAYING_ACTIONS, choices);
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

  test("Reset to Default brings back the default row: Lyrics, Add to Playlist, Download, Shuffle", () => {
    assert.deepEqual(editNowPlayingButtons(["share", null, "repeat", "sleepTimer"], "reset"), [
      "lyrics",
      "addToPlaylist",
      "download",
      "shuffle",
    ]);
    assert.deepEqual(editNowPlayingButtons(row, "reset"), [
      "lyrics",
      "addToPlaylist",
      "download",
      "shuffle",
    ]);
  });

  test("a reset row stores as nothing, which is what turns Reset to Default off", () => {
    assert.equal(storedNowPlayingButtons(editNowPlayingButtons(row, "reset")), null);
    assert.notEqual(storedNowPlayingButtons(row), null);
  });
});

describe("how a Now Playing slot shows", () => {
  test("with a song on, every action's button shows", () => {
    for (const action of NOW_PLAYING_ACTIONS)
      assert.equal(nowPlayingSlotShow(action, "song"), "on");
  });

  test("with nothing playing, the slots that need a song stay empty and the others show", () => {
    const shown = NOW_PLAYING_ACTIONS.filter(
      (action) => nowPlayingSlotShow(action, "nothing") !== "hidden",
    );
    assert.deepEqual(shown, ["lyrics", "sleepTimer", "shuffle", "repeat"]);
  });

  test("while an unsearched entry's search runs, every action's button shows", () => {
    for (const action of NOW_PLAYING_ACTIONS)
      assert.equal(nowPlayingSlotShow(action, "unsearched"), "on");
  });
});

describe("the song menu button in Now Playing's header", () => {
  test("with a song on, it shows and opens the song's card", () => {
    assert.equal(nowPlayingSongMenuShow("song"), "on");
  });

  test("while an unsearched entry's search runs it shows off, the song having no card yet", () => {
    assert.equal(nowPlayingSongMenuShow("unsearched"), "off");
  });

  test("with nothing playing it is absent", () => {
    assert.equal(nowPlayingSongMenuShow("nothing"), "hidden");
  });
});

describe("the Related chevron beside the title", () => {
  test("it shows with something on and YouTube Music on", () => {
    assert.equal(nowPlayingRelatedChevronShown("song", true), true);
    assert.equal(nowPlayingRelatedChevronShown("unsearched", true), true);
  });

  test("it is absent with YouTube Music off", () => {
    assert.equal(nowPlayingRelatedChevronShown("song", false), false);
    assert.equal(nowPlayingRelatedChevronShown("unsearched", false), false);
  });

  test("it is absent with nothing playing", () => {
    assert.equal(nowPlayingRelatedChevronShown("nothing", true), false);
    assert.equal(nowPlayingRelatedChevronShown("nothing", false), false);
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
