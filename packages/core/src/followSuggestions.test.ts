import { test } from "node:test";
import assert from "node:assert/strict";
import {
  catalogueOf,
  FOLLOW_SUGGESTIONS_PAGE,
  followArtistKey,
  followSuggestions,
  followSuggestionsWindow,
  LIGHT_LISTENER_PLAYS,
  lightListener,
} from "./index.ts";

const played = (name: string, countedPlays: number) => ({ name, countedPlays, item: name });

/** A followed artist played often enough that the owner isn't a light listener. */
const often = played("Often Played", 50);
const followed = followArtistKey(often.name);

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
    allTime: [often, played("Zélia", 7), played("Elis", 7)],
    excluded: [followed],
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
    allTime: [often],
    excluded: [followed],
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
    allTime: [often],
    excluded: [followed, followArtistKey("Aurora")],
    dismissed: [followArtistKey("Aurora")],
    shown: 5,
  });
  const afterUnfollow = followSuggestions({
    recent: [played("Aurora", 3), played("Björk", 2)],
    allTime: [often],
    excluded: [followed],
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

// A light listener: the owner's most played artist has LIGHT_LISTENER_PLAYS or fewer.

const artist = (name: string) => ({ name, item: name });
const song = (id: string, ...names: string[]) => ({ id, artists: names.map(artist) });

test("a light listener's suggestions come from their Library, most songs first", () => {
  assert.equal(LIGHT_LISTENER_PLAYS, 10);
  const { suggestions } = followSuggestions({
    recent: [],
    allTime: [played("Cher", 3)],
    excluded: [],
    kept: {
      library: [song("1", "Aurora"), song("2", "Björk"), song("3", "Björk"), song("4", "Cher")],
      playlists: [],
    },
    shown: 5,
  });
  assert.deepEqual(
    suggestions.map((suggestion) => [suggestion.name, suggestion.line]),
    [
      ["Björk", "2 songs in your Library"],
      ["Cher", "1 song in your Library"],
      ["Aurora", "1 song in your Library"],
    ],
  );
});

test("suggestions come from what the owner keeps up to 10 plays of their top artist, as usual from 11", () => {
  const lines = (topPlays: number) =>
    followSuggestions({
      recent: [played("Cher", 2)],
      allTime: [played("Aurora", topPlays), played("Cher", 2)],
      excluded: [],
      kept: { library: [song("1", "Björk")], playlists: [] },
      shown: 5,
    }).suggestions.map((suggestion) => [suggestion.name, suggestion.line]);
  assert.deepEqual(lines(10), [
    ["Björk", "1 song in your Library"],
    ["Aurora", "10 plays"],
    ["Cher", "2 plays"],
  ]);
  assert.deepEqual(lines(11), [
    ["Cher", "2 plays in the last 90 days"],
    ["Aurora", "11 plays"],
  ]);
});

test("each playlist adds one per song of the artist it holds, a repeated song once", () => {
  const favorites = [song("1", "Aurora")];
  const mix = [song("1", "Aurora"), song("1", "Aurora"), song("yt:abc", "Aurora", "Björk")];
  const { suggestions } = followSuggestions({
    recent: [],
    allTime: [],
    excluded: [],
    kept: {
      library: [song("1", "Aurora"), song("2", "Björk"), song("3", "Björk"), song("4", "Cher")],
      playlists: [favorites, mix, [song("yt:def", "Elis")]],
    },
    shown: 5,
  });
  assert.deepEqual(
    suggestions.map((suggestion) => [suggestion.name, suggestion.line]),
    [
      ["Aurora", "1 song in your Library · 3 in playlists"],
      ["Björk", "2 songs in your Library · 1 in a playlist"],
      ["Cher", "1 song in your Library"],
      ["Elis", "1 song in a playlist"],
    ],
  );
});

test("a light listener's artists with as high a score go by counted plays, then by name", () => {
  const { suggestions } = followSuggestions({
    recent: [played("Cher", 1)],
    allTime: [played("Cher", 1), played("Björk", 4), played("Zélia", 6)],
    excluded: [],
    kept: {
      library: [song("1", "Cher"), song("2", "Björk"), song("3", "Elis"), song("4", "Áurea")],
      playlists: [],
    },
    shown: 5,
  });
  assert.deepEqual(
    suggestions.map((suggestion) => [suggestion.name, suggestion.countedPlays]),
    [
      ["Björk", 4],
      ["Cher", 1],
      ["Áurea", 0],
      ["Elis", 0],
      ["Zélia", 6],
    ],
  );
});

test("a light listener is never offered an artist they follow or dismissed, by any spelling", () => {
  const { suggestions } = followSuggestions({
    recent: [],
    allTime: [played("Beyoncé", 3)],
    excluded: [followArtistKey("Aurora")],
    dismissed: [followArtistKey("The Beyoncé")],
    kept: {
      library: [song("1", "AURORA"), song("2", "BEYONCE"), song("3", "Various Artists")],
      playlists: [[song("4", "Aurora", "Björk")]],
    },
    shown: 5,
  });
  assert.deepEqual(
    suggestions.map((suggestion) => suggestion.name),
    ["Björk"],
  );
});

test("namesakes in one credit count once, under the most played spelling", () => {
  const { suggestions } = followSuggestions({
    recent: [],
    allTime: [
      { name: "AURORA", countedPlays: 1, item: "online" },
      { name: "Aurora", countedPlays: 2, item: "library" },
    ],
    excluded: [],
    kept: {
      library: [song("1", "Aurora", "AURORA")],
      playlists: [[song("1", "AURORA"), song("1", "Aurora")]],
    },
    shown: 5,
  });
  assert.deepEqual(
    suggestions.map((suggestion) => [suggestion.name, suggestion.item, suggestion.line]),
    [["Aurora", "library", "1 song in your Library · 1 in a playlist"]],
  );
});

test("a light listener's reason line reads in Brazilian Portuguese, one song or many", () => {
  const { suggestions } = followSuggestions({
    recent: [],
    allTime: [],
    excluded: [],
    kept: {
      library: [
        ...Array.from({ length: 1_200 }, (_, index) => song(`a${index}`, "Aurora")),
        song("b", "Björk"),
        song("c", "Cher"),
        song("c2", "Cher"),
      ],
      playlists: [
        [song("a0", "Aurora"), song("b", "Björk"), song("c", "Cher"), song("e", "Elis")],
        [song("a0", "Aurora"), song("e2", "Elis")],
      ],
    },
    shown: 5,
    strings: catalogueOf("pt-BR"),
  });
  assert.deepEqual(
    suggestions.map((suggestion) => suggestion.line),
    [
      "1.200 músicas na biblioteca · 2 em playlists",
      "2 músicas na biblioteca · 1 em uma playlist",
      "1 música na biblioteca · 1 em uma playlist",
      "2 músicas em playlists",
    ],
  );
});

test("the owner is a light listener while no artist has more than 10 counted plays", () => {
  assert.equal(lightListener([]), true);
  assert.equal(lightListener([played("Aurora", 10), played("Björk", 3)]), true);
  assert.equal(lightListener([played("Aurora", 11), played("Björk", 3)]), false);
});
