import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { commonStyle, genreFamily, genreStyle, songStyle } from "./index.ts";

const styleName = (tag: string) => genreStyle(tag)?.name ?? null;

describe("Genre styles", () => {
  test("generic tags and family names have no style: the family alone", () => {
    for (const tag of ["Rock", "Alternative", "Indie", "Pop", "Metal", "Hip Hop", "Jazz"])
      assert.equal(genreStyle(tag), null, tag);
    assert.equal(genreFamily("Alternative")?.name, "Rock");
  });

  test("a split family's tags sit in their style, the same family's others apart", () => {
    assert.equal(styleName("Rap Metal"), "Heavy");
    assert.equal(styleName("Alternative Metal"), "Heavy");
    assert.equal(styleName("Soft Rock"), "Soft / acoustic");
    assert.equal(styleName("Pop Rock"), "Soft / acoustic");
    assert.equal(styleName("Acoustic"), "Soft / acoustic");
    assert.equal(styleName("Death Metal"), "Extreme metal");
    assert.equal(styleName("Grunge"), "Hard rock / grunge");
    assert.equal(styleName("Rock & Roll"), null);
  });

  test("a family not split keeps one style of its own", () => {
    assert.equal(styleName("Trap"), "Hip-Hop");
    assert.equal(styleName("Rap"), "Hip-Hop");
    assert.equal(styleName("Synthpop"), "Pop");
    assert.equal(styleName("Unknown Genre Tag"), null);
  });

  test("every style tag is a family's tag too", () => {
    for (const tag of [
      "Heavy Metal",
      "Nu Metal",
      "Deathcore",
      "Hard Rock",
      "Britpop",
      "Classic Rock",
    ])
      assert.ok(genreFamily(tag) !== null && genreStyle(tag) !== null, tag);
  });

  test("a song's style is its first genre value's that has one", () => {
    assert.equal(songStyle({ genre: "Rock" }), null);
    assert.equal(songStyle({ genres: ["Rock", "Rap Metal"] }), genreStyle("Rap Metal")?.key);
    assert.equal(songStyle({ genre: "Metalcore; Rock" }), genreStyle("Metalcore")?.key);
    assert.equal(songStyle({ genre: null }), null);
  });

  test("the style most of some songs have, ignoring the unknown", () => {
    const soft = genreStyle("Soft Rock")!.key;
    const heavy = genreStyle("Nu Metal")!.key;
    assert.equal(commonStyle([soft, heavy, heavy, null]), heavy);
    assert.equal(commonStyle([null, null]), null);
    assert.equal(commonStyle([]), null);
  });
});
