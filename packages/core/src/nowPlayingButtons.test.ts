import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  NOW_PLAYING_ACTIONS,
  NOW_PLAYING_BUTTONS_KEY,
  NOW_PLAYING_FOOTER_SLOTS,
  NOW_PLAYING_PREVIOUS_ROW_KEY,
  NOW_PLAYING_TRANSPORT_SLOTS,
  editNowPlayingButtons,
  nowPlayingButtonsAreDefault,
  moveNowPlayingButton,
  nowPlayingRelatedChevronShown,
  nowPlayingSlotChoices,
  nowPlayingSlotChoiceHolder,
  nowPlayingSlotRoute,
  nowPlayingSlotRunsSongMenu,
  nowPlayingSlotShow,
  nowPlayingSongMenuShow,
  readNowPlayingButtons,
  readNowPlayingSlotRoute,
  storedNowPlayingButtons,
} from "./index.ts";
import type { NowPlayingAction } from "./index.ts";

const DEFAULT = ["lyrics", "addToPlaylist", "download", "shuffle", "repeat", null, null] as const;

describe("the saved Now Playing slots", () => {
  test("with nothing stored, the footer holds Lyrics, Add to Playlist, Download, Shuffle and Repeat, and both transport slots are empty", () => {
    assert.deepEqual(readNowPlayingButtons(null), [
      "lyrics",
      "addToPlaylist",
      "download",
      "shuffle",
      "repeat",
      null,
      null,
    ]);
  });

  test("saved slots come back as saved, empty ones and the transport's included", () => {
    const edited = ["queue", null, "repeat", null, "lyrics", "shuffle", "share"] as const;
    assert.deepEqual(readNowPlayingButtons(storedNowPlayingButtons(edited)), edited);
    const empty = [null, null, null, null, null, null, null] as const;
    assert.deepEqual(readNowPlayingButtons(storedNowPlayingButtons(empty)), empty);
  });

  test("they are stored as a JSON list of seven actions or nulls: footer 1 to 5, then the transport's left and right", () => {
    assert.equal(
      storedNowPlayingButtons(["lyrics", "queue", null, "download", "share", "shuffle", "repeat"]),
      '["lyrics","queue",null,"download","share","shuffle","repeat"]',
    );
  });

  test("the default is stored as nothing, so reset slots read as the default of any later Wave", () => {
    assert.equal(storedNowPlayingButtons(DEFAULT), null);
    assert.equal(nowPlayingButtonsAreDefault(DEFAULT), true);
    assert.equal(
      nowPlayingButtonsAreDefault([
        "lyrics",
        "addToPlaylist",
        "download",
        "shuffle",
        "repeat",
        "queue",
        null,
      ]),
      false,
    );
  });

  test("a stored value that isn't seven known slots, each action once, reads as the default", () => {
    for (const stored of [
      "",
      "not json",
      "{}",
      "null",
      '"shuffle"',
      // The four slots of the row before: too few.
      '["shuffle","repeat","share","sleepTimer"]',
      '["shuffle","repeat","share","sleepTimer","lyrics","queue"]',
      '["shuffle","repeat","share","sleepTimer","lyrics","queue","download",null]',
      '["shuffle",1,"share","sleepTimer",null,null,null]',
      '["shuffle","shuffle","share","sleepTimer",null,null,null]',
      '["shuffle","repeat","share","sleepTimer",null,null,"shuffle"]',
    ]) {
      assert.deepEqual(readNowPlayingButtons(stored), DEFAULT, stored);
    }
  });

  test("a slot holding an action this Wave doesn't know (a newer Wave's) reads as empty, the others as saved", () => {
    assert.deepEqual(
      readNowPlayingButtons('["shuffle","repeat","karaoke","sleepTimer",null,null,"lyrics"]'),
      ["shuffle", "repeat", null, "sleepTimer", null, null, "lyrics"],
    );
    assert.deepEqual(
      readNowPlayingButtons('["karaoke","repeat","encore","sleepTimer",null,"karaoke",null]'),
      [null, "repeat", null, "sleepTimer", null, null, null],
    );
    // Related and Song menu were never actions of the seven slots.
    assert.deepEqual(
      readNowPlayingButtons('["related","repeat","songMenu","sleepTimer",null,null,null]'),
      [null, "repeat", null, "sleepTimer", null, null, null],
    );
  });
});

