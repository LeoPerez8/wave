import { test } from "node:test";
import assert from "node:assert/strict";
import {
  catalogueOf,
  FOLLOW_SUGGESTIONS_PAGE,
  followArtistKey,
  followSuggestions,
  followSuggestionsWindow,
} from "./index.ts";

const played = (name: string, countedPlays: number) => ({ name, countedPlays, item: name });

test("artists played in the last 90 days come first, most played first, saying how often", () => {
  const { suggestions } = followSuggestions({
    recent: [played("Aurora", 3), played("Beyoncé", 42)],
    allTime: [played("Aurora", 50), played("Beyoncé", 60)],
    excluded: [],
    shown: 5,
  });
  assert.deepEqual(
    suggestions.map((suggestion) => [suggestion.name, suggestion.line]),
    [
      ["Beyoncé", "42 plays in the last 90 days"],
      ["Aurora", "3 plays in the last 90 days"],
    ],
  );
});

test("after the 90-day artists come the rest, by all-time plays, saying how often in all", () => {
  const { suggestions } = followSuggestions({
    recent: [played("Aurora", 3)],
    allTime: [played("Aurora", 50), played("Björk", 12), played("Cher", 80)],
    excluded: [],
    shown: 5,
  });
  assert.deepEqual(
    suggestions.map((suggestion) => [suggestion.name, suggestion.line]),
    [
      ["Aurora", "3 plays in the last 90 days"],
      ["Cher", "80 plays"],
      ["Björk", "12 plays"],
    ],
  );
});

test("followed artists, stand-ins for no artist and names without letters are never suggested", () => {
  const { suggestions } = followSuggestions({
    recent: [played("The Beatles", 9), played("Various Artists", 8), played("Aurora", 1)],
    allTime: [
      played("Unknown Artist", 30),
      played("???", 20),
      played("1999", 15),
      played("Beatles", 40),
      played("Björk", 2),
    ],
    excluded: [followArtistKey("Beatles")],
    shown: 5,
  });
  assert.deepEqual(
    suggestions.map((suggestion) => suggestion.name),
    ["Aurora", "Björk"],
  );
});

test("artists with as many plays go by name", () => {
  const { suggestions } = followSuggestions({
    recent: [played("cher", 4), played("The Beatles", 4), played("Áurea", 4)],
    allTime: [played("Zélia", 7), played("Elis", 7)],
    excluded: [],
    shown: 5,
  });
  assert.deepEqual(
    suggestions.map((suggestion) => suggestion.name),
    ["Áurea", "The Beatles", "cher", "Elis", "Zélia"],
  );
});

test("namesakes Stats lists apart (a Library artist and an online one) are one suggestion", () => {
  const { suggestions } = followSuggestions({
    recent: [
      { name: "AURORA", countedPlays: 2, item: "online" },
      { name: "Aurora", countedPlays: 5, item: "library" },
      played("Björk", 6),
    ],
    allTime: [],
    excluded: [],
    shown: 5,
  });
  assert.deepEqual(
    suggestions.map((suggestion) => [suggestion.name, suggestion.item, suggestion.line]),
    [
      ["Aurora", "library", "7 plays in the last 90 days"],
      ["Björk", "Björk", "6 plays in the last 90 days"],
    ],
  );
});

const twelve = Array.from({ length: 12 }, (_, index) =>
  played(`Artist ${String.fromCodePoint(65 + index)}`, 100 - index),
);

test("the section shows 5, and each Show More 5 more, until no suggestion is left", () => {
  assert.equal(FOLLOW_SUGGESTIONS_PAGE, 5);
  const page = (shown: number) => {
    const { suggestions, more } = followSuggestions({
      recent: [],
      allTime: twelve,
      excluded: [],
      shown,
    });
    return [suggestions.map((suggestion) => suggestion.name.slice(-1)).join(""), more];
  };
  assert.deepEqual(page(5), ["ABCDE", true]);
  assert.deepEqual(page(10), ["ABCDEFGHIJ", true]);
  assert.deepEqual(page(15), ["ABCDEFGHIJKL", false]);
  assert.deepEqual(page(12), ["ABCDEFGHIJKL", false]);
});

test("a followed suggestion leaves and the next one takes its place", () => {
  const { suggestions, more } = followSuggestions({
    recent: [],
    allTime: twelve.slice(0, 6),
    excluded: [followArtistKey("Artist B")],
    shown: 5,
  });
  assert.deepEqual(
    suggestions.map((suggestion) => suggestion.name.slice(-1)),
    ["A", "C", "D", "E", "F"],
  );
  assert.equal(more, false);
});

test("a dismissed artist is never suggested, by any spelling, and the next one takes its place", () => {
  const names = (dismissed: readonly string[]) =>
    followSuggestions({
      recent: [played("Beyoncé", 9)],
      allTime: [played("BEYONCE", 40), ...twelve.slice(0, 5)],
      excluded: [],
      dismissed,
      shown: 5,
    }).suggestions.map((suggestion) => suggestion.name);
  assert.deepEqual(names([]), ["Beyoncé", "Artist A", "Artist B", "Artist C", "Artist D"]);
  assert.deepEqual(names([followArtistKey("The Beyoncé")]), [
    "Artist A",
    "Artist B",
    "Artist C",
    "Artist D",
    "Artist E",
  ]);
});

test("a dismissed artist stays out after being followed and unfollowed", () => {
  const { suggestions } = followSuggestions({
    recent: [played("Aurora", 3), played("Björk", 2)],
    allTime: [],
    excluded: [followArtistKey("Aurora")],
    dismissed: [followArtistKey("Aurora")],
    shown: 5,
  });
  const afterUnfollow = followSuggestions({
    recent: [played("Aurora", 3), played("Björk", 2)],
    allTime: [],
    excluded: [],
    dismissed: [followArtistKey("Aurora")],
    shown: 5,
  });
  assert.deepEqual(
    [suggestions, afterUnfollow.suggestions].map((list) => list.map((s) => s.name)),
    [["Björk"], ["Björk"]],
  );
});

test("the reason line reads in English and Brazilian Portuguese, one play or many", () => {
  const lines = (strings?: ReturnType<typeof catalogueOf>) =>
    followSuggestions({
      recent: [played("Aurora", 1), played("Björk", 1_234)],
      allTime: [played("Cher", 1), played("Elis", 12)],
      excluded: [],
      shown: 5,
      ...(strings === undefined ? {} : { strings }),
    }).suggestions.map((suggestion) => suggestion.line);
  assert.deepEqual(lines(), [
    "1,234 plays in the last 90 days",
    "1 play in the last 90 days",
    "12 plays",
    "1 play",
  ]);
  assert.deepEqual(lines(catalogueOf("pt-BR")), [
    "1.234 reproduções nos últimos 90 dias",
    "1 reprodução nos últimos 90 dias",
    "12 reproduções",
    "1 reprodução",
  ]);
});

test("the last 90 days are the window the recent plays are counted in", () => {
  const now = Date.UTC(2026, 10, 5, 12);
  assert.deepEqual(followSuggestionsWindow(now), { from: Date.UTC(2026, 7, 7, 12), to: now });
});
