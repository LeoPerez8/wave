import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { alphabetIndex, artistAlbums, compareFileNames, indexLetter, sortKey } from "./index.ts";

describe("indexLetter", () => {
  test("files a name under the first letter of its sort key, ignoring articles and accents", () => {
    assert.equal(indexLetter(sortKey("The Beatles")), "B");
    assert.equal(indexLetter(sortKey("Émilie Simon")), "E");
    assert.equal(indexLetter(sortKey("a-ha")), "A");
  });

  test("files names starting with digits, symbols or non-Latin letters under #", () => {
    assert.equal(indexLetter(sortKey("50 Cent")), "#");
    assert.equal(indexLetter(sortKey("!!!")), "#");
    assert.equal(indexLetter(sortKey("Кино")), "#");
    assert.equal(indexLetter(""), "#");
  });
});

describe("alphabetIndex", () => {
  test("lists each letter present once, with the first row filed under it", () => {
    const artists = ["ABBA", "Air", "The Beatles", "Björk", "Coldplay", "Daft Punk", "2Pac"];
    assert.deepEqual(alphabetIndex(artists.map(sortKey)), [
      { letter: "A", index: 0 },
      { letter: "B", index: 2 },
      { letter: "C", index: 4 },
      { letter: "D", index: 5 },
      { letter: "#", index: 6 },
    ]);
  });

  test("an empty list has no letters", () => {
    assert.deepEqual(alphabetIndex([]), []);
  });

  test("a letter seen again later in the list keeps its first row", () => {
    // Non-Latin names sort after the "#" names; they share the # entry.
    assert.deepEqual(alphabetIndex(["abba", "~50 cent", "кино"]), [
      { letter: "A", index: 0 },
      { letter: "#", index: 1 },
    ]);
  });
});

describe("artistAlbums", () => {
  const BJORK = 1;
  const VARIOUS = 2;
  const album = (title: string, albumArtistId: number, year: number | null) => ({
    title,
    titleSort: sortKey(title),
    albumArtistId,
    year,
  });
  const titles = (albums: readonly { title: string }[]) => albums.map((a) => a.title);

  test("albums filed under the artist are theirs; others they play on are Appears On", () => {
    const { albums, appearsOn } = artistAlbums(BJORK, [
      album("Homogenic", BJORK, 1997),
      album("Late Night Tales", VARIOUS, 2002),
      album("Debut", BJORK, 1993),
    ]);
    assert.deepEqual(titles(albums), ["Homogenic", "Debut"]);
    assert.deepEqual(titles(appearsOn), ["Late Night Tales"]);
  });

  test("newest first, undated albums last, then by title ignoring articles", () => {
    const { albums } = artistAlbums(BJORK, [
      album("Vespertine", BJORK, 2001),
      album("The Remixes", BJORK, null),
      album("Biophilia", BJORK, 2011),
      album("Medúlla", BJORK, 2004),
      album("Greatest Hits", BJORK, 2002),
      album("Family Tree", BJORK, 2002),
      album("Anthology", BJORK, null),
    ]);
    assert.deepEqual(titles(albums), [
      "Biophilia",
      "Medúlla",
      "Family Tree",
      "Greatest Hits",
      "Vespertine",
      "Anthology",
      "The Remixes",
    ]);
  });
});

describe("compareFileNames", () => {
  const sorted = (names: string[]) => [...names].sort(compareFileNames);

  test("numbers in file names are ordered by value, the way a file manager lists them", () => {
    assert.deepEqual(sorted(["10 - Ten.mp3", "2 - Two.mp3", "1 - One.mp3", "01 - Zero One.mp3"]), [
      "1 - One.mp3",
      "01 - Zero One.mp3",
      "2 - Two.mp3",
      "10 - Ten.mp3",
    ]);
    assert.deepEqual(sorted(["Track 12.flac", "Track 9.flac", "Track 100.flac"]), [
      "Track 9.flac",
      "Track 12.flac",
      "Track 100.flac",
    ]);
  });

  test("letters are compared ignoring case and accents", () => {
    assert.deepEqual(sorted(["c.mp3", "B.mp3", "Ábaco.mp3", "ad.mp3"]), [
      "Ábaco.mp3",
      "ad.mp3",
      "B.mp3",
      "c.mp3",
    ]);
  });
});
