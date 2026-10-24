import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createStarPop } from "./index.ts";

describe("the pop on Now Playing's favorite star", () => {
  test("a fill asked for pops once the star shows the song filled", () => {
    const pop = createStarPop();
    assert.equal(pop.show("song-1", false), false);
    pop.ask("song-1");
    assert.equal(pop.show("song-1", true), true);
  });

  test("a song that turns out to be a favorite as it loads shows filled without a pop", () => {
    const pop = createStarPop();
    assert.equal(pop.show("song-1", false), false);
    assert.equal(pop.show("song-1", true), false);
  });

  test("the fill pops once: the star showing it filled again doesn't pop", () => {
    const pop = createStarPop();
    pop.ask("song-1");
    assert.equal(pop.show("song-1", true), true);
    assert.equal(pop.show("song-1", true), false);
  });

  test("a fill asked for is forgotten once the star shows another song", () => {
    const pop = createStarPop();
    pop.ask("song-1");
    assert.equal(pop.show("song-2", false), false);
    // Back on the first song, now a favorite: it shows filled without a pop.
    assert.equal(pop.show("song-1", true), false);
  });
});
