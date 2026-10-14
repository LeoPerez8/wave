import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { UNKNOWN_ARTIST, creditSplitter, respreadDeletedSongs, splitCredit } from "./index.ts";

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
    const featuring = ["Ariana Grande & Social House", "Ariana Grande feat. Doja Cat"];
    assert.deepEqual(splitCredit("Ariana Grande & Social House", featuring), [
      "Ariana Grande",
      "Social House",
    ]);
  });

  test("a collaboration whose artists have no song on their own stays one artist", () => {
    const known = ["Ariana Grande & Social House", "Ariana Grande, Doja Cat"];
    assert.deepEqual(splitCredit("Ariana Grande & Social House", known), [
      "Ariana Grande & Social House",
    ]);
  });

  test("a comma, a slash or another separator inside an artist the Library has keeps it whole", () => {
    assert.deepEqual(splitCredit("Earth, Wind & Fire", ["Earth, Wind & Fire"]), [
      "Earth, Wind & Fire",
    ]);
    assert.deepEqual(splitCredit("AC/DC", ["AC/DC"]), ["AC/DC"]);
    assert.deepEqual(splitCredit("Tyler, The Creator", ["Tyler, The Creator"]), [
      "Tyler, The Creator",
    ]);
  });

  test("a known artist inside a longer credit stays whole while the rest splits", () => {
    const known = ["Earth, Wind & Fire", "AC/DC", "Tyler, The Creator"];
    assert.deepEqual(splitCredit("Earth, Wind & Fire, The Emotions", known), [
      "Earth, Wind & Fire",
      "The Emotions",
    ]);
    assert.deepEqual(splitCredit("Tyler, The Creator feat. Kali Uchis", known), [
      "Tyler, The Creator",
      "Kali Uchis",
    ]);
    assert.deepEqual(splitCredit("AC/DC x Kanye West", known), ["AC/DC", "Kanye West"]);
  });

  test("an artist the Library only has featuring someone stays whole", () => {
    const tyler = ["Tyler, The Creator feat. Kali Uchis"];
    assert.deepEqual(splitCredit("Tyler, The Creator feat. Kali Uchis", tyler), [
      "Tyler, The Creator",
      "Kali Uchis",
    ]);
    const ewf = ["Earth, Wind & Fire ft. The Emotions"];
    assert.deepEqual(splitCredit("Earth, Wind & Fire ft. The Emotions", ewf), [
      "Earth, Wind & Fire",
      "The Emotions",
    ]);
    assert.deepEqual(splitCredit("Earth, Wind & Fire", ewf), ["Earth, Wind & Fire"]);
  });

  test("a featured part of a credit doesn't make a collaboration one artist", () => {
    const known = ["Calvin Harris feat. Doja Cat, Nicki Minaj"];
    assert.deepEqual(splitCredit("Calvin Harris feat. Doja Cat, Nicki Minaj", known), [
      "Calvin Harris",
      "Doja Cat",
      "Nicki Minaj",
    ]);
  });

  test("a collaboration's own credit splits once one of its artists is credited alone", () => {
    const known = ["Ariana Grande, Doja Cat", "Ariana Grande"];
    assert.deepEqual(splitCredit("Ariana Grande, Doja Cat", known), ["Ariana Grande", "Doja Cat"]);
    assert.deepEqual(splitCredit("Ariana Grande, Doja Cat", ["Ariana Grande, Doja Cat"]), [
      "Ariana Grande, Doja Cat",
    ]);
  });

  test("a featured credit always splits, even inside a known whole credit", () => {
    assert.deepEqual(splitCredit("Calvin Harris feat. Rihanna", ["Calvin Harris feat. Rihanna"]), [
      "Calvin Harris",
      "Rihanna",
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

describe("respreadDeletedSongs", () => {
  // Artists staying in the Library, by identity key.
  const staying = new Map([
    ["ariana grande", 1],
    ["doja cat", 2],
    ["social house", 3],
  ]);
  const split = creditSplitter(["Ariana Grande", "Doja Cat"]);

  test("a whole credit leaving hands its deleted songs to each artist it names, in credit order", () => {
    const changed = respreadDeletedSongs({
      pruned: [{ id: 10, name: "Ariana Grande, Doja Cat" }],
      staying,
      deletedSongs: new Map([
        [100, [10]],
        [101, [7, 10]],
      ]),
      split,
    });
    assert.deepEqual(
      changed,
      new Map([
        [100, [1, 2]],
        [101, [7, 1, 2]],
      ]),
    );
  });

  test("a name the song credits already counts once", () => {
    const changed = respreadDeletedSongs({
      pruned: [{ id: 10, name: "Ariana Grande, Doja Cat" }],
      staying,
      deletedSongs: new Map([[100, [2, 10]]]),
      split,
    });
    assert.deepEqual(changed, new Map([[100, [2, 1]]]));
  });

  test("only the named artists staying in the Library inherit", () => {
    const changed = respreadDeletedSongs({
      pruned: [{ id: 10, name: "Ariana Grande & Nobody Here" }],
      staying,
      deletedSongs: new Map([[100, [10]]]),
      split,
    });
    assert.deepEqual(changed, new Map([[100, [1]]]));
  });

  test("songs of an artist leaving with no heir, or of no artist leaving, are left alone", () => {
    const changed = respreadDeletedSongs({
      pruned: [
        { id: 10, name: "Nobody Here, Nor There" },
        { id: 11, name: "Social House" },
      ],
      staying,
      deletedSongs: new Map([
        [100, [10]],
        [101, [11]],
        [102, [1]],
      ]),
      split,
    });
    assert.deepEqual(changed, new Map());
  });

  test("several whole credits leaving at once each hand on their songs", () => {
    const changed = respreadDeletedSongs({
      pruned: [
        { id: 10, name: "Ariana Grande, Doja Cat" },
        { id: 11, name: "Ariana Grande · Social House" },
      ],
      staying,
      deletedSongs: new Map([[100, [11, 10]]]),
      split,
    });
    assert.deepEqual(changed, new Map([[100, [1, 3, 2]]]));
  });
});
