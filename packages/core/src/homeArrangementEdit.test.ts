import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  editStoredHomeArrangement,
  parseHomeArrangement,
  readHomeArrangementEdit,
  storedHomeArrangement,
} from "./index.ts";

const stored = (value: unknown): string => JSON.stringify(value);
const read = (value: string | null): Record<string, unknown> =>
  JSON.parse(value ?? "null") as Record<string, unknown>;

describe("an edit to the stored Home arrangement", () => {
  test("is the edit the arrangement rules make", () => {
    const edited = editStoredHomeArrangement(null, { remove: "favorites" });
    assert.deepEqual(parseHomeArrangement(edited).sections, [
      "new-releases",
      "upcoming-shows",
      "discover",
      "in-your-orbit",
      "from-your-library",
      "community-playlists",
      "recently-added",
      "recently-played",
      "most-played",
      "most-played-albums",
      "most-played-artists",
      "stats",
    ]);
    assert.deepEqual(read(edited).hidden, ["favorites"]);
  });

  test("stores nothing when the edit brings back the default", () => {
    const hidden = editStoredHomeArrangement(null, { remove: "stats" });
    assert.equal(editStoredHomeArrangement(hidden, { add: "stats" }), null);
  });

  test("keeps a shown section this Wave doesn't know in its place", () => {
    const before = stored({
      shown: ["favorites", "karaoke", "most-played", "stats"],
      hidden: [
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
      ],
    });
    // The phone's order had the unknown section right after Favorites.
    const moved = editStoredHomeArrangement(before, { move: { from: 2, to: 0 } });
    assert.deepEqual(read(moved).shown, ["stats", "favorites", "karaoke", "most-played"]);
  });

  test("keeps an unknown section where it was when the one before it is removed", () => {
    const before = stored({
      shown: ["favorites", "karaoke", "stats"],
      hidden: [
        "new-releases",
        "upcoming-shows",
        "discover",
        "in-your-orbit",
        "from-your-library",
        "community-playlists",
        "recently-added",
        "recently-played",
        "most-played",
        "most-played-albums",
        "most-played-artists",
      ],
    });
    assert.deepEqual(read(editStoredHomeArrangement(before, { remove: "favorites" })).shown, [
      "karaoke",
      "stats",
    ]);
    assert.deepEqual(read(editStoredHomeArrangement(before, { remove: "stats" })).shown, [
      "favorites",
      "karaoke",
    ]);
  });

  test("keeps the unknown sections it hides, the unknown Discover rows and other fields", () => {
    const before = stored({
      shown: ["favorites"],
      hidden: [
        "new-releases",
        "upcoming-shows",
        "discover",
        "in-your-orbit",
        "from-your-library",
        "community-playlists",
        "recently-added",
        "recently-played",
        "most-played",
        "most-played-albums",
        "most-played-artists",
        "stats",
        "karaoke",
      ],
      discover: { shown: ["magic-queue", "mood-mixes", "genre-mixes"], hidden: ["artist-mixes"] },
      density: "compact",
    });
    const edited = read(editStoredHomeArrangement(before, { add: "stats" }));
    assert.deepEqual(edited.shown, ["favorites", "stats"]);
    assert.ok((edited.hidden as string[]).includes("karaoke"));
    assert.ok(!(edited.hidden as string[]).includes("stats"));
    assert.deepEqual(edited.discover, {
      shown: ["magic-queue", "mood-mixes", "genre-mixes"],
      hidden: ["artist-mixes"],
    });
    assert.equal(edited.density, "compact");
    const rows = read(editStoredHomeArrangement(before, { discover: { move: { from: 1, to: 0 } } }))
      .discover as { shown: string[] };
    assert.deepEqual(rows.shown, ["genre-mixes", "magic-queue", "mood-mixes"]);
  });

  test("keeps an unknown section even when the edit leaves the default order", () => {
    const base = parseHomeArrangement(null);
    const before = stored({
      shown: [...base.sections.filter((id) => id !== "stats"), "karaoke"],
      hidden: ["stats"],
    });
    const edited = editStoredHomeArrangement(before, { add: "stats" });
    assert.deepEqual(read(edited).shown, [
      ...base.sections.filter((id) => id !== "stats"),
      "karaoke",
      "stats",
    ]);
  });

  test("reads back as what the phone would store when nothing is unknown", () => {
    const before = storedHomeArrangement({
      sections: ["stats", "favorites"],
      discoverRows: ["genre-mixes"],
    });
    const edited = editStoredHomeArrangement(before, { discover: { add: "magic-queue" } });
    assert.equal(
      edited,
      storedHomeArrangement({
        sections: ["stats", "favorites"],
        discoverRows: ["genre-mixes", "magic-queue"],
      }),
    );
  });
});

describe("an edit sent to the process that keeps the arrangement", () => {
  test("is read when it names known sections, rows and whole positions", () => {
    assert.deepEqual(readHomeArrangementEdit({ remove: "stats" }), { remove: "stats" });
    assert.deepEqual(readHomeArrangementEdit({ add: "discover" }), { add: "discover" });
    assert.deepEqual(readHomeArrangementEdit({ move: { from: 2, to: 0 }, extra: 1 }), {
      move: { from: 2, to: 0 },
    });
    assert.deepEqual(readHomeArrangementEdit({ discover: { remove: "genre-mixes" } }), {
      discover: { remove: "genre-mixes" },
    });
    assert.deepEqual(readHomeArrangementEdit({ discover: { move: { from: 0, to: 1 } } }), {
      discover: { move: { from: 0, to: 1 } },
    });
  });

  test("is refused otherwise", () => {
    for (const value of [
      null,
      "remove",
      [],
      {},
      { remove: "karaoke" },
      { add: 3 },
      { add: "magic-queue" },
      { move: { from: -1, to: 0 } },
      { move: { from: 0.5, to: 0 } },
      { move: { from: 0 } },
      { move: { from: 0, to: 1e9 } },
      { discover: { add: "stats" } },
      { discover: null },
    ])
      assert.equal(readHomeArrangementEdit(value), null, JSON.stringify(value));
  });
});
