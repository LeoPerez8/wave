import { test } from "node:test";
import assert from "node:assert/strict";
import { catalogueOf, followIconLegend, followLevelIcons } from "./index.ts";

test("a followed artist's row shows both levels, its own filled, and Unfollow outlined", () => {
  assert.deepEqual(
    followLevelIcons("shows", { artist: "Beyoncé", showsAvailable: true, country: "Brazil" }),
    [
      {
        action: "releases",
        filled: false,
        accessibilityLabel: "New releases, Beyoncé",
      },
      {
        action: "shows",
        filled: true,
        accessibilityLabel: "New releases and shows in Brazil, Beyoncé",
      },
      { action: "unfollow", filled: false, accessibilityLabel: "Unfollow, Beyoncé" },
    ],
  );
});

test("an artist the owner doesn't follow shows the two levels, neither filled, and no Unfollow", () => {
  assert.deepEqual(
    followLevelIcons(null, { artist: "Aurora", showsAvailable: true, country: "Brazil" }).map(
      (icon) => [icon.action, icon.filled],
    ),
    [
      ["releases", false],
      ["shows", false],
    ],
  );
});

test("without Ticketmaster's key or a country there's no ticket icon", () => {
  assert.deepEqual(
    followLevelIcons("releases", { artist: "Aurora" }).map((icon) => [icon.action, icon.filled]),
    [
      ["releases", true],
      ["unfollow", false],
    ],
  );
  assert.deepEqual(
    followLevelIcons(null, { artist: "Aurora", showsAvailable: true, country: "" }).map(
      (icon) => icon.action,
    ),
    ["releases"],
  );
});

test("the legend says what each icon does, the ticket's line only with Ticketmaster's key", () => {
  assert.deepEqual(followIconLegend({ showsAvailable: true, country: "Brazil" }), [
    { action: "releases", label: "New releases" },
    { action: "shows", label: "New releases and shows in Brazil" },
    { action: "unfollow", label: "Unfollow" },
  ]);
  assert.deepEqual(
    followIconLegend({ showsAvailable: false, country: "Brazil" }).map((line) => line.label),
    ["New releases", "Unfollow"],
  );
});

test("the icons and legend read in Portuguese", () => {
  const strings = catalogueOf("pt-BR");
  assert.deepEqual(
    followIconLegend({ showsAvailable: true, country: "Brasil", strings }).map((l) => l.label),
    ["Novos lançamentos", "Novos lançamentos e shows em Brasil", "Deixar de Seguir"],
  );
  assert.deepEqual(
    followLevelIcons("releases", { artist: "Aurora", strings }).map((i) => i.accessibilityLabel),
    ["Novos lançamentos, Aurora", "Deixar de Seguir, Aurora"],
  );
});