describe("a row edited before there were seven slots", () => {
  test("keeps its four slots in footer 1 to 4 and gets Queue in footer 5, the transport slots empty", () => {
    assert.deepEqual(readNowPlayingButtons(null, '["share","sleepTimer","repeat","lyrics"]'), [
      "share",
      "sleepTimer",
      "repeat",
      "lyrics",
      "queue",
      null,
      null,
    ]);
  });

  test("keeps its None slots", () => {
    assert.deepEqual(readNowPlayingButtons(null, '["shuffle",null,"repeat",null]'), [
      "shuffle",
      null,
      "repeat",
      null,
      "queue",
      null,
      null,
    ]);
  });

  test("a slot that held Related or Song menu is empty", () => {
    assert.deepEqual(
      readNowPlayingButtons(null, '["related","sleepTimer","songMenu","download"]'),
      [null, "sleepTimer", null, "download", "queue", null, null],
    );
  });

  test("with no row stored before, or one that isn't four known slots, each action once, the default shows", () => {
    for (const before of [
      null,
      "",
      "not json",
      "{}",
      '["shuffle","repeat","share"]',
      '["shuffle","repeat","share","sleepTimer","lyrics"]',
      '["shuffle","repeat","karaoke","sleepTimer"]',
      '["shuffle","shuffle","share","sleepTimer"]',
      // Queue was a fixed button then, never a slot's.
      '["shuffle","queue","share","sleepTimer"]',
    ]) {
      assert.deepEqual(readNowPlayingButtons(null, before), DEFAULT, String(before));
    }
  });

  test("slots stored under the new key win over the row from before", () => {
    const edited = ["queue", null, "repeat", null, "lyrics", "shuffle", "share"] as const;
    assert.deepEqual(
      readNowPlayingButtons(JSON.stringify(edited), '["share","sleepTimer","repeat","lyrics"]'),
      edited,
    );
  });

  test("an unreadable value under the new key reads as the default, not the row from before", () => {
    assert.deepEqual(
      readNowPlayingButtons("not json", '["share","sleepTimer","repeat","lyrics"]'),
      DEFAULT,
    );
  });

  test("the converted row is stored as its seven slots", () => {
    const before = '["share","sleepTimer","repeat","lyrics"]';
    assert.equal(
      storedNowPlayingButtons(readNowPlayingButtons(null, before), before),
      '["share","sleepTimer","repeat","lyrics","queue",null,null]',
    );
  });

  test("Reset to Default over it stores the default itself, so the row from before doesn't come back", () => {
    const before = '["share","sleepTimer","repeat","lyrics"]';
    const stored = storedNowPlayingButtons(DEFAULT, before);
    assert.notEqual(stored, null);
    assert.deepEqual(readNowPlayingButtons(stored, before), DEFAULT);
    // With no valid row from before, the default still stores as nothing.
    assert.equal(storedNowPlayingButtons(DEFAULT, "not json"), null);
    assert.equal(storedNowPlayingButtons(DEFAULT, null), null);
  });
});

