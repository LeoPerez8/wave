import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  discoverRowTitle,
  catalogueOf,
  HOME_SECTIONS,
  hiddenDiscoverRows,
  editHomeArrangement as editArrangement,
  hiddenHomeSections as hiddenSections,
  homeItems as items,
  homeSectionTitle,
  parseHomeArrangement as parseArrangement,
  storedHomeArrangement as storeArrangement,
  type HomeArrangementEdit,
  type HomeSectionId,
} from "./index.ts";

// Section-only fixtures keep the legacy section migration cases readable.
type HomeArrangement = readonly HomeSectionId[];
const layout = (sections: HomeArrangement) => ({
  sections,
  discoverRows: ["magic-queue", "artist-mixes", "genre-mixes"] as const,
});
const parseHomeArrangement = (stored: string | null) => parseArrangement(stored).sections;
const storedHomeArrangement = (sections: HomeArrangement) => storeArrangement(layout(sections));
const editHomeArrangement = (sections: HomeArrangement, edit: HomeArrangementEdit) =>
  editArrangement(layout(sections), edit).sections;
const hiddenHomeSections = (sections: HomeArrangement) => hiddenSections(layout(sections));
const homeItems = (sections: HomeArrangement, options: Parameters<typeof items>[1]) =>
  items(layout(sections), options);

