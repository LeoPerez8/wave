import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { createPlaylistFinder } from "./index.ts";

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
