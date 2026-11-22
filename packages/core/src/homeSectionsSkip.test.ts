import assert from "node:assert/strict";
import { test } from "node:test";

import {
  editStoredHomeArrangement,
  hiddenHomeSections,
  parseHomeArrangement,
  type HomeSectionId,
} from "./index.ts";

// The computer draws no DJ: it reads, shows and edits Home without it (docs/spec.md, Editable Home).
const NO_DJ: readonly HomeSectionId[] = ["dj"];
const REST = [
  "new-releases",
  "upcoming-shows",
  "discover",
  "in-your-orbit",
  "from-your-library",
  "community-playlists",
  "recently-added",
  "recently-played",
  "most-played-albums",
  "most-played-artists",
];
const PHONE = JSON.stringify({ shown: ["favorites", "dj", "stats", "most-played"], hidden: REST });

test("a Wave that skips a section neither shows nor offers it", () => {
  const plain = parseHomeArrangement(null, NO_DJ);
  assert.ok(!plain.sections.includes("dj"));
  assert.ok(!hiddenHomeSections(plain, NO_DJ).includes("dj"));
  const phone = parseHomeArrangement(PHONE, NO_DJ);
  assert.deepEqual(phone.sections, ["favorites", "stats", "most-played"]);
  assert.ok(!hiddenHomeSections(phone, NO_DJ).includes("dj"));
});

test("an older arrangement doesn't gain a skipped section, though the phone adds it", () => {
  const older = JSON.stringify({ shown: ["favorites", "stats"], hidden: [...REST, "most-played"] });
  assert.deepEqual(parseHomeArrangement(older, NO_DJ).sections, ["favorites", "stats"]);
  assert.ok(parseHomeArrangement(older).sections.includes("dj"));
});

test("an edit made where a section is skipped keeps it in its place for the Wave that draws it", () => {
  const moved = editStoredHomeArrangement(PHONE, { move: { from: 2, to: 0 } }, NO_DJ);
  assert.deepEqual(parseHomeArrangement(moved).sections, [
    "most-played",
    "favorites",
    "dj",
    "stats",
  ]);
  assert.deepEqual(parseHomeArrangement(moved, NO_DJ).sections, [
    "most-played",
    "favorites",
    "stats",
  ]);
  const hiddenDj = JSON.stringify({
    shown: ["favorites", "stats"],
    hidden: ["dj", ...REST, "most-played"],
  });
  const removed = editStoredHomeArrangement(hiddenDj, { remove: "stats" }, NO_DJ);
  assert.ok(!parseHomeArrangement(removed).sections.includes("dj"));
});

test("a first edit where a section is skipped leaves it for the phone to place", () => {
  const stored = editStoredHomeArrangement(null, { remove: "stats" }, NO_DJ);
  const phone = parseHomeArrangement(stored);
  assert.equal(phone.sections[phone.sections.indexOf("discover") - 1], "dj");
  assert.ok(!phone.sections.includes("stats"));
});
