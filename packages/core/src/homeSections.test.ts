import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  HOME_SECTIONS,
  editHomeArrangement,
  hiddenHomeSections,
  homeItems,
  homeSectionTitle,
  parseHomeArrangement,
  storedHomeArrangement,
  type HomeArrangement,
  type HomeSectionId,
} from "./index.ts";

const TODAYS_HOME = [
  "discover",
  "recently-added",
  "recently-played",
  "most-played",
  "most-played-albums",
  "most-played-artists",
  "favorites",
  "stats",
];

const sections = (...ids: HomeSectionId[]) => ids.map((id) => ({ section: id }));

describe("Home's section catalogue", () => {
  test("lists every section Home can show, in today's order, each with its title", () => {
    assert.deepEqual(
      HOME_SECTIONS.map(({ id, title }) => [id, title]),
      [
        ["discover", "Discover"],
        ["recently-added", "Recently added"],
        ["recently-played", "Recently played"],
        ["most-played", "Most played"],
        ["most-played-albums", "Most played albums"],
        ["most-played-artists", "Most played artists"],
        ["favorites", "Favorites"],
        ["stats", "Stats"],
      ],
    );
  });

  test("a section's title is found by its id", () => {
    assert.equal(homeSectionTitle("most-played-albums"), "Most played albums");
  });
});

describe("Home's arrangement", () => {
  test("a fresh install (nothing stored) shows every section in today's order", () => {
    assert.deepEqual(parseHomeArrangement(null), TODAYS_HOME);
  });

  test("an arrangement the owner saved reads back as itself: order, removals and all", () => {
    const arrangements: HomeArrangement[] = [
      ["favorites", "recently-added", "stats"],
      ["stats", "most-played"],
      TODAYS_HOME.toReversed() as HomeArrangement,
      [],
    ];
    for (const arrangement of arrangements) {
      assert.deepEqual(parseHomeArrangement(storedHomeArrangement(arrangement)), arrangement);
    }
  });

  test("ids this Wave doesn't know (a section since dropped, junk) are left out", () => {
    const stored = JSON.stringify({
      shown: ["favorites", "radio", 7, null, "stats"],
      hidden: [...TODAYS_HOME.filter((id) => id !== "favorites" && id !== "stats"), "radio"],
    });
    assert.deepEqual(parseHomeArrangement(stored), ["favorites", "stats"]);
  });

  test("a section listed twice shows once, where it first appears", () => {
    const stored = JSON.stringify({
      shown: ["stats", "favorites", "stats"],
      hidden: TODAYS_HOME.filter((id) => id !== "favorites" && id !== "stats"),
    });
    assert.deepEqual(parseHomeArrangement(stored), ["stats", "favorites"]);
  });

  test("a section new since the owner saved shows, after the section it follows in the catalogue", () => {
    // Saved by a Wave whose catalogue had no Most played artists.
    const stored = JSON.stringify({
      shown: ["favorites", "most-played", "recently-added"],
      hidden: ["recently-played", "most-played-albums", "discover", "stats"],
    });
    assert.deepEqual(parseHomeArrangement(stored), [
      "favorites",
      "most-played",
      "most-played-artists",
      "recently-added",
    ]);
  });

  test("Discover takes the place of the Magic Queue and both mix sections, first on any Home arranged before it", () => {
    // Saved by a Wave whose catalogue had the three sections and no Discover.
    const before = [
      "recently-added",
      "recently-played",
      "most-played",
      "most-played-albums",
      "most-played-artists",
      "magic-queue",
      "artist-mixes",
      "genre-mixes",
      "favorites",
      "stats",
    ];
    const arranged = (shown: string[]) =>
      JSON.stringify({ shown, hidden: before.filter((id) => !shown.includes(id)) });
    assert.deepEqual(
      parseHomeArrangement(
        arranged(["favorites", "artist-mixes", "recently-added", "magic-queue"]),
      ),
      ["discover", "favorites", "recently-added"],
    );
    assert.deepEqual(parseHomeArrangement(arranged(["stats", "favorites"])), [
      "discover",
      "stats",
      "favorites",
    ]);
    assert.deepEqual(parseHomeArrangement(arranged(["recently-added", "genre-mixes"])), [
      "discover",
      "recently-added",
    ]);
  });

  test("Discover is first on a Home arranged while its mixes were Discover mixes", () => {
    const stored = JSON.stringify({
      shown: ["favorites", "discover-mixes", "recently-added"],
      hidden: [
        "recently-played",
        "most-played",
        "most-played-albums",
        "most-played-artists",
        "stats",
      ],
    });
    assert.deepEqual(parseHomeArrangement(stored), ["discover", "favorites", "recently-added"]);
  });

  test("once Discover is on a Home, it stays where the owner moved it, or off when hidden", () => {
    const moved: HomeArrangement = ["favorites", "discover", "stats"];
    assert.deepEqual(parseHomeArrangement(storedHomeArrangement(moved)), moved);
    const hidden: HomeArrangement = ["favorites", "stats"];
    assert.deepEqual(parseHomeArrangement(storedHomeArrangement(hidden)), hidden);
  });

  test("a new section that no shown section comes before in the catalogue goes on top", () => {
    const stored = JSON.stringify({
      shown: ["stats"],
      hidden: TODAYS_HOME.filter((id) => id !== "stats" && id !== "most-played"),
    });
    assert.deepEqual(parseHomeArrangement(stored), ["most-played", "stats"]);
  });

  test("a section the owner removed stays off Home", () => {
    const stored = storedHomeArrangement(["stats"]);
    assert.deepEqual(parseHomeArrangement(stored), ["stats"]);
  });

  test("anything unreadable stored reads as today's Home", () => {
    for (const stored of ["", "not json", "[]", '"stats"', "{}", '{"shown":"stats"}']) {
      assert.deepEqual(parseHomeArrangement(stored), TODAYS_HOME, stored);
    }
  });

  test("today's Home is stored as nothing", () => {
    assert.equal(storedHomeArrangement(TODAYS_HOME as HomeArrangement), null);
  });
});

