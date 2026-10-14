import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { UNKNOWN_ARTIST, splitCredit } from "./index.ts";

describe("splitCredit", () => {
  test("a comma separates artists, the first one being the primary artist", () => {
    assert.deepEqual(splitCredit("Ariana Grande, Doja Cat"), ["Ariana Grande", "Doja Cat"]);
  });

  test("a middle dot, a semicolon and a slash separate artists too", () => {
    assert.deepEqual(splitCredit("Ariana Grande · Social House"), [
      "Ariana Grande",
      "Social House",
    ]);
    assert.deepEqual(splitCredit("Daft Punk; Pharrell Williams"), [
      "Daft Punk",
      "Pharrell Williams",
    ]);
    assert.deepEqual(splitCredit("Jay-Z/Kanye West"), ["Jay-Z", "Kanye West"]);
  });

  test("a featured credit separates artists, bracketed or not, in any case", () => {
    assert.deepEqual(splitCredit("Calvin Harris feat. Rihanna"), ["Calvin Harris", "Rihanna"]);
    assert.deepEqual(splitCredit("Calvin Harris ft. Rihanna"), ["Calvin Harris", "Rihanna"]);
    assert.deepEqual(splitCredit("Calvin Harris Featuring Rihanna"), ["Calvin Harris", "Rihanna"]);
    assert.deepEqual(splitCredit("Calvin Harris (feat. Rihanna)"), ["Calvin Harris", "Rihanna"]);
    assert.deepEqual(splitCredit("Calvin Harris [FT. Rihanna]"), ["Calvin Harris", "Rihanna"]);
    assert.deepEqual(splitCredit("Calvin Harris (Feat Rihanna)"), ["Calvin Harris", "Rihanna"]);
  });

  test("a featured word inside a name doesn't separate it", () => {
    assert.deepEqual(splitCredit("Daft Punk"), ["Daft Punk"]);
    assert.deepEqual(splitCredit("Defeater"), ["Defeater"]);
  });

  test('"with" separates artists as a whole word only', () => {
    assert.deepEqual(splitCredit("Ariana Grande with The Weeknd"), ["Ariana Grande", "The Weeknd"]);
    assert.deepEqual(splitCredit("Ariana Grande (With The Weeknd)"), [
      "Ariana Grande",
      "The Weeknd",
    ]);
    assert.deepEqual(splitCredit("Within Temptation"), ["Within Temptation"]);
  });

  test('" x " separates artists, but a name holding an x stays whole', () => {
    assert.deepEqual(splitCredit("Charli XCX x Troye Sivan"), ["Charli XCX", "Troye Sivan"]);
    assert.deepEqual(splitCredit("Lil Nas X x Billy Ray Cyrus"), ["Lil Nas X", "Billy Ray Cyrus"]);
    assert.deepEqual(splitCredit("Malcolm X"), ["Malcolm X"]);
    assert.deepEqual(splitCredit("The xx"), ["The xx"]);
  });

  test('"&" and "and" separate artists the Library doesn\'t know as a whole', () => {
    assert.deepEqual(splitCredit("Ariana Grande & Social House", []), [
      "Ariana Grande",
      "Social House",
    ]);
    assert.deepEqual(splitCredit("Kygo and Selena Gomez", ["Kygo"]), ["Kygo", "Selena Gomez"]);
    assert.deepEqual(splitCredit("Brandy", []), ["Brandy"]);
  });

  test("an artist the Library has on their own, as a whole credit, stays whole", () => {
    const known = ["Simon & Garfunkel", "Mumford and Sons"];
    assert.deepEqual(splitCredit("Simon & Garfunkel", known), ["Simon & Garfunkel"]);
    assert.deepEqual(splitCredit("simon  &  garfunkel", known), ["simon & garfunkel"]);
    assert.deepEqual(splitCredit("Mumford and Sons", known), ["Mumford and Sons"]);
    assert.deepEqual(splitCredit("Simon & Garfunkel feat. Paul Simon", known), [
      "Simon & Garfunkel",
      "Paul Simon",
    ]);
  });

  test("a collaboration's own credit doesn't keep it whole when one of its artists stands alone", () => {
    const known = ["Ariana Grande & Social House", "Ariana Grande"];
    assert.deepEqual(splitCredit("Ariana Grande & Social House", known), [
      "Ariana Grande",
      "Social House",
    ]);
    const alsoCollaborating = ["Ariana Grande & Social House", "Ariana Grande, Doja Cat"];
    assert.deepEqual(splitCredit("Ariana Grande & Social House", alsoCollaborating), [
      "Ariana Grande",
      "Social House",
    ]);
  });

  test("a name credited twice counts once, whatever its case and spacing", () => {
    assert.deepEqual(splitCredit("Drake, Future feat. drake  "), ["Drake", "Future"]);
    assert.deepEqual(splitCredit("Rihanna & RIHANNA"), ["Rihanna"]);
  });

  test("empty parts are dropped", () => {
    assert.deepEqual(splitCredit(" , Drake,, ; Future / "), ["Drake", "Future"]);
  });

  test("a credit naming nobody is Unknown Artist, which stays one artist", () => {
    assert.deepEqual(splitCredit(""), [UNKNOWN_ARTIST]);
    assert.deepEqual(splitCredit(" ; , "), [UNKNOWN_ARTIST]);
    assert.deepEqual(splitCredit(UNKNOWN_ARTIST), [UNKNOWN_ARTIST]);
  });
});
