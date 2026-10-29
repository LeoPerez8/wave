import { test } from "node:test";
import assert from "node:assert/strict";
import { followArtistKey } from "./index.ts";

test("Library and online names share one follow identity, including namesakes", () => {
  assert.equal(followArtistKey("The Beyoncé"), "beyonce");
  assert.equal(followArtistKey("BEYONCE"), "beyonce");
  assert.equal(followArtistKey("Earth, Wind & Fire"), followArtistKey("Earth Wind and Fire"));
  assert.equal(followArtistKey("Phoenix"), followArtistKey("PHOENIX"));
  assert.notEqual(followArtistKey("Phoenix"), followArtistKey("Phoenix Band"));
});

test("the first follow offers releases; an existing follow checks its level and offers Unfollow", async () => {
  const { followLevelEntries } = await import("./index.ts");
  assert.deepEqual(followLevelEntries(null), [
    { action: "releases", label: "New releases", checked: false },
  ]);
  assert.deepEqual(followLevelEntries("releases"), [
    { action: "releases", label: "New releases", checked: true },
    { action: "unfollow", label: "Unfollow", checked: false },
  ]);
});