describe("the choices a Now Playing slot offers", () => {
  test("every action a slot can hold, Queue among them, without Related or Song menu, which have fixed places", () => {
    const choices = [
      "lyrics",
      "queue",
      "sleepTimer",
      "addToPlaylist",
      "download",
      "shuffle",
      "repeat",
      "share",
      "dislike",
      "magicQueue",
      "goToArtist",
      "goToAlbum",
    ];
    assert.deepEqual(nowPlayingSlotChoices(), choices);
    assert.deepEqual(NOW_PLAYING_ACTIONS, choices);
  });

  test("Dislike, Magic Queue, Go to Artist and Go to Album are offered, and the default slots hold none of them", () => {
    for (const action of ["dislike", "magicQueue", "goToArtist", "goToAlbum"] as const) {
      assert.equal(nowPlayingSlotChoices().includes(action), true, action);
      assert.equal(readNowPlayingButtons(null).includes(action), false, action);
    }
  });

  test("slots holding Dislike come back as saved", () => {
    const slots = ["lyrics", "dislike", "download", "shuffle", "repeat", null, "queue"] as const;
    assert.deepEqual(readNowPlayingButtons(storedNowPlayingButtons(slots)), slots);
  });

  test("slots holding Magic Queue, Go to Artist and Go to Album come back as saved", () => {
    const slots = [
      "lyrics",
      "goToArtist",
      "goToAlbum",
      null,
      "repeat",
      "magicQueue",
      null,
    ] as const;
    const stored = storedNowPlayingButtons(slots);
    assert.equal(stored, '["lyrics","goToArtist","goToAlbum",null,"repeat","magicQueue",null]');
    assert.deepEqual(readNowPlayingButtons(stored), slots);
  });

  test("picking one another slot holds swaps the two, as any action does", () => {
    assert.deepEqual(
      editNowPlayingButtons(["lyrics", "goToAlbum", null, null, null, "magicQueue", null], {
        slot: 1,
        action: "magicQueue",
      }),
      ["lyrics", "magicQueue", null, null, null, "goToAlbum", null],
    );
    assert.equal(
      nowPlayingSlotChoiceHolder(
        ["lyrics", null, null, null, null, null, "goToArtist"],
        0,
        "goToArtist",
      ),
      "next",
    );
  });
});

describe("the caption a slot's choice shows", () => {
  const slots = ["lyrics", "addToPlaylist", null, null, null, "shuffle", "repeat"] as const;

  test("an action another footer slot holds is captioned as in the footer", () => {
    assert.equal(nowPlayingSlotChoiceHolder(slots, 5, "lyrics"), "footer");
    assert.equal(nowPlayingSlotChoiceHolder(slots, 0, "addToPlaylist"), "footer");
  });

  test("an action a transport slot holds is captioned by the transport button it sits beside", () => {
    assert.equal(nowPlayingSlotChoiceHolder(slots, 0, "shuffle"), "previous");
    assert.equal(nowPlayingSlotChoiceHolder(slots, 0, "repeat"), "next");
    assert.equal(nowPlayingSlotChoiceHolder(slots, 6, "shuffle"), "previous");
  });

  test("the slot's own action, a free action and None have no caption", () => {
    assert.equal(nowPlayingSlotChoiceHolder(slots, 0, "lyrics"), null);
    assert.equal(nowPlayingSlotChoiceHolder(slots, 5, "shuffle"), null);
    assert.equal(nowPlayingSlotChoiceHolder(slots, 0, "queue"), null);
    assert.equal(nowPlayingSlotChoiceHolder(slots, 2, null), null);
  });

  test("picking a captioned action swaps it with the slot that held it", () => {
    assert.deepEqual(editNowPlayingButtons(slots, { slot: 0, action: "repeat" }), [
      "repeat",
      "addToPlaylist",
      null,
      null,
      null,
      "shuffle",
      "lyrics",
    ]);
  });
});

describe("where the Now Playing slots are stored", () => {
  test("under a key of their own, so the row from before is never written again", () => {
    assert.equal(NOW_PLAYING_BUTTONS_KEY, "settings.nowPlayingSlots");
    // A phone on an older Wave keeps reading and writing its row here.
    assert.equal(NOW_PLAYING_PREVIOUS_ROW_KEY, "settings.nowPlayingRow");
  });
});

