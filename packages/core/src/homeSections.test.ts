import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  HOME_SECTIONS,
  editHomeArrangement,
  hiddenHomeSections,
  homeItems,
  homeSectionNote,
  homeSectionTitle,
  parseHomeArrangement,
  storedHomeArrangement,
  type HomeArrangement,
  type HomeSectionId,
} from "./index.ts";

const TODAYS_HOME = [
  "recently-added",
  "recently-played",
  "most-played",
  "most-played-albums",
  "most-played-artists",
  "discover-mixes",
  "favorites",
  "stats",
  "listening-overview",
];

const sections = (...ids: HomeSectionId[]) => ids.map((id) => ({ section: id }));

describe("Home's section catalogue", () => {
  test("lists every section Home can show, in today's order, each with its title", () => {
    assert.deepEqual(
      HOME_SECTIONS.map(({ id, title }) => [id, title]),
      [
        ["recently-added", "Recently added"],
        ["recently-played", "Recently played"],
        ["most-played", "Most played"],
        ["most-played-albums", "Most played albums"],
        ["most-played-artists", "Most played artists"],
        ["discover-mixes", "Discover mixes"],
        ["favorites", "Favorites"],
        ["stats", "Stats"],
        ["listening-overview", "Listening overview"],
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
      ["listening-overview", "most-played"],
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
    // Saved by a Wave whose catalogue had no Listening overview.
    const stored = JSON.stringify({
      shown: ["favorites", "most-played", "recently-added"],
      hidden: [
        "recently-played",
        "most-played-albums",
        "most-played-artists",
        "discover-mixes",
        "stats",
      ],
    });
    assert.deepEqual(parseHomeArrangement(stored), [
      "favorites",
      "listening-overview",
      "most-played",
      "recently-added",
    ]);
  });

  test("Discover mixes joins a Home arranged before it, after Most played artists", () => {
    const stored = JSON.stringify({
      shown: ["favorites", "most-played-artists", "recently-added"],
      hidden: [
        "recently-played",
        "most-played",
        "most-played-albums",
        "stats",
        "listening-overview",
      ],
    });
    assert.deepEqual(parseHomeArrangement(stored), [
      "favorites",
      "most-played-artists",
      "discover-mixes",
      "recently-added",
    ]);
  });

  test("a new section that no shown section comes before in the catalogue goes on top", () => {
    const stored = JSON.stringify({
      shown: ["stats"],
      hidden: TODAYS_HOME.filter((id) => id !== "stats" && id !== "recently-added"),
    });
    assert.deepEqual(parseHomeArrangement(stored), ["recently-added", "stats"]);
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
      homeItems(["favorites", "most-played", "stats"], { nothingPlayed: false, ytMusic: true }),
      sections("favorites", "most-played", "stats"),
    );
  });

  test("with nothing played, the line asking for a play comes before the first section plays fill", () => {
    assert.deepEqual(
      homeItems(TODAYS_HOME as HomeArrangement, { nothingPlayed: true, ytMusic: true }),
      [
        { section: "recently-added" },
        "play-hint",
        ...sections(
          "recently-played",
          "most-played",
          "most-played-albums",
          "most-played-artists",
          "discover-mixes",
          "favorites",
          "stats",
          "listening-overview",
        ),
      ],
    );
    assert.deepEqual(
      homeItems(["most-played-artists", "favorites"], { nothingPlayed: true, ytMusic: true }),
      ["play-hint", ...sections("most-played-artists", "favorites")],
    );
  });

  test("with nothing played and no section plays fill, there's no line asking for a play", () => {
    assert.deepEqual(
      homeItems(["favorites", "recently-added", "stats", "listening-overview"], {
        nothingPlayed: true,
        ytMusic: true,
      }),
      sections("favorites", "recently-added", "stats", "listening-overview"),
    );
  });

  test("with YT Music off, sections that need it aren't listed", () => {
    assert.deepEqual(
      homeItems(["favorites", "discover-mixes", "stats"], { nothingPlayed: false, ytMusic: false }),
      sections("favorites", "stats"),
    );
    assert.deepEqual(
      homeItems(["discover-mixes", "favorites", "most-played"], {
        nothingPlayed: true,
        ytMusic: false,
      }),
      [{ section: "favorites" }, "play-hint", { section: "most-played" }],
    );
  });

  test("with YT Music on and nothing played, Discover mixes doesn't wait for a play (the Library seeds it)", () => {
    assert.deepEqual(
      homeItems(["favorites", "discover-mixes"], { nothingPlayed: true, ytMusic: true }),
      sections("favorites", "discover-mixes"),
    );
    assert.deepEqual(
      homeItems(["discover-mixes", "most-played"], { nothingPlayed: true, ytMusic: true }),
      [{ section: "discover-mixes" }, "play-hint", { section: "most-played" }],
    );
  });

  test("with every section removed, Home says how to add them back", () => {
    assert.deepEqual(homeItems([], { nothingPlayed: true, ytMusic: true }), ["no-sections"]);
    assert.deepEqual(homeItems([], { nothingPlayed: false, ytMusic: true }), ["no-sections"]);
  });
});

describe("Home's editor", () => {
  test("lists the sections Home doesn't show in catalogue order", () => {
    assert.deepEqual(hiddenHomeSections(["stats", "favorites", "recently-added", "most-played"]), [
      "recently-played",
      "most-played-albums",
      "most-played-artists",
      "discover-mixes",
      "listening-overview",
    ]);
    assert.deepEqual(hiddenHomeSections(TODAYS_HOME as HomeArrangement), []);
  });

  test("says which sections show only with YT Music on, while it's off", () => {
    assert.equal(homeSectionNote("discover-mixes", { ytMusic: false }), "Needs YT Music");
    assert.equal(homeSectionNote("discover-mixes", { ytMusic: true }), null);
    assert.equal(homeSectionNote("favorites", { ytMusic: false }), null);
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
