import { test } from "node:test";
import assert from "node:assert/strict";
import {
  followFeed,
  followLevelEntries,
  ticketmasterAttraction,
  ticketmasterShows,
} from "./index.ts";
import { readFileSync } from "node:fs";
const sample = JSON.parse(
  readFileSync(new URL("./fixtures/followShows.ticketmaster.json", import.meta.url), "utf8"),
);
test("Ticketmaster resolves only exact music attractions and parses usable shows", () => {
  assert.equal(ticketmasterAttraction(sample.attractions, "The Aurora"), "music");
  assert.equal(ticketmasterAttraction({}, "Aurora"), null);
  const shows = ticketmasterShows(sample.events, "aurora");
  assert.equal(shows?.length, 1);
  assert.equal(shows?.[0]?.city, "São Paulo");
  assert.equal(ticketmasterShows({ fault: {} }, "aurora"), null);
  assert.deepEqual(ticketmasterShows({ page: { totalElements: 0 } }, "aurora"), []);
});
const now = Date.parse("2026-11-01T00:00:00Z");
const follow = {
  key: "aurora",
  name: "Aurora",
  level: "shows" as const,
  followedAt: now,
  deezerId: null,
  ytBrowseId: null,
};
test("shows are future, country-specific and only for shows follows; notifications deduplicate", () => {
  const show = ticketmasterShows(sample.events, "aurora")![0]!;
  const earlier = { ...show, id: "earlier", startsAt: "2026-11-02T12:00:00Z" };
  const input = {
    follows: [follow],
    releases: [],
    hidden: [],
    countedPlays: [],
    now,
    country: "BR",
    shows: [
      show,
      earlier,
      show,
      { ...show, id: "foreign", country: "US" },
      { ...show, id: "past", startsAt: "2026-01-01" },
    ],
    notified: ["earlier"],
  };
  const feed = followFeed(input);
  assert.deepEqual(
    feed.showCards.map((s) => s.id),
    ["earlier", "show-1"],
  );
  assert.deepEqual(
    feed.toNotify.map((s) => s.id),
    ["show-1"],
  );
  assert.deepEqual(feed.artistShows["aurora"], feed.showCards);
  assert.deepEqual(
    followFeed({ ...input, follows: [{ ...follow, level: "releases" }] }).showCards,
    [],
  );
  assert.deepEqual(followFeed({ ...input, enabled: false }).toNotify, []);
  assert.deepEqual(
    followFeed({ ...input, country: "US" }).showCards.map((s) => s.id),
    ["foreign"],
  );
});
test("shows level requires a key and a country, and leaves the country to the country row", () => {
  assert.deepEqual(
    followLevelEntries(null).map((e) => e.action),
    ["releases"],
  );
  const entries = followLevelEntries("shows", {
    showsAvailable: true,
    country: "Brazil",
    notificationsDenied: true,
  });
  assert.equal(entries[1]?.label, "New music and shows");
  assert.equal(entries[1]?.checked, true);
  assert.equal(entries[1]?.line, "Notifications are off");
});
test("a shared show appears on each followed artist page and notifies once", () => {
  const show = ticketmasterShows(sample.events, "aurora")![0]!;
  const feed = followFeed({
    follows: [follow, { ...follow, key: "guest", name: "Guest" }],
    releases: [],
    hidden: [],
    countedPlays: [],
    now,
    country: "BR",
    shows: [show, { ...show, artistKey: "guest" }],
  });
  assert.equal(feed.showCards.length, 1);
  assert.equal(feed.toNotify.length, 1);
  assert.equal(feed.artistShows["guest"]?.[0]?.id, "show-1");
});
test("shows choices use the Portuguese catalogue", async () => {
  const { catalogueOf } = await import("./index.ts");
  const entries = followLevelEntries("shows", {
    showsAvailable: true,
    country: "Brasil",
    notificationsDenied: true,
    strings: catalogueOf("pt-BR"),
  });
  assert.equal(entries[1]?.label, "Novas músicas e shows");
  assert.equal(entries[1]?.line, "As notificações estão desativadas");
});
