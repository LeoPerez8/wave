import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  alphabetIndex,
  sortKey,
  spineEntries,
  spineLayout,
  spineSection,
  spineSlotAt,
  spineStep,
} from "./index.ts";

const ROOMY = { space: 1000, slotHeight: 16, labelHeight: 14 };

const entriesOf = (names: readonly string[]) => alphabetIndex(names.map(sortKey));

/** `count` sort keys cycling through `letters`. */
const names = (count: number, letters: string) =>
  Array.from({ length: count }, (_, i) => sortKey(`${letters[i % letters.length]!}x ${i}`));

describe("spineEntries", () => {
  test("a long list gets a spine with each of its letters", () => {
    const entries = spineEntries(names(24, "ABC"));
    assert.deepEqual(
      entries.map((entry) => entry.letter),
      ["A", "B", "C"],
    );
  });

  test("a list short enough to fit in a couple of screens goes without", () => {
    assert.deepEqual(spineEntries(names(23, "ABC")), []);
  });

  test("a list filed under a single letter goes without", () => {
    assert.deepEqual(spineEntries(names(40, "A")), []);
  });
});

describe("spineLayout", () => {
  test("every letter has a fixed place, A to Z then #, whatever the list holds", () => {
    const layout = spineLayout(entriesOf(["ABBA", "Coldplay", "2Pac"]), ROOMY);
    assert.equal(layout.slots.map((slot) => slot.letter).join(""), "ABCDEFGHIJKLMNOPQRSTUVWXYZ#");
  });

  test("a letter the list has jumps to its first row; a missing one to the next letter it has", () => {
    // A: 0–1, C: 2, M: 3, #: 4
    const layout = spineLayout(entriesOf(["ABBA", "Air", "Coldplay", "Muse", "2Pac"]), ROOMY);
    const target = (letter: string) => layout.slots.find((slot) => slot.letter === letter)?.target;
    assert.deepEqual(target("A"), { letter: "A", index: 0 });
    assert.deepEqual(target("B"), { letter: "C", index: 2 });
    assert.deepEqual(target("C"), { letter: "C", index: 2 });
    assert.deepEqual(target("D"), { letter: "M", index: 3 });
    assert.deepEqual(target("Z"), { letter: "#", index: 4 });
    assert.deepEqual(target("#"), { letter: "#", index: 4 });
  });

  test("missing letters after the list's last letter jump to that last letter", () => {
    const layout = spineLayout(entriesOf(["ABBA", "Coldplay", "Muse"]), ROOMY);
    const target = (letter: string) => layout.slots.find((slot) => slot.letter === letter)?.target;
    assert.deepEqual(target("N"), { letter: "M", index: 2 });
    assert.deepEqual(target("#"), { letter: "M", index: 2 });
  });

  test("a list sorted Z to A gets the spine the same way up as the list: # first, then Z to A", () => {
    // Descending order files "#" names first.
    const layout = spineLayout(alphabetIndex(["~2pac", "muse", "coldplay", "abba"]), ROOMY);
    assert.equal(layout.slots.map((slot) => slot.letter).join(""), "#ZYXWVUTSRQPONMLKJIHGFEDCBA");
    const target = (letter: string) => layout.slots.find((slot) => slot.letter === letter)?.target;
    assert.deepEqual(target("Z"), { letter: "M", index: 1 });
    assert.deepEqual(target("D"), { letter: "C", index: 2 });
    assert.deepEqual(target("B"), { letter: "A", index: 3 });
  });

  test("with room, each place takes its full height and the list's letters are drawn; missing ones are dots", () => {
    const layout = spineLayout(entriesOf(["ABBA", "Coldplay", "2Pac"]), ROOMY);
    assert.equal(layout.slotHeight, 16);
    assert.equal(layout.height, 27 * 16);
    const drawn = layout.slots.filter((slot) => slot.label).map((slot) => slot.letter);
    assert.deepEqual(drawn, ["A", "C", "#"]);
  });

  test("short of room, places shrink to fit and only every other place is drawn", () => {
    const entries = entriesOf([..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((letter) => `${letter}x`));
    const layout = spineLayout(entries, { space: 270, slotHeight: 16, labelHeight: 14 });
    assert.equal(layout.slotHeight, 10);
    assert.equal(layout.height, 270);
    const drawn = layout.slots.filter((slot) => slot.label).map((slot) => slot.letter);
    assert.equal(drawn.join(""), "ACEGIKMOQSUWY");
  });

  test("with even less room, the drawn letters thin out further", () => {
    const entries = entriesOf([..."ABCDEFGHIJKLMNOPQRSTUVWXYZ"].map((letter) => `${letter}x`));
    const layout = spineLayout(entries, { space: 162, slotHeight: 16, labelHeight: 14 });
    assert.equal(layout.slotHeight, 6);
    const drawn = layout.slots.filter((slot) => slot.label).map((slot) => slot.letter);
    // Three 6dp places make room for one 14dp letter.
    assert.equal(drawn.join(""), "ADGJMPSVY");
  });
});

describe("spineSlotAt", () => {
  const layout = spineLayout(entriesOf(["ABBA", "Coldplay", "Muse", "2Pac"]), ROOMY);
  const letterAtY = (y: number) => spineSlotAt(layout, y)?.letter;

  test("a finger is on the place under it, measured from the spine's top", () => {
    assert.equal(letterAtY(0), "A");
    assert.equal(letterAtY(15.9), "A");
    assert.equal(letterAtY(16), "B");
    assert.equal(letterAtY(2 * 16 + 8), "C");
    assert.equal(letterAtY(26 * 16 + 1), "#");
  });

  test("a finger above or below the spine stays on its first or last place", () => {
    assert.equal(letterAtY(-40), "A");
    assert.equal(letterAtY(27 * 16), "#");
    assert.equal(letterAtY(5000), "#");
  });

  test("a spine without places has nothing under the finger", () => {
    assert.equal(spineSlotAt(spineLayout([], ROOMY), 10), undefined);
  });
});

describe("spineSection", () => {
  // A: 0–1, C: 2–4, M: 5
  const entries = entriesOf(["ABBA", "Air", "Coldplay", "Cream", "Cure", "Muse"]);

  test("a row belongs to the letter it is filed under", () => {
    assert.deepEqual(spineSection(entries, 0), { letter: "A", index: 0 });
    assert.deepEqual(spineSection(entries, 1), { letter: "A", index: 0 });
    assert.deepEqual(spineSection(entries, 4), { letter: "C", index: 2 });
    assert.deepEqual(spineSection(entries, 5), { letter: "M", index: 5 });
  });

  test("a list without letters has no sections", () => {
    assert.equal(spineSection([], 3), undefined);
  });
});

describe("spineStep", () => {
  const entries = entriesOf(["ABBA", "Air", "Coldplay", "Cream", "Cure", "Muse"]);

  test("stepping forward goes to the next letter after the section on screen", () => {
    assert.deepEqual(spineStep(entries, 0, 1), { letter: "C", index: 2 });
    assert.deepEqual(spineStep(entries, 3, 1), { letter: "M", index: 5 });
  });

  test("stepping back goes to the letter before the section on screen", () => {
    assert.deepEqual(spineStep(entries, 5, -1), { letter: "C", index: 2 });
    assert.deepEqual(spineStep(entries, 3, -1), { letter: "A", index: 0 });
  });

  test("stepping past either end stays on the first or last letter", () => {
    assert.deepEqual(spineStep(entries, 1, -1), { letter: "A", index: 0 });
    assert.deepEqual(spineStep(entries, 5, 1), { letter: "M", index: 5 });
  });

  test("a list without letters has nowhere to step", () => {
    assert.equal(spineStep([], 0, 1), undefined);
  });
});

describe("alphabet steps in a two-column album grid", () => {
  const letters = [
    { letter: "A", index: 0 },
    { letter: "B", index: 0 },
    { letter: "C", index: 1 },
    { letter: "D", index: 1 },
    { letter: "E", index: 2 },
  ];

  test("every earlier letter is reachable when two letters start on one row", () => {
    const previous = spineStep(letters, 1, -1, "C");
    assert.deepEqual(previous, { letter: "B", index: 0 });
    assert.deepEqual(spineStep(letters, 0, -1, previous?.letter), { letter: "A", index: 0 });
    assert.deepEqual(spineStep(letters, 0, -1, "A"), { letter: "A", index: 0 });
  });
  test("forward steps visit both letters on each row and stop at the end", () => {
    let row = 0;
    let chosen = "A";
    const heard: string[] = [];
    for (let i = 0; i < 5; i++) {
      const next = spineStep(letters, row, 1, chosen)!;
      heard.push(next.letter);
      row = next.index;
      chosen = next.letter;
    }
    assert.deepEqual(heard, ["B", "C", "D", "E", "E"]);
  });

  test("scrolling to another section discards the earlier explicit choice", () => {
    assert.deepEqual(spineStep(letters, 2, -1, "A"), { letter: "D", index: 1 });
    assert.deepEqual(spineStep(letters, 0, 1, "gone"), { letter: "C", index: 1 });
  });

  test("reverse sorts step in list order, including the non-Latin bucket", () => {
    const reverse = [
      { letter: "#", index: 0 },
      { letter: "Z", index: 0 },
      { letter: "M", index: 1 },
      { letter: "A", index: 1 },
    ];
    assert.deepEqual(spineStep(reverse, 0, 1, "#"), { letter: "Z", index: 0 });
    assert.deepEqual(spineStep(reverse, 1, -1, "M"), { letter: "Z", index: 0 });
    assert.deepEqual(spineStep(reverse, 0, -1, "Z"), { letter: "#", index: 0 });
  });
});
