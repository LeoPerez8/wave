import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { NOW_PLAYING_OPENS_ON, stepNowPlayingScreens, type NowPlayingScreens } from "./index.ts";

const player: NowPlayingScreens = { screen: "player" };
const queue: NowPlayingScreens = { screen: "queue" };
const related: NowPlayingScreens = { screen: "related" };

describe("stepNowPlayingScreens", () => {
  test("Now Playing opens on the player", () => {
    assert.deepEqual(NOW_PLAYING_OPENS_ON, { screen: "player" });
  });

  test("the edge mark opens the Queue", () => {
    assert.deepEqual(stepNowPlayingScreens(player, { type: "show", screen: "queue" }), {
      screens: { screen: "queue" },
      close: false,
    });
  });

  test("the Queue button opens the Queue from the player and returns from it", () => {
    assert.deepEqual(stepNowPlayingScreens(player, { type: "toggle", screen: "queue" }), {
      screens: { screen: "queue" },
      close: false,
    });
    assert.deepEqual(stepNowPlayingScreens(queue, { type: "toggle", screen: "queue" }), {
      screens: { screen: "player" },
      close: false,
    });
  });

  test("a swipe shows the screen it settled on", () => {
    assert.deepEqual(stepNowPlayingScreens(player, { type: "swipe", to: "queue" }), {
      screens: { screen: "queue" },
      close: false,
    });
    assert.deepEqual(stepNowPlayingScreens(queue, { type: "swipe", to: "player" }), {
      screens: { screen: "player" },
      close: false,
    });
    assert.deepEqual(stepNowPlayingScreens(queue, { type: "swipe", to: "queue" }), {
      screens: { screen: "queue" },
      close: false,
    });
  });

  test("a tap on the Queue's playing-song header returns to the player", () => {
    assert.deepEqual(stepNowPlayingScreens(queue, { type: "headerTap" }), {
      screens: { screen: "player" },
      close: false,
    });
  });

  test("Back leaves the Queue first and keeps Now Playing open", () => {
    assert.deepEqual(stepNowPlayingScreens(queue, { type: "back" }), {
      screens: { screen: "player" },
      close: false,
    });
  });

  test("Back on the player closes Now Playing", () => {
    assert.deepEqual(stepNowPlayingScreens(player, { type: "back" }), {
      screens: { screen: "player" },
      close: true,
    });
  });

  test("Now Playing closed from the Queue opens on the player next time", () => {
    assert.deepEqual(stepNowPlayingScreens(queue, { type: "closed" }), {
      screens: { screen: "player" },
      close: false,
    });
  });

  test("showing the player from the Queue leaves it, as Related asked from the Queue does", () => {
    assert.deepEqual(stepNowPlayingScreens(queue, { type: "show", screen: "player" }), {
      screens: { screen: "player" },
      close: false,
    });
  });

  test("the chevron, the song menu's Related and the mini player's Related open Related", () => {
    assert.deepEqual(stepNowPlayingScreens(player, { type: "show", screen: "related" }), {
      screens: { screen: "related" },
      close: false,
    });
  });

  test("Related asked from the Queue rises over it", () => {
    assert.deepEqual(stepNowPlayingScreens(queue, { type: "show", screen: "related" }), {
      screens: { screen: "related" },
      close: false,
    });
  });

  test("Related's arrow, a header tap and a drag down return to the player", () => {
    for (const event of [
      { type: "show", screen: "player" },
      { type: "headerTap" },
      { type: "dragDown" },
    ] as const)
      assert.deepEqual(stepNowPlayingScreens(related, event), {
        screens: { screen: "player" },
        close: false,
      });
  });

  test("a drag down on the player or the Queue changes no screen", () => {
    assert.deepEqual(stepNowPlayingScreens(player, { type: "dragDown" }), {
      screens: { screen: "player" },
      close: false,
    });
    assert.deepEqual(stepNowPlayingScreens(queue, { type: "dragDown" }), {
      screens: { screen: "queue" },
      close: false,
    });
  });

  test("Back leaves Related first and keeps Now Playing open", () => {
    assert.deepEqual(stepNowPlayingScreens(related, { type: "back" }), {
      screens: { screen: "player" },
      close: false,
    });
  });

  test("YouTube Music turned off brings the player back from Related", () => {
    assert.deepEqual(stepNowPlayingScreens(related, { type: "ytMusicOff" }), {
      screens: { screen: "player" },
      close: false,
    });
  });

  test("YouTube Music turned off leaves the player and the Queue as they are", () => {
    assert.deepEqual(stepNowPlayingScreens(player, { type: "ytMusicOff" }), {
      screens: { screen: "player" },
      close: false,
    });
    assert.deepEqual(stepNowPlayingScreens(queue, { type: "ytMusicOff" }), {
      screens: { screen: "queue" },
      close: false,
    });
  });

  test("Now Playing closed from Related opens on the player next time", () => {
    assert.deepEqual(stepNowPlayingScreens(related, { type: "closed" }), {
      screens: { screen: "player" },
      close: false,
    });
  });
});