describe("setting the Now Playing slots", () => {
  const slots = ["lyrics", "sleepTimer", "addToPlaylist", "download", "queue", null, null] as const;

  test("a slot set to an action no other slot holds takes it, the rest unchanged", () => {
    assert.deepEqual(editNowPlayingButtons(slots, { slot: 1, action: "shuffle" }), [
      "lyrics",
      "shuffle",
      "addToPlaylist",
      "download",
      "queue",
      null,
      null,
    ]);
  });

  test("an empty transport slot takes an action no slot holds", () => {
    assert.deepEqual(editNowPlayingButtons(slots, { slot: 5, action: "shuffle" }), [
      "lyrics",
      "sleepTimer",
      "addToPlaylist",
      "download",
      "queue",
      "shuffle",
      null,
    ]);
    assert.deepEqual(editNowPlayingButtons(slots, { slot: 6, action: "repeat" }), [
      "lyrics",
      "sleepTimer",
      "addToPlaylist",
      "download",
      "queue",
      null,
      "repeat",
    ]);
  });

  test("a footer slot set to an action another footer slot holds swaps the two, so none shows twice", () => {
    assert.deepEqual(editNowPlayingButtons(slots, { slot: 0, action: "download" }), [
      "download",
      "sleepTimer",
      "addToPlaylist",
      "lyrics",
      "queue",
      null,
      null,
    ]);
  });

  test("a transport slot set to an action a footer slot holds swaps the two, leaving the footer slot empty when it was", () => {
    assert.deepEqual(editNowPlayingButtons(slots, { slot: 6, action: "queue" }), [
      "lyrics",
      "sleepTimer",
      "addToPlaylist",
      "download",
      null,
      null,
      "queue",
    ]);
  });

  test("a footer slot set to an action a transport slot holds swaps the two", () => {
    assert.deepEqual(
      editNowPlayingButtons(["lyrics", "share", null, null, null, "shuffle", "repeat"], {
        slot: 1,
        action: "repeat",
      }),
      ["lyrics", "repeat", null, null, null, "shuffle", "share"],
    );
  });

  test("the two transport slots swap with each other", () => {
    assert.deepEqual(
      editNowPlayingButtons(["lyrics", null, null, null, null, "shuffle", "repeat"], {
        slot: 5,
        action: "repeat",
      }),
      ["lyrics", null, null, null, null, "repeat", "shuffle"],
    );
  });

  test("a slot set to the action it holds stays as it is", () => {
    assert.deepEqual(editNowPlayingButtons(slots, { slot: 2, action: "addToPlaylist" }), slots);
  });

  test("a slot set to None loses its button, and several slots can be None", () => {
    const one = editNowPlayingButtons(slots, { slot: 1, action: null });
    assert.deepEqual(one, ["lyrics", null, "addToPlaylist", "download", "queue", null, null]);
    assert.deepEqual(editNowPlayingButtons(one, { slot: 4, action: null }), [
      "lyrics",
      null,
      "addToPlaylist",
      "download",
      null,
      null,
      null,
    ]);
  });

  test("a slot that isn't one of the seven changes nothing", () => {
    assert.deepEqual(editNowPlayingButtons(slots, { slot: 7, action: "shuffle" }), slots);
    assert.deepEqual(editNowPlayingButtons(slots, { slot: -1, action: "shuffle" }), slots);
  });

  test("Reset to Default brings back the default footer and empty transport slots", () => {
    assert.deepEqual(
      editNowPlayingButtons(
        ["share", null, "repeat", "sleepTimer", "queue", "shuffle", "lyrics"],
        "reset",
      ),
      ["lyrics", "addToPlaylist", "download", "shuffle", "repeat", null, null],
    );
  });

  test("dragging a button onto a filled slot swaps them across the footer and transport", () => {
    const withTransport = [
      "lyrics",
      "sleepTimer",
      "addToPlaylist",
      "download",
      "queue",
      "shuffle",
      "repeat",
    ] as const;
    assert.deepEqual(moveNowPlayingButton(withTransport, 0, 6), [
      "repeat",
      "sleepTimer",
      "addToPlaylist",
      "download",
      "queue",
      "shuffle",
      "lyrics",
    ]);
  });

  test("dragging a button onto an empty slot moves it and leaves its old slot empty", () => {
    assert.deepEqual(moveNowPlayingButton(slots, 1, 5), [
      "lyrics",
      null,
      "addToPlaylist",
      "download",
      "queue",
      "sleepTimer",
      null,
    ]);
  });

  test("a drop onto the same slot, from an empty slot, or outside the seven slots changes nothing", () => {
    assert.deepEqual(moveNowPlayingButton(slots, 1, 1), slots);
    assert.deepEqual(moveNowPlayingButton(slots, 5, 0), slots);
    assert.deepEqual(moveNowPlayingButton(slots, 0, 7), slots);
    assert.deepEqual(moveNowPlayingButton(slots, -1, 0), slots);
  });

  test("reset slots store as nothing and are the default, which is what turns Reset to Default off", () => {
    const reset = editNowPlayingButtons(slots, "reset");
    assert.equal(storedNowPlayingButtons(reset), null);
    assert.equal(nowPlayingButtonsAreDefault(reset), true);
    assert.notEqual(storedNowPlayingButtons(slots), null);
    assert.equal(nowPlayingButtonsAreDefault(slots), false);
  });
});

