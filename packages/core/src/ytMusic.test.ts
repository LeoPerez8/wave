import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  libraryFinder,
  libraryMatcher,
  parseTrackId,
  ytSongArtist,
  ytSongCredit,
  ytTrackId,
} from "./index.ts";
import type { YtSong } from "./index.ts";

const ytSong = (song: Partial<YtSong> & Pick<YtSong, "title" | "artists">): YtSong => ({
  videoId: "v1",
  album: null,
  durationMs: null,
  artworkUrl: null,
  explicit: false,
  ...song,
});

/** A Library with remastered songs, as the phone showed it. */
const remasteredLibrary = [
  { title: "Bohemian Rhapsody (Remastered 2011)", artist: "Queen", durationMs: 356_000 },
  { title: "Heroes - 2017 Remaster", artist: "David Bowie", durationMs: 371_000 },
  { title: "Jóga", artist: "Björk", durationMs: 305_400 },
];

const by = (artist: string, title: string, durationMs: number): YtSong =>
  ytSong({ title, artists: [artist], durationMs });

describe("libraryMatcher", () => {
  const library = [
    { title: "Jóga", artist: "Björk", durationMs: 305_400 },
    {
      title: "Get Lucky",
      artist: "Daft Punk feat. Pharrell Williams & Nile Rodgers",
      durationMs: 369_600,
    },
    { title: "The Boxer", artist: "Simon & Garfunkel", durationMs: 308_000 },
    { title: "Untitled", artist: "Somebody", durationMs: 0 },
  ];
  const inLibrary = libraryMatcher(library);

  test("a song with the Library's title, artist and length is already in the Library", () => {
    const song = ytSong({ title: "Jóga", artists: ["Björk"], durationMs: 306_000 });
    assert.equal(inLibrary(song), true);
  });

  test("case, accents and punctuation don't tell songs apart", () => {
    assert.equal(
      inLibrary(ytSong({ title: "JOGA!", artists: ["Bjork"], durationMs: 305_000 })),
      true,
    );
  });

  test("featured artists are credited either in the title or with the artist", () => {
    const song = ytSong({
      title: "Get Lucky (feat. Pharrell Williams and Nile Rodgers)",
      artists: ["Daft Punk", "Pharrell Williams", "Nile Rodgers"],
      durationMs: 370_000,
    });
    assert.equal(inLibrary(song), true);
    const credited = ytSong({
      title: "The Boxer",
      artists: ["Simon & Garfunkel"],
      durationMs: 308_000,
    });
    assert.equal(inLibrary(credited), true);
  });

  test("a Library collaboration shares each credited artist, as the Library splits credits", () => {
    const collaborations = libraryMatcher([
      { title: "boyfriend", artist: "Ariana Grande · Social House", durationMs: 186_000 },
      { title: "Get Lucky", artist: "Daft Punk; Pharrell Williams", durationMs: 369_600 },
    ]);
    assert.equal(collaborations(by("Social House", "boyfriend", 186_000)), true);
    assert.equal(collaborations(by("Pharrell Williams", "Get Lucky", 369_600)), true);
  });

  test('artists joined with "+" are each credited', () => {
    const library = libraryMatcher([
      { title: "Cosmic Love", artist: "Florence + Jamie xx", durationMs: 250_000 },
    ]);
    assert.equal(library(by("Jamie xx", "Cosmic Love", 250_000)), true);
  });

  test("a credit naming nobody shares no artist with another such credit", () => {
    const library = libraryMatcher([
      { title: "Intro", artist: "Unknown Artist", durationMs: 60_000 },
      { title: "Outro", artist: " + ", durationMs: 60_000 },
    ]);
    assert.equal(library(by(" ; ", "Intro", 60_000)), false);
    assert.equal(library(by("Unknown Artist", "Outro", 60_000)), false);
  });

  test("another artist's song of the same name is not the Library's", () => {
    const cover = ytSong({ title: "Jóga", artists: ["Läura"], durationMs: 305_000 });
    assert.equal(inLibrary(cover), false);
  });

  test("a version of a different length (a live take, an edit) is not the Library's", () => {
    const live = ytSong({ title: "Jóga", artists: ["Björk"], durationMs: 335_000 });
    assert.equal(inLibrary(live), false);
    const edit = ytSong({
      title: "Get Lucky (Radio Edit)",
      artists: ["Daft Punk"],
      durationMs: 249_000,
    });
    assert.equal(inLibrary(edit), false);
  });

  test("an unknown length on either side leaves title and artist to decide", () => {
    assert.equal(inLibrary(ytSong({ title: "Jóga", artists: ["Björk"] })), true);
    assert.equal(
      inLibrary(ytSong({ title: "Untitled", artists: ["Somebody"], durationMs: 90_000 })),
      true,
    );
  });

  test("a remaster is the same recording: its note doesn't tell songs apart, on either side", () => {
    const remastered = libraryMatcher(remasteredLibrary);
    assert.equal(remastered(by("Queen", "Bohemian Rhapsody", 355_000)), true);
    assert.equal(remastered(by("Queen", "Bohemian Rhapsody (Remastered)", 355_000)), true);
    assert.equal(remastered(by("Queen", "Bohemian Rhapsody - Remastered 2011", 355_000)), true);
    assert.equal(remastered(by("Queen", "Bohemian Rhapsody (2011 Remaster)", 355_000)), true);
    assert.equal(remastered(by("Queen", "Bohemian Rhapsody [Remastered]", 355_000)), true);
    assert.equal(remastered(by("David Bowie", "Heroes", 371_000)), true);
    assert.equal(remastered(by("David Bowie", "Heroes (Remastered 2017)", 371_000)), true);
    assert.equal(remastered(by("Björk", "Jóga (Remastered)", 305_000)), true);
    assert.equal(remastered(by("Björk", "Jóga - 2002 Remaster", 305_000)), true);
  });

  test("a live take or an edit still isn't the Library's, whatever its length", () => {
    const remastered = libraryMatcher(remasteredLibrary);
    const queen = [
      "Bohemian Rhapsody (Live)",
      "Bohemian Rhapsody (Live Aid 1985)",
      "Bohemian Rhapsody - Live at Wembley",
      "Bohemian Rhapsody (Radio Edit)",
      "Bohemian Rhapsody (Live) [Remastered 2011]",
    ];
    for (const title of queen) assert.equal(remastered(by("Queen", title, 356_000)), false, title);
  });

  test("an empty Library has none of them", () => {
    assert.equal(libraryMatcher([])(ytSong({ title: "Jóga", artists: ["Björk"] })), false);
  });
});

