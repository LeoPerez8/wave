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
    { action: "releases", label: "New music", checked: false },
  ]);
  assert.deepEqual(followLevelEntries("releases"), [
    { action: "releases", label: "New music", checked: true },
    { action: "unfollow", label: "Unfollow", checked: false },
  ]);
});

test("the follow card's levels read in Portuguese", async () => {
  const { followLevelEntries, catalogueOf } = await import("./index.ts");
  assert.deepEqual(
    followLevelEntries("releases", { strings: catalogueOf("pt-BR") }).map((entry) => entry.label),
    ["Novas músicas", "Deixar de Seguir"],
  );
  assert.deepEqual(
    followLevelEntries(null).map((entry) => entry.label),
    ["New music"],
  );
});
