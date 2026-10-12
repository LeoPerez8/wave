import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { sectionSongs, type LibrarySectionSource } from "./index.ts";

interface Song {
  readonly id: number;
  readonly title: string;
}

let nextId = 1;
const song = (title: string): Song => ({ id: nextId++, title });

const titles = (songs: readonly Song[]): string[] => songs.map((s) => s.title);

/** Collections (albums, artists…) holding `groups` (id and songs), listed in that order. */
const collection = (groups: ReadonlyArray<readonly [number, readonly Song[]]>) => ({
  ids: () => Promise.resolve(groups.map(([id]) => id)),
  songs: (id: number) => Promise.resolve(groups.find(([key]) => key === id)?.[1] ?? []),
});

const none = collection([]);

const library = (overrides: Partial<LibrarySectionSource<Song>>): LibrarySectionSource<Song> => ({
  songs: () => Promise.resolve([]),
  favorites: () => Promise.resolve([]),
  albums: none,
  artists: none,
  genres: none,
  folders: none,
  playlists: none,
  ...overrides,
});

describe("library section songs", () => {
  test("Albums plays album by album, each in the album's own order", async () => {
    const source = library({
      albums: collection([
        [7, [song("Speak to Me"), song("Breathe")]],
        [3, [song("Airbag"), song("Paranoid Android")]],
      ]),
    });
    assert.deepEqual(titles(await sectionSongs("albums", source)), [
      "Speak to Me",
      "Breathe",
      "Airbag",
      "Paranoid Android",
    ]);
  });

  test("Artists plays artist by artist, a song credited to two of them once, under the first", async () => {
    const otis = song("Otis");
    const source = library({
      artists: collection([
        [1, [song("Clique"), otis]],
        [2, [song("Monster"), otis, song("Power")]],
      ]),
    });
    assert.deepEqual(titles(await sectionSongs("artists", source)), [
      "Clique",
      "Otis",
      "Monster",
      "Power",
    ]);
  });

  test("Songs and Favorites play as their lists show them", async () => {
    const source = library({
      songs: () => Promise.resolve([song("Airbag"), song("Breathe")]),
      favorites: () => Promise.resolve([song("Starred today"), song("Starred last year")]),
    });
    assert.deepEqual(titles(await sectionSongs("songs", source)), ["Airbag", "Breathe"]);
    assert.deepEqual(titles(await sectionSongs("favorites", source)), [
      "Starred today",
      "Starred last year",
    ]);
  });

  test("Genres and Folders go genre by genre and folder by folder", async () => {
    const source = library({
      genres: collection([
        [9, [song("Ambient")]],
        [5, [song("Jazz")]],
      ]),
      folders: collection([
        [2, [song("01 Downloads.mp3")]],
        [1, [song("01 Music.mp3"), song("02 Music.mp3")]],
      ]),
    });
    assert.deepEqual(titles(await sectionSongs("genres", source)), ["Ambient", "Jazz"]);
    assert.deepEqual(titles(await sectionSongs("folders", source)), [
      "01 Downloads.mp3",
      "01 Music.mp3",
      "02 Music.mp3",
    ]);
  });

  test("an empty section holds no songs", async () => {
    const source = library({ playlists: collection([[1, []]]) });
    for (const section of ["favorites", "playlists", "artists"] as const) {
      assert.deepEqual(await sectionSongs(section, source), []);
    }
  });

  test("Playlists plays playlist by playlist, keeping a song each playlist holds", async () => {
    const intro = song("Intro");
    const source = library({
      playlists: collection([
        [4, [intro, song("Run")]],
        [2, [song("Walk"), intro]],
      ]),
    });
    assert.deepEqual(titles(await sectionSongs("playlists", source)), [
      "Intro",
      "Run",
      "Walk",
      "Intro",
    ]);
  });
});