const TODAYS_HOME = [
  "new-releases",
  "upcoming-shows",
  "dj",
  "discover",
  "in-your-orbit",
  "from-your-library",
  "community-playlists",
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
        ["new-releases", "New from Artists You Follow"],
        ["upcoming-shows", "Upcoming Shows"],
        ["dj", "DJ"],
        ["discover", "Discover"],
        ["in-your-orbit", "In your orbit"],
        ["from-your-library", "From your library"],
        ["community-playlists", "Community playlists"],
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
    assert.equal(homeSectionTitle("dj"), "DJ");
    assert.equal(homeSectionTitle("dj", catalogueOf("pt-BR")), "DJ");
    assert.equal(homeSectionTitle("in-your-orbit"), "In your orbit");
    assert.equal(homeSectionTitle("in-your-orbit", catalogueOf("pt-BR")), "Na sua órbita");
    assert.equal(homeSectionTitle("from-your-library"), "From your library");
    assert.equal(homeSectionTitle("from-your-library", catalogueOf("pt-BR")), "Da sua biblioteca");
    assert.equal(homeSectionTitle("community-playlists"), "Community playlists");
    assert.equal(
      homeSectionTitle("community-playlists", catalogueOf("pt-BR")),
      "Playlists da comunidade",
    );
    assert.equal(homeSectionTitle("most-played-albums"), "Most played albums");
  });

  test("in Portuguese, sections and Discover's rows take the catalogue's titles", () => {
    const pt = catalogueOf("pt-BR");
    assert.equal(homeSectionTitle("recently-played", pt), "Tocadas recentemente");
    assert.equal(homeSectionTitle("stats", pt), "Estatísticas");
    assert.equal(homeSectionTitle("new-releases", pt), pt.newReleases.title);
    assert.deepEqual(
      (["magic-queue", "artist-mixes", "genre-mixes"] as const).map((id) =>
        discoverRowTitle(id, pt),
      ),
      ["Fila Mágica", "Mixes de artistas", "Mixes de gêneros"],
    );
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
      hidden: [
        "new-releases",
        "upcoming-shows",
        "dj",
        "recently-played",
        "most-played-albums",
        "discover",
        "in-your-orbit",
        "from-your-library",
        "community-playlists",
        "stats",
      ],
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
      "new-releases",
      "upcoming-shows",
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
      [
        "dj",
        "discover",
        "in-your-orbit",
        "from-your-library",
        "community-playlists",
        "favorites",
        "recently-added",
      ],
    );
    assert.deepEqual(parseHomeArrangement(arranged(["stats", "favorites"])), [
      "dj",
      "discover",
      "in-your-orbit",
      "from-your-library",
      "community-playlists",
      "stats",
      "favorites",
    ]);
    assert.deepEqual(parseHomeArrangement(arranged(["recently-added", "genre-mixes"])), [
      "dj",
      "discover",
      "in-your-orbit",
      "from-your-library",
      "community-playlists",
      "recently-added",
    ]);
  });

  test("Discover is first on a Home arranged while its mixes were Discover mixes", () => {
    const stored = JSON.stringify({
      shown: ["favorites", "discover-mixes", "recently-added"],
      hidden: [
        "new-releases",
        "upcoming-shows",
        "recently-played",
        "most-played",
        "most-played-albums",
        "most-played-artists",
        "stats",
      ],
    });
    assert.deepEqual(parseHomeArrangement(stored), [
      "dj",
      "discover",
      "in-your-orbit",
      "from-your-library",
      "community-playlists",
      "favorites",
      "recently-added",
    ]);
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

  describe("In your orbit joining a Home arranged before it", () => {
    // Saved by a Wave whose catalogue had no In your orbit.
    const before = TODAYS_HOME.filter((id) => id !== "in-your-orbit");
    const arranged = (shown: string[]) =>
      JSON.stringify({ shown, hidden: before.filter((id) => !shown.includes(id)) });

    test("it shows right after Discover, wherever the owner put Discover", () => {
      assert.deepEqual(parseHomeArrangement(arranged(["favorites", "discover", "stats"])), [
        "favorites",
        "discover",
        "in-your-orbit",
        "stats",
      ]);
    });

    test("with Discover removed, it follows the followed artists' sections, or goes on top", () => {
      assert.deepEqual(parseHomeArrangement(arranged(["stats", "upcoming-shows", "favorites"])), [
        "stats",
        "upcoming-shows",
        "in-your-orbit",
        "favorites",
      ]);
      assert.deepEqual(parseHomeArrangement(arranged(["stats"])), ["in-your-orbit", "stats"]);
    });

    test("it joins once: moved, it stays where it was dropped, and removed, it stays off", () => {
      const joined = parseArrangement(arranged(["favorites", "discover", "stats"]));
      const moved = editArrangement(joined, { move: { from: 2, to: 0 } });
      assert.deepEqual(parseArrangement(storeArrangement(moved)).sections, [
        "in-your-orbit",
        "favorites",
        "discover",
        "stats",
      ]);
      const removed = editArrangement(joined, { remove: "in-your-orbit" });
      assert.deepEqual(hiddenSections(removed).includes("in-your-orbit"), true);
      const stored = storeArrangement(removed);
      assert.deepEqual(parseArrangement(stored).sections, ["favorites", "discover", "stats"]);
      // Read and stored again, as on every later launch, it is still not added back.
      assert.deepEqual(parseArrangement(storeArrangement(parseArrangement(stored))).sections, [
        "favorites",
        "discover",
        "stats",
      ]);
    });
  });

  describe("From your library joining a Home arranged before it", () => {
    // Saved by a Wave whose catalogue had In your orbit and no From your library.
    const before = TODAYS_HOME.filter((id) => id !== "from-your-library");
    const arranged = (shown: string[], known: string[] = before) =>
      JSON.stringify({ shown, hidden: known.filter((id) => !shown.includes(id)) });

    test("it shows right after In your orbit, wherever the owner put In your orbit", () => {
      assert.deepEqual(
        parseHomeArrangement(arranged(["favorites", "in-your-orbit", "discover", "stats"])),
        ["favorites", "in-your-orbit", "from-your-library", "discover", "stats"],
      );
    });

    test("with In your orbit removed, it follows Discover, or the nearest section before it", () => {
      assert.deepEqual(parseHomeArrangement(arranged(["favorites", "discover", "stats"])), [
        "favorites",
        "discover",
        "from-your-library",
        "stats",
      ]);
      assert.deepEqual(parseHomeArrangement(arranged(["stats", "upcoming-shows"])), [
        "stats",
        "upcoming-shows",
        "from-your-library",
      ]);
      assert.deepEqual(parseHomeArrangement(arranged(["stats"])), ["from-your-library", "stats"]);
    });

    test("a Home arranged before both sections gets them after Discover, In your orbit first", () => {
      const older = before.filter((id) => id !== "in-your-orbit");
      assert.deepEqual(parseHomeArrangement(arranged(["favorites", "discover", "stats"], older)), [
        "favorites",
        "discover",
        "in-your-orbit",
        "from-your-library",
        "stats",
      ]);
    });

    test("it joins once: moved, it stays where it was dropped, and removed, it stays off", () => {
      const joined = parseArrangement(arranged(["favorites", "in-your-orbit", "stats"]));
      assert.deepEqual(joined.sections, [
        "favorites",
        "in-your-orbit",
        "from-your-library",
        "stats",
      ]);
      const moved = editArrangement(joined, { move: { from: 2, to: 0 } });
      assert.deepEqual(parseArrangement(storeArrangement(moved)).sections, [
        "from-your-library",
        "favorites",
        "in-your-orbit",
        "stats",
      ]);
      const removed = editArrangement(joined, { remove: "from-your-library" });
      assert.deepEqual(hiddenSections(removed).includes("from-your-library"), true);
      const stored = storeArrangement(removed);
      assert.deepEqual(parseArrangement(stored).sections, ["favorites", "in-your-orbit", "stats"]);
      // Read and stored again, as on every later launch, it is still not added back.
      assert.deepEqual(parseArrangement(storeArrangement(parseArrangement(stored))).sections, [
        "favorites",
        "in-your-orbit",
        "stats",
      ]);
      // Added back in Home's editor, it joins at the bottom like any other section.
      assert.deepEqual(editArrangement(removed, { add: "from-your-library" }).sections, [
        "favorites",
        "in-your-orbit",
        "stats",
        "from-your-library",
      ]);
    });
  });

  describe("Community playlists joining a Home arranged before it", () => {
    // Saved by a Wave whose catalogue had From your library and no Community playlists.
    const before = TODAYS_HOME.filter((id) => id !== "community-playlists");
    const arranged = (shown: string[], known: string[] = before) =>
      JSON.stringify({ shown, hidden: known.filter((id) => !shown.includes(id)) });

    test("it shows right after From your library, wherever the owner put From your library", () => {
      assert.deepEqual(
        parseHomeArrangement(arranged(["favorites", "from-your-library", "discover", "stats"])),
        ["favorites", "from-your-library", "community-playlists", "discover", "stats"],
      );
    });

    test("with From your library removed, it follows Discover, not In your orbit", () => {
      assert.deepEqual(
        parseHomeArrangement(arranged(["discover", "favorites", "in-your-orbit", "stats"])),
        ["discover", "community-playlists", "favorites", "in-your-orbit", "stats"],
      );
    });

    test("with Discover removed too, it follows the nearest section before it, or goes on top", () => {
      assert.deepEqual(parseHomeArrangement(arranged(["stats", "in-your-orbit", "favorites"])), [
        "stats",
        "in-your-orbit",
        "community-playlists",
        "favorites",
      ]);
      assert.deepEqual(parseHomeArrangement(arranged(["stats", "upcoming-shows"])), [
        "stats",
        "upcoming-shows",
        "community-playlists",
      ]);
      assert.deepEqual(parseHomeArrangement(arranged(["stats"])), ["community-playlists", "stats"]);
    });

    test("a Home arranged before all three gets them after Discover, in catalogue order", () => {
      const older = before.filter((id) => id !== "in-your-orbit" && id !== "from-your-library");
      assert.deepEqual(parseHomeArrangement(arranged(["favorites", "discover", "stats"], older)), [
        "favorites",
        "discover",
        "in-your-orbit",
        "from-your-library",
        "community-playlists",
        "stats",
      ]);
    });

    test("it joins once: moved, it stays where it was dropped, and removed, it stays off", () => {
      const joined = parseArrangement(arranged(["favorites", "from-your-library", "stats"]));
      assert.deepEqual(joined.sections, [
        "favorites",
        "from-your-library",
        "community-playlists",
        "stats",
      ]);
      const moved = editArrangement(joined, { move: { from: 2, to: 0 } });
      assert.deepEqual(parseArrangement(storeArrangement(moved)).sections, [
        "community-playlists",
        "favorites",
        "from-your-library",
        "stats",
      ]);
      const removed = editArrangement(joined, { remove: "community-playlists" });
      assert.deepEqual(hiddenSections(removed).includes("community-playlists"), true);
      const stored = storeArrangement(removed);
      const kept = ["favorites", "from-your-library", "stats"];
      assert.deepEqual(parseArrangement(stored).sections, kept);
      // Read and stored again, as on every later launch, it is still not added back.
      assert.deepEqual(parseArrangement(storeArrangement(parseArrangement(stored))).sections, kept);
    });
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
      ...sections("new-releases", "upcoming-shows", "dj", "discover"),
      "play-hint",
      ...sections(
        "in-your-orbit",
        "from-your-library",
        "community-playlists",
        "recently-added",
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

  test("with an empty Library, Home lists online sections under its empty state when arranged", () => {
    const empty = { nothingPlayed: true, empty: true };
    assert.deepEqual(
      homeItems(TODAYS_HOME as HomeArrangement, empty),
      sections("new-releases", "upcoming-shows", "dj", "discover", "community-playlists"),
    );
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
      "new-releases",
      "upcoming-shows",
      "dj",
      "discover",
      "in-your-orbit",
      "from-your-library",
      "community-playlists",
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
      "new-releases",
      "upcoming-shows",
      "dj",
      "discover",
      "in-your-orbit",
      "from-your-library",
      "community-playlists",
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

describe("Discover row arrangement", () => {
  test("fresh and older arrangements show every Discover row in default order", () => {
    for (const stored of [null, storeArrangement(layout(["stats"]))]) {
      assert.deepEqual(parseArrangement(stored).discoverRows, [
        "magic-queue",
        "artist-mixes",
        "genre-mixes",
      ]);
    }
  });
});

test("Discover rows move within Discover, remove until one remains, and add at the end", () => {
  const initial = parseArrangement(null);
  const moved = editArrangement(initial, { discover: { move: { from: 2, to: 0 } } });
  assert.deepEqual(moved.discoverRows, ["genre-mixes", "magic-queue", "artist-mixes"]);
  assert.deepEqual(moved.sections, initial.sections);
  const removed = editArrangement(moved, { discover: { remove: "magic-queue" } });
  assert.deepEqual(removed.discoverRows, ["genre-mixes", "artist-mixes"]);
  assert.deepEqual(hiddenDiscoverRows(removed), ["magic-queue"]);
  const last = editArrangement(removed, { discover: { remove: "artist-mixes" } });
  assert.deepEqual(editArrangement(last, { discover: { remove: "genre-mixes" } }), last);
  const added = editArrangement(last, { discover: { add: "magic-queue" } });
  assert.deepEqual(added.discoverRows, ["genre-mixes", "magic-queue"]);
  assert.deepEqual(editArrangement(added, { discover: { add: "magic-queue" } }), added);
  assert.deepEqual(initial.discoverRows, ["magic-queue", "artist-mixes", "genre-mixes"]);
});

test("Done stores rows with sections, keeping them while Discover is removed and added back", () => {
  const changed = editArrangement(parseArrangement(null), { discover: { remove: "artist-mixes" } });
  const hidden = editArrangement(changed, { remove: "discover" });
  const restored = parseArrangement(storeArrangement(hidden));
  assert.deepEqual(restored, hidden);
  assert.deepEqual(editArrangement(restored, { add: "discover" }).discoverRows, [
    "magic-queue",
    "genre-mixes",
  ]);
  assert.notEqual(storeArrangement(changed), null);
});

const storedRows = (discover: unknown) => JSON.stringify({ shown: ["discover"], discover });

test("stored Discover rows drop unknowns and duplicates and restore missing rows in default place", () => {
  assert.deepEqual(
    parseArrangement(
      storedRows({ shown: ["genre-mixes", "genre-mixes", "junk", null], hidden: ["artist-mixes"] }),
    ).discoverRows,
    ["magic-queue", "genre-mixes"],
  );
  assert.deepEqual(
    parseArrangement(storedRows({ shown: ["genre-mixes", "magic-queue"] })).discoverRows,
    ["genre-mixes", "magic-queue", "artist-mixes"],
  );
  assert.deepEqual(
    parseArrangement(
      storedRows({ shown: [], hidden: ["magic-queue", "artist-mixes", "genre-mixes"] }),
    ).discoverRows,
    ["magic-queue", "artist-mixes", "genre-mixes"],
  );
  for (const discover of [null, [], "bad", { shown: "bad" }]) {
    assert.deepEqual(parseArrangement(storedRows(discover)).discoverRows, [
      "magic-queue",
      "artist-mixes",
      "genre-mixes",
    ]);
  }
});

test("a reordered Discover survives saving with the default section order", () => {
  const initial = parseArrangement(null);
  const moved = editArrangement(initial, { discover: { move: { from: 2, to: 0 } } });
  assert.deepEqual(parseArrangement(storeArrangement(moved)).discoverRows, [
    "genre-mixes",
    "magic-queue",
    "artist-mixes",
  ]);
  const restored = editArrangement(moved, { discover: { move: { from: 0, to: 2 } } });
  assert.equal(storeArrangement(restored), null);
});

test("new releases join an existing Home and can be moved or hidden even with an empty Library", () => {
  const old = JSON.stringify({
    shown: ["favorites"],
    hidden: HOME_SECTIONS.filter((s) => s.id !== "favorites" && s.id !== "new-releases").map(
      (s) => s.id,
    ),
  });
  assert.deepEqual(parseHomeArrangement(old), ["new-releases", "favorites"]);
  const moved = editHomeArrangement(["new-releases", "discover"], { move: { from: 0, to: 1 } });
  assert.deepEqual(moved, ["discover", "new-releases"]);
  assert.deepEqual(
    parseHomeArrangement(
      storedHomeArrangement(editHomeArrangement(moved, { remove: "new-releases" })),
    ),
    ["discover"],
  );
});

test("Upcoming Shows joins an existing Home after New releases, and can be moved or hidden", () => {
  // Saved by a Wave whose catalogue had New releases and no Upcoming Shows.
  const old = JSON.stringify({
    shown: ["favorites", "new-releases", "stats"],
    hidden: HOME_SECTIONS.filter(
      (s) => !["favorites", "new-releases", "stats", "upcoming-shows"].includes(s.id),
    ).map((s) => s.id),
  });

  assert.deepEqual(parseHomeArrangement(old), [
    "favorites",
    "new-releases",
    "upcoming-shows",
    "stats",
  ]);
  const moved = editHomeArrangement(["upcoming-shows", "discover"], { move: { from: 0, to: 1 } });
  assert.deepEqual(moved, ["discover", "upcoming-shows"]);
  const removed = editHomeArrangement(moved, { remove: "upcoming-shows" });
  assert.deepEqual(parseHomeArrangement(storedHomeArrangement(removed)), ["discover"]);
  assert.deepEqual(hiddenHomeSections(removed).slice(0, 2), ["new-releases", "upcoming-shows"]);
  assert.deepEqual(editHomeArrangement(removed, { add: "upcoming-shows" }), [
    "discover",
    "upcoming-shows",
  ]);
});

test("DJ joins saved Homes immediately before Discover, even when Discover was hidden", () => {
  const old = JSON.stringify({
    shown: ["favorites", "discover", "stats"],
    hidden: HOME_SECTIONS.filter(
      (section) => section.id !== "dj" && !["favorites", "discover", "stats"].includes(section.id),
    ).map((section) => section.id),
  });
  assert.deepEqual(parseHomeArrangement(old), ["favorites", "dj", "discover", "stats"]);

  const discoverHidden = JSON.stringify({
    shown: ["favorites", "stats"],
    hidden: HOME_SECTIONS.filter(
      (section) => section.id !== "dj" && !["favorites", "stats"].includes(section.id),
    ).map((section) => section.id),
  });
  assert.deepEqual(parseHomeArrangement(discoverHidden), ["dj", "favorites", "stats"]);
});

test("DJ can be removed, restored at the bottom, and moved independently of Discover", () => {
  const original = parseArrangement(null);
  const removed = editArrangement(original, { remove: "dj" });
  assert.equal(removed.sections.includes("dj"), false);
  assert.equal(hiddenSections(removed).includes("dj"), true);

  const restored = editArrangement(removed, { add: "dj" });
  assert.equal(restored.sections.at(-1), "dj");
  const moved = editArrangement(restored, {
    move: { from: restored.sections.length - 1, to: 1 },
  });
  assert.deepEqual(moved.sections.slice(0, 3), ["new-releases", "dj", "upcoming-shows"]);
  assert.deepEqual(moved.discoverRows, original.discoverRows);
});

test("Upcoming Shows needs no Library: an empty Library still lists it when arranged", () => {
  assert.deepEqual(
    homeItems(["favorites", "upcoming-shows"], { nothingPlayed: true, empty: true }),
    [{ section: "upcoming-shows" }],
  );
});

test("Upcoming Shows is titled in the interface's language", () => {
  assert.equal(homeSectionTitle("upcoming-shows"), "Upcoming Shows");
  assert.equal(homeSectionTitle("upcoming-shows", catalogueOf("pt-BR")), "Próximos Shows");
});
