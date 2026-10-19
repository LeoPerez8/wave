import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { songChangeCause, type QueueCommand } from "./index.ts";

describe("songChangeCause", () => {
  test("the buttons and a tap in the queue name themselves", () => {
    assert.equal(songChangeCause({ type: "next" }), "next");
    assert.equal(songChangeCause({ type: "previous", positionMs: 1000 }), "previous");
    assert.equal(songChangeCause({ type: "jumpTo", key: "k3" }), "queueTap");
  });

  test("playing a list is a new queue", () => {
    const play: QueueCommand = {
      type: "play",
      trackIds: ["1", "2"],
      startIndex: 1,
      context: { kind: "album", id: "7" },
    };
    assert.equal(songChangeCause(play), "play");
  });

  test("the queue following the player's own move, or running out, isn't the owner's", () => {
    assert.equal(songChangeCause({ type: "playerMoved", key: "k2" }), "player");
    assert.equal(songChangeCause({ type: "trackEnded" }), "trackEnded");
  });

  test("a search answer is the search", () => {
    assert.equal(songChangeCause({ type: "settled", trackId: "u1", becomes: null }), "search");
  });

  test("any other edit is a queue change", () => {
    const edits: QueueCommand[] = [
      { type: "remove", key: "k1" },
      { type: "removeTracks", trackIds: ["1"] },
      { type: "setShuffle", on: true },
      { type: "reshuffle" },
      { type: "setRepeat", mode: "all" },
      { type: "playNext", trackIds: ["1"] },
      { type: "addToQueue", trackIds: ["1"] },
      { type: "append", trackIds: ["1"] },
      { type: "moreFromArtist", ranking: ["1"] },
    ];
    for (const command of edits) assert.equal(songChangeCause(command), "queue", command.type);
  });
});