describe("what Home lists", () => {
  test("once something is played, Home lists its sections as arranged", () => {
    assert.deepEqual(
      homeItems(["favorites", "most-played", "stats"], { nothingPlayed: false }),
      sections("favorites", "most-played", "stats"),
    );
  });

  test("with nothing played, the line asking for a play comes before the first section plays fill", () => {
    assert.deepEqual(homeItems(TODAYS_HOME as HomeArrangement, { nothingPlayed: true }), [
      ...sections("discover", "recently-added"),
      "play-hint",
      ...sections(
        "recently-played",
        "most-played",
        "most-played-albums",
        "most-played-artists",
        "favorites",
        "stats",
      ),
    ]);
    assert.deepEqual(homeItems(["most-played-artists", "favorites"], { nothingPlayed: true }), [
      "play-hint",
      ...sections("most-played-artists", "favorites"),
    ]);
  });

  test("with an empty Library, Home lists only Discover, under its empty state, when arranged", () => {
    const empty = { nothingPlayed: true, empty: true };
    assert.deepEqual(homeItems(TODAYS_HOME as HomeArrangement, empty), sections("discover"));
    assert.deepEqual(homeItems(["favorites", "stats"], empty), []);
    assert.deepEqual(homeItems([], empty), []);
  });

  test("with nothing played and no section plays fill, there's no line asking for a play", () => {
    assert.deepEqual(
      homeItems(["favorites", "recently-added", "stats"], {
        nothingPlayed: true,
      }),
      sections("favorites", "recently-added", "stats"),
    );
  });

  test("with nothing played, Discover doesn't wait for a play (the Library seeds it)", () => {
    assert.deepEqual(homeItems(["favorites", "discover"], { nothingPlayed: true }), [
      ...sections("favorites", "discover"),
    ]);
    assert.deepEqual(homeItems(["discover", "most-played"], { nothingPlayed: true }), [
      { section: "discover" },
      "play-hint",
      { section: "most-played" },
    ]);
  });

  test("with every section removed, Home says how to add them back", () => {
    assert.deepEqual(homeItems([], { nothingPlayed: true }), ["no-sections"]);
    assert.deepEqual(homeItems([], { nothingPlayed: false }), ["no-sections"]);
  });
});

describe("Home's editor", () => {
  test("lists the sections Home doesn't show in catalogue order", () => {
    assert.deepEqual(hiddenHomeSections(["stats", "favorites", "recently-added", "most-played"]), [
      "discover",
      "recently-played",
      "most-played-albums",
      "most-played-artists",
    ]);
    assert.deepEqual(hiddenHomeSections(TODAYS_HOME as HomeArrangement), []);
  });

  test("removing a section takes it off Home, the rest keeping their order", () => {
    assert.deepEqual(
      editHomeArrangement(["stats", "favorites", "most-played"], { remove: "favorites" }),
      ["stats", "most-played"],
    );
  });

  test("adding a section puts it at the bottom of Home", () => {
    assert.deepEqual(editHomeArrangement(["stats", "favorites"], { add: "recently-added" }), [
      "stats",
      "favorites",
      "recently-added",
    ]);
  });

  test("adding a section Home already shows changes nothing", () => {
    assert.deepEqual(editHomeArrangement(["stats", "favorites"], { add: "stats" }), [
      "stats",
      "favorites",
    ]);
  });

  test("dragging a section moves it to where it's dropped", () => {
    const arrangement: HomeArrangement = ["recently-added", "most-played", "favorites", "stats"];
    assert.deepEqual(editHomeArrangement(arrangement, { move: { from: 3, to: 0 } }), [
      "stats",
      "recently-added",
      "most-played",
      "favorites",
    ]);
    assert.deepEqual(editHomeArrangement(arrangement, { move: { from: 0, to: 2 } }), [
      "most-played",
      "favorites",
      "recently-added",
      "stats",
    ]);
  });
});

describe("merging Home's Stats and Listening overview", () => {
  test("Stats keeps the first shown section's place when both were shown", () => {
    const hidden = [
      "discover",
      "recently-played",
      "most-played",
      "most-played-albums",
      "most-played-artists",
    ];
    for (const pair of [
      ["stats", "listening-overview"],
      ["listening-overview", "stats"],
    ]) {
      const shown = ["favorites", pair[0], "recently-added", pair[1]];
      assert.deepEqual(parseHomeArrangement(JSON.stringify({ shown, hidden })), [
        "favorites",
        "stats",
        "recently-added",
      ]);
    }
  });
});

test("merged Stats is visible if either old section was shown, and hidden if both were hidden", () => {
  const legacy = [...HOME_SECTIONS.map(({ id }) => id), "listening-overview"];
  for (const shown of [
    ["favorites", "stats"],
    ["favorites", "listening-overview"],
    ["favorites"],
    [],
  ]) {
    const arrangement = parseHomeArrangement(
      JSON.stringify({
        shown,
        hidden: legacy.filter((id) => !shown.includes(id)),
      }),
    );
    assert.deepEqual(arrangement, shown.length > 1 ? ["favorites", "stats"] : shown);
    assert.deepEqual(parseHomeArrangement(storedHomeArrangement(arrangement)), arrangement);
  }
});