describe("libraryFinder", () => {
  const library = [
    { id: 1, title: "Get Lucky", artist: "Daft Punk", durationMs: 369_600 },
    { id: 2, title: "The Boxer", artist: "Simon & Garfunkel", durationMs: 308_000 },
  ];
  const find = libraryFinder(library);

  test("finds the Library song a YT Music song is, so it can play the file", () => {
    const song = ytSong({
      title: "The Boxer",
      artists: ["Simon & Garfunkel"],
      durationMs: 309_000,
    });
    assert.equal(find(song), library[1]);
  });

  test("finds nothing for a song the Library lacks", () => {
    assert.equal(find(ytSong({ title: "Instant Crush", artists: ["Daft Punk"] })), null);
    assert.equal(
      find(ytSong({ title: "Get Lucky", artists: ["Daft Punk"], durationMs: 250_000 })),
      null,
    );
  });
});

describe("ytSongCredit", () => {
  test("names every artist, then the album", () => {
    const song = ytSong({
      title: "Get Lucky",
      artists: ["Daft Punk", "Pharrell Williams", "Nile Rodgers"],
      album: "Random Access Memories",
    });
    assert.equal(
      ytSongCredit(song),
      "Daft Punk, Pharrell Williams & Nile Rodgers · Random Access Memories",
    );
  });

  test("leaves out what YT Music doesn't say", () => {
    assert.equal(ytSongCredit(ytSong({ title: "Jóga", artists: ["Björk"] })), "Björk");
    assert.equal(ytSongCredit(ytSong({ title: "Duo", artists: ["A", "B"] })), "A & B");
  });
});

describe("ytSongArtist", () => {
  test("is the artist line a played YT Music song shows: its artists, without the album", () => {
    const song = ytSong({
      title: "Get Lucky",
      artists: ["Daft Punk", "Pharrell Williams", "Nile Rodgers"],
      album: "Random Access Memories",
    });
    assert.equal(ytSongArtist(song), "Daft Punk, Pharrell Williams & Nile Rodgers");
  });
});

describe("YT Music song ids", () => {
  test("a YT Music song's track id carries its video id, apart from Library ids", () => {
    const id = ytTrackId("4D7u5KF7SP8");
    assert.deepEqual(parseTrackId(id), { kind: "yt", videoId: "4D7u5KF7SP8" });
    assert.notEqual(id, "4D7u5KF7SP8");
  });

  test("Library track ids stay Library ids", () => {
    assert.deepEqual(parseTrackId("42"), { kind: "library", id: 42 });
  });

  test("anything else is no track", () => {
    for (const id of ["", "yt:", "abc", "4.5", "-3"]) assert.equal(parseTrackId(id), null, id);
  });
});
