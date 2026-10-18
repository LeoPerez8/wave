import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  createPlaylistFinder,
  findInPlaylistHead,
  foundInPlaylist,
  hasFindQuery,
} from "./index.ts";

interface Song {
  readonly title: string;
  readonly artist: string;
  readonly album: string;
}

const song = (title: string, artist = "Someone", album = "Something"): Song => ({
  title,
  artist,
  album,
});

const PLAYLIST: readonly Song[] = [
  song("Halo", "Beyoncé", "I Am... Sasha Fierce"),
  song("Back in Black", "AC/DC", "Back in Black"),
  song("Crazy in Love", "Beyoncé", "Dangerously in Love"),
  song("Take On Me", "a-ha", "Hunting High and Low"),
];

const finder = (songs: readonly Song[] = PLAYLIST) => createPlaylistFinder(songs, (s) => s);

describe("Find in Playlist", () => {
  test("a song is found by its title, and the result says where it sits in the playlist", () => {
    assert.deepEqual(finder().find("black"), [1]);
  });

  test("songs are found by their artist and their album too", () => {
    assert.deepEqual(finder().find("beyonce"), [0, 2]);
    assert.deepEqual(finder().find("hunting"), [3]);
  });

  test("case, accents and punctuation are folded, and words match prefixes in any order", () => {
    assert.deepEqual(finder().find("BEYO"), [0, 2]);
    assert.deepEqual(finder().find("ac/dc"), [1]);
    assert.deepEqual(finder().find("love craz"), [2]);
    assert.deepEqual(finder().find("lack"), []);
  });

  test("the songs found keep the playlist's order, not a best-match ranking", () => {
    const songs = [song("Love Story"), song("Love"), song("Lovely")];
    assert.deepEqual(finder(songs).find("love"), [0, 1, 2]);
  });

  test("a blank query finds nothing to narrow: the whole list shows", () => {
    assert.equal(finder().find(""), null);
    assert.equal(finder().find("   "), null);
    assert.equal(finder().find("…"), null);
  });

  test("a query no song matches finds an empty list", () => {
    assert.deepEqual(finder().find("zzz"), []);
  });

  test("a song in the playlist twice is found at both places", () => {
    const songs = [song("Halo"), song("Other"), song("Halo")];
    assert.deepEqual(finder(songs).find("halo"), [0, 2]);
  });

  test("an entry with nothing to find it by is never found, and the others keep their places", () => {
    const songs = [song("Halo"), null, song("Halo")];
    const find = createPlaylistFinder(songs, (s) => s);
    assert.deepEqual(find.find("halo"), [0, 2]);
  });

  test("a song with no artist or album is still found by its title", () => {
    const find = createPlaylistFinder(["Halo"], (title) => ({ title, artist: null }));
    assert.deepEqual(find.find("halo"), [0]);
  });
});

describe("Find in Playlist's query", () => {
  test("a query has something to find by once it holds a letter or a digit", () => {
    assert.equal(hasFindQuery("halo"), true);
    assert.equal(hasFindQuery(" 4 "), true);
  });

  test("a blank or punctuation-only query has nothing to find by", () => {
    assert.equal(hasFindQuery(""), false);
    assert.equal(hasFindQuery("   "), false);
    assert.equal(hasFindQuery("…"), false);
  });
});

describe("the list Find in Playlist shows", () => {
  const songs = ["Halo", "Back in Black", "Crazy in Love", "Take On Me"];

  test("while nothing is typed, the whole list shows and each row is its own place", () => {
    const shown = foundInPlaylist(songs, null);
    assert.deepEqual(shown.songs, songs);
    assert.equal(shown.placeOf(2), 2);
  });

  test("the songs found show in playlist order, and a row leads back to its place in the playlist", () => {
    const shown = foundInPlaylist(songs, [1, 3]);
    assert.deepEqual(shown.songs, ["Back in Black", "Take On Me"]);
    assert.equal(shown.placeOf(0), 1);
    assert.equal(shown.placeOf(1), 3);
  });

  test("a place past the playlist's end (a list that shrank meanwhile) shows nothing", () => {
    assert.deepEqual(foundInPlaylist(songs, [0, 9]).songs, ["Halo"]);
  });
});

describe("what sits under Find in Playlist's field", () => {
  test("while nothing is typed, the list's own header", () => {
    assert.equal(findInPlaylistHead(null, true), "header");
    assert.equal(findInPlaylistHead(null, false), "header");
  });

  test("a query that finds nothing in a list that's all in says No songs match", () => {
    assert.equal(findInPlaylistHead([], true), "noMatch");
  });

  test("while a playlist's pages are still arriving, a query that finds nothing yet says nothing", () => {
    assert.equal(findInPlaylistHead([], false), "none");
  });

  test("a query that finds songs shows just them", () => {
    assert.equal(findInPlaylistHead([2], true), "none");
    assert.equal(findInPlaylistHead([2], false), "none");
  });
});