describe("how a Now Playing slot shows", () => {
  const SONG_MENU = ["magicQueue", "goToArtist", "goToAlbum"] as const;

  test("with a song on, every action's button shows, the song menu's three while its card offers them", () => {
    for (const action of NOW_PLAYING_ACTIONS)
      assert.equal(nowPlayingSlotShow(action, "song", ["addToPlaylist", ...SONG_MENU]), "on");
  });

  test("Magic Queue, Go to Artist and Go to Album show off when the playing song's card doesn't offer them", () => {
    // A song with no album, say, or YT Music off for a streamed song's Magic Queue.
    for (const action of SONG_MENU) {
      assert.equal(nowPlayingSlotShow(action, "song", []), "off", action);
      assert.equal(
        nowPlayingSlotShow(
          action,
          "song",
          SONG_MENU.filter((other) => other !== action),
        ),
        "off",
        action,
      );
    }
    assert.equal(nowPlayingSlotShow("goToAlbum", "song"), "off");
  });

  test("exactly Magic Queue, Go to Artist and Go to Album run an entry of the playing song's card", () => {
    assert.deepEqual(NOW_PLAYING_ACTIONS.filter(nowPlayingSlotRunsSongMenu), [...SONG_MENU]);
  });

  test("the other actions show whatever the card offers", () => {
    for (const action of NOW_PLAYING_ACTIONS.filter(
      (other) => !SONG_MENU.some((menu) => menu === other),
    ))
      assert.equal(nowPlayingSlotShow(action, "song", []), "on", action);
  });

  test("with nothing playing, the slots that need a song, Queue's and the song menu's included, stay empty and the others show", () => {
    const shown = NOW_PLAYING_ACTIONS.filter(
      (action) => nowPlayingSlotShow(action, "nothing", SONG_MENU) !== "hidden",
    );
    assert.deepEqual(shown, ["lyrics", "sleepTimer", "shuffle", "repeat"]);
  });

  test("while an unsearched entry's search runs, Dislike and the song menu's three show off and every other button shows", () => {
    // No song yet to keep a dislike under, and no card yet to run an entry of.
    const off: readonly NowPlayingAction[] = ["dislike", ...SONG_MENU];
    for (const action of off)
      assert.equal(nowPlayingSlotShow(action, "unsearched", SONG_MENU), "off", action);
    for (const action of NOW_PLAYING_ACTIONS.filter((other) => !off.includes(other)))
      assert.equal(nowPlayingSlotShow(action, "unsearched"), "on", action);
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
  test("1 to 5 are the footer's slots, left to right, then left and right are the transport's", () => {
    assert.deepEqual(
      ["1", "2", "3", "4", "5", "left", "right"].map(readNowPlayingSlotRoute),
      [0, 1, 2, 3, 4, 5, 6],
    );
    assert.equal(NOW_PLAYING_FOOTER_SLOTS, 5);
    assert.deepEqual(NOW_PLAYING_TRANSPORT_SLOTS, { left: 5, right: 6 });
  });

  test("each slot's route reads back as that slot", () => {
    for (const slot of [0, 1, 2, 3, 4, 5, 6])
      assert.equal(readNowPlayingSlotRoute(nowPlayingSlotRoute(slot) ?? undefined), slot);
    assert.equal(nowPlayingSlotRoute(7), null);
    assert.equal(nowPlayingSlotRoute(-1), null);
  });

  test("anything else names no slot", () => {
    for (const param of [
      "0",
      "6",
      "7",
      "01",
      " 1",
      "1.0",
      "one",
      "Left",
      "",
      undefined,
      ["1"],
      ["1", "2"],
    ])
      assert.equal(readNowPlayingSlotRoute(param), null, String(param));
  });
});
