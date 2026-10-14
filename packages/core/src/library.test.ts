import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  UNKNOWN_ALBUM,
  UNKNOWN_ARTIST,
  VARIOUS_ARTISTS,
  compareAlbumTracks,
  compareByTitle,
  normalizeTrack,
  splitCredit,
  sortKey,
} from "./index.ts";

const MUSIC = "/storage/emulated/0/Music";

describe("normalizeTrack fallbacks", () => {
  test("an untagged file uses its file name as title and Unknown Artist/Album", () => {
    const track = normalizeTrack({ path: `${MUSIC}/Downloads/01 - Intro.mp3` });
    assert.equal(track.title, "01 - Intro");
    assert.equal(track.artist, UNKNOWN_ARTIST);
    assert.equal(track.album, UNKNOWN_ALBUM);
    assert.equal(track.albumArtist, UNKNOWN_ARTIST);
    assert.equal(track.genre, null);
    assert.equal(track.year, null);
    assert.equal(track.trackNumber, null);
    assert.equal(track.discNumber, null);
    assert.equal(track.durationMs, 0);
    assert.equal(track.folder, `${MUSIC}/Downloads`);
    assert.equal(track.fileName, "01 - Intro.mp3");
  });

  test("blank and whitespace-only tags count as missing", () => {
    const track = normalizeTrack({
      path: `${MUSIC}/song.flac`,
      title: "   ",
      artist: "",
      album: "\u0000",
      genre: " ",
    });
    assert.equal(track.title, "song");
    assert.equal(track.artist, UNKNOWN_ARTIST);
    assert.equal(track.album, UNKNOWN_ALBUM);
    assert.equal(track.genre, null);
  });

  test("tag values are trimmed and inner whitespace collapsed", () => {
    const track = normalizeTrack({
      path: `${MUSIC}/a.mp3`,
      title: "  Paranoid   Android ",
      artist: "Radiohead\u0000",
    });
    assert.equal(track.title, "Paranoid Android");
    assert.equal(track.artist, "Radiohead");
  });

  test("a file name without an extension or starting with a dot is kept whole", () => {
    assert.equal(normalizeTrack({ path: `${MUSIC}/Track` }).title, "Track");
    assert.equal(normalizeTrack({ path: `${MUSIC}/.hidden` }).title, ".hidden");
  });
});

describe("multi-value artist tags", () => {
  test("every value of a multi-value artist tag is a credit of its own", () => {
    const track = normalizeTrack({
      path: `${MUSIC}/x.mp3`,
      artist: "Ariana Grande",
      artists: ["Ariana Grande", " Social House ", ""],
      album: "boyfriend",
    });
    assert.equal(track.artist, "Ariana Grande, Social House");
    assert.deepEqual(track.artistCredits, ["Ariana Grande", "Social House"]);
    assert.deepEqual(splitCredit(track.artist), ["Ariana Grande", "Social House"]);
    assert.equal(track.albumArtist, "Ariana Grande, Social House");
    assert.deepEqual(track.albumArtistCredits, ["Ariana Grande", "Social House"]);
  });

  test("so does every value of a multi-value album artist tag", () => {
    const track = normalizeTrack({
      path: `${MUSIC}/x.mp3`,
      artist: "Jay-Z",
      albumArtist: "Jay-Z",
      albumArtists: ["Jay-Z", "Kanye West"],
      album: "Watch the Throne",
    });
    assert.equal(track.albumArtist, "Jay-Z, Kanye West");
    assert.deepEqual(track.albumArtistCredits, ["Jay-Z", "Kanye West"]);
    assert.deepEqual(track.artistCredits, ["Jay-Z"]);
  });

  test("a tag with a single value reads as before", () => {
    const track = normalizeTrack({ path: `${MUSIC}/x.mp3`, artist: "Björk", artists: ["Björk"] });
    assert.equal(track.artist, "Björk");
    assert.deepEqual(track.artistCredits, ["Björk"]);
    assert.deepEqual(track.albumArtistCredits, ["Björk"]);
    assert.equal(
      normalizeTrack({ path: `${MUSIC}/x.mp3`, artist: "Björk", artists: [] }).artist,
      "Björk",
    );
  });
});

describe("credits with no tag", () => {
  test("an untagged file has one credit, Unknown Artist", () => {
    const track = normalizeTrack({ path: `${MUSIC}/x.mp3` });
    assert.deepEqual(track.artistCredits, [UNKNOWN_ARTIST]);
    assert.deepEqual(track.albumArtistCredits, [UNKNOWN_ARTIST]);
  });

  test("a compilation with no album artist tag is credited to Various Artists", () => {
    const track = normalizeTrack({
      path: `${MUSIC}/x.mp3`,
      artists: ["A", "B"],
      compilation: true,
    });
    assert.deepEqual(track.albumArtistCredits, [VARIOUS_ARTISTS]);
  });
});

describe("album artist and album identity", () => {
  test("the album artist tag wins when present", () => {
    const track = normalizeTrack({
      path: `${MUSIC}/x.mp3`,
      artist: "Jay-Z",
      albumArtist: "Kanye West",
      album: "Watch the Throne",
    });
    assert.equal(track.albumArtist, "Kanye West");
  });

  test("the album artist falls back to the track artist", () => {
    const track = normalizeTrack({ path: `${MUSIC}/x.mp3`, artist: "Björk", album: "Homogenic" });
    assert.equal(track.albumArtist, "Björk");
  });

  test("compilations without an album artist are filed under Various Artists", () => {
    const track = normalizeTrack({
      path: `${MUSIC}/x.mp3`,
      artist: "Daft Punk",
      album: "Late Night Tales",
      compilation: true,
    });
    assert.equal(track.albumArtist, VARIOUS_ARTISTS);
    assert.equal(track.compilation, true);
  });

  test("tracks of the same album by different artists share an album when the album artist matches", () => {
    const a = normalizeTrack({
      path: `${MUSIC}/a.mp3`,
      artist: "Artist One",
      album: "Now 99",
      compilation: true,
    });
    const b = normalizeTrack({
      path: `${MUSIC}/b.mp3`,
      artist: "Artist Two",
      album: "Now 99",
      compilation: true,
    });
    assert.equal(a.albumKey, b.albumKey);
  });

  test("a compilation keeps its own track artists while filed under Various Artists", () => {
    const track = normalizeTrack({
      path: `${MUSIC}/x.mp3`,
      artist: "Air",
      album: "Late Night Tales",
      compilation: true,
    });
    assert.equal(track.artist, "Air");
    assert.equal(
      track.albumArtistKey,
      normalizeTrack({ path: "/y.mp3", artist: VARIOUS_ARTISTS }).artistKey,
    );
  });

  test("a compilation tagged with an album artist (a DJ mix) is filed under that artist", () => {
    const a = normalizeTrack({
      path: `${MUSIC}/a.mp3`,
      artist: "Burial",
      album: "Fabric 01",
      albumArtist: "Craig Richards",
      compilation: true,
    });
    const b = normalizeTrack({
      path: `${MUSIC}/b.mp3`,
      artist: "Four Tet",
      album: "Fabric 01",
      albumArtist: "Craig Richards",
      compilation: true,
    });
    assert.equal(a.albumArtist, "Craig Richards");
    assert.equal(a.albumKey, b.albumKey);
  });

  test("a compilation and an artist album with the same title stay apart", () => {
    const compilation = normalizeTrack({
      path: `${MUSIC}/a.mp3`,
      artist: "Moby",
      album: "Greatest Hits",
      compilation: true,
    });
    const own = normalizeTrack({ path: `${MUSIC}/b.mp3`, artist: "Moby", album: "Greatest Hits" });
    assert.notEqual(compilation.albumKey, own.albumKey);
  });

  test("same album title by different album artists are different albums", () => {
    const a = normalizeTrack({ path: `${MUSIC}/a.mp3`, artist: "Weezer", album: "Weezer" });
    const b = normalizeTrack({ path: `${MUSIC}/b.mp3`, artist: "Peter Gabriel", album: "Weezer" });
    assert.notEqual(a.albumKey, b.albumKey);
  });

  test("album identity ignores case and spacing differences", () => {
    const a = normalizeTrack({
      path: `${MUSIC}/a.mp3`,
      artist: "Muse",
      album: "Origin of Symmetry",
    });
    const b = normalizeTrack({
      path: `${MUSIC}/b.mp3`,
      artist: "MUSE",
      album: "origin of  symmetry",
    });
    assert.equal(a.albumKey, b.albumKey);
    assert.equal(a.artistKey, b.artistKey);
  });

  test("an album title alone does not merge with the album artist name", () => {
    const a = normalizeTrack({ path: `${MUSIC}/a.mp3`, artist: "B C", album: "A" });
    const b = normalizeTrack({ path: `${MUSIC}/b.mp3`, artist: "C", album: "A B" });
    assert.notEqual(a.albumKey, b.albumKey);
  });
});

describe("number and date tags", () => {
  test("track and disc numbers accept n, 0n and n/total", () => {
    const track = normalizeTrack({
      path: `${MUSIC}/x.mp3`,
      trackNumber: "03/12",
      discNumber: "2/2",
    });
    assert.equal(track.trackNumber, 3);
    assert.equal(track.trackTotal, 12);
    assert.equal(track.discNumber, 2);
    assert.equal(track.discTotal, 2);
  });

  test("zero and unparseable numbers are missing", () => {
    const track = normalizeTrack({ path: `${MUSIC}/x.mp3`, trackNumber: "0", discNumber: "A" });
    assert.equal(track.trackNumber, null);
    assert.equal(track.discNumber, null);
  });

  test("the year is taken from a year or a full date", () => {
    assert.equal(normalizeTrack({ path: "/x.mp3", year: "1997" }).year, 1997);
    assert.equal(normalizeTrack({ path: "/x.mp3", year: "1997-05-21" }).year, 1997);
    assert.equal(normalizeTrack({ path: "/x.mp3", year: "2001-01-01T00:00:00Z" }).year, 2001);
    assert.equal(normalizeTrack({ path: "/x.mp3", year: "0000" }).year, null);
    assert.equal(normalizeTrack({ path: "/x.mp3", year: "199" }).year, null);
    assert.equal(normalizeTrack({ path: "/x.mp3", year: "19970" }).year, null);
  });

  test("ID3v1 numeric genre references are dropped", () => {
    assert.equal(normalizeTrack({ path: "/x.mp3", genre: "(17)Rock" }).genre, "Rock");
    assert.equal(normalizeTrack({ path: "/x.mp3", genre: "(17)" }).genre, null);
    assert.equal(normalizeTrack({ path: "/x.mp3", genre: "Hip-Hop" }).genre, "Hip-Hop");
  });

  test("durations are whole milliseconds and invalid ones are zero", () => {
    assert.equal(normalizeTrack({ path: "/x.mp3", durationMs: 187_400.6 }).durationMs, 187_401);
    assert.equal(normalizeTrack({ path: "/x.mp3", durationMs: -1 }).durationMs, 0);
    assert.equal(normalizeTrack({ path: "/x.mp3", durationMs: Number.NaN }).durationMs, 0);
  });
});

describe("sortKey", () => {
  const sorted = (names: string[]): string[] =>
    [...names].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0));

  test("ignores a leading The, A or An", () => {
    assert.deepEqual(sorted(["The Beatles", "Arcade Fire", "A Tribe Called Quest", "Coldplay"]), [
      "Arcade Fire",
      "The Beatles",
      "Coldplay",
      "A Tribe Called Quest",
    ]);
    assert.equal(sortKey("An Horse"), "horse");
  });

  test("keeps an article that is the whole name or part of a word", () => {
    assert.equal(sortKey("The"), "the");
    assert.equal(sortKey("A"), "a");
    assert.equal(sortKey("Theory of a Deadman"), "theory of a deadman");
    assert.equal(sortKey("Anathema"), "anathema");
  });

  test("ignores case and accents", () => {
    assert.equal(sortKey("Beyoncé"), sortKey("beyonce"));
    assert.equal(sortKey("Émilie Simon"), "emilie simon");
    assert.equal(sortKey("Sigur Rós"), "sigur ros");
    assert.equal(sortKey("Mötley Crüe"), "motley crue");
    assert.equal(sortKey("Straße"), "strasse");
    assert.deepEqual(sorted(["Zeca Pagodinho", "Élis Regina", "Djavan"]), [
      "Djavan",
      "Élis Regina",
      "Zeca Pagodinho",
    ]);
  });

  test("names starting with digits or symbols sort after every letter", () => {
    assert.deepEqual(sorted(["50 Cent", "Zz Top", "!!!", "Abba", "2Pac"]), [
      "Abba",
      "Zz Top",
      "!!!",
      "2Pac",
      "50 Cent",
    ]);
  });

  test("leading punctuation before a word is ignored", () => {
    assert.equal(sortKey("'Til Tuesday"), "til tuesday");
    assert.equal(sortKey("...And Justice for All"), "and justice for all");
  });

  test("normalizeTrack fills every sort key", () => {
    const track = normalizeTrack({
      path: "/x.mp3",
      title: "The Less I Know the Better",
      artist: "Tame Impala",
      album: "Currents",
      genre: "Psychedelic",
    });
    assert.equal(track.titleSort, "less i know the better");
    assert.equal(track.artistSort, "tame impala");
    assert.equal(track.albumSort, "currents");
    assert.equal(track.albumArtistSort, "tame impala");
    assert.equal(track.genreSort, "psychedelic");
  });
});

describe("ordering", () => {
  const albumTrack = (path: string, disc: string | null, number: string | null, title: string) =>
    normalizeTrack({ path, discNumber: disc, trackNumber: number, title });

  test("album tracks are ordered by disc, then track number", () => {
    const tracks = [
      albumTrack("/d2t1.mp3", "2", "1", "Five"),
      albumTrack("/d1t10.mp3", "1", "10", "Four"),
      albumTrack("/d1t2.mp3", "1", "2", "Two"),
      albumTrack("/d1t1.mp3", "1/2", "1/10", "One"),
    ];
    assert.deepEqual(
      tracks.sort(compareAlbumTracks).map((t) => t.title),
      ["One", "Two", "Four", "Five"],
    );
  });

  test("a missing disc counts as disc 1 and unnumbered tracks come last on their disc", () => {
    const tracks = [
      albumTrack("/c.mp3", null, null, "Bonus"),
      albumTrack("/d2.mp3", "2", "1", "Disc Two"),
      albumTrack("/b.mp3", null, "2", "Second"),
      albumTrack("/a.mp3", "1", "1", "First"),
    ];
    assert.deepEqual(
      tracks.sort(compareAlbumTracks).map((t) => t.title),
      ["First", "Second", "Bonus", "Disc Two"],
    );
  });

  test("songs are ordered by title, then artist", () => {
    const tracks = [
      normalizeTrack({ path: "/1.mp3", title: "Creep", artist: "Stone Temple Pilots" }),
      normalizeTrack({ path: "/2.mp3", title: "The Animal", artist: "Disturbed" }),
      normalizeTrack({ path: "/3.mp3", title: "Creep", artist: "Radiohead" }),
      normalizeTrack({ path: "/4.mp3", title: "1979", artist: "The Smashing Pumpkins" }),
    ];
    assert.deepEqual(
      tracks.sort(compareByTitle).map((t) => `${t.title} — ${t.artist}`),
      [
        "The Animal — Disturbed",
        "Creep — Radiohead",
        "Creep — Stone Temple Pilots",
        "1979 — The Smashing Pumpkins",
      ],
    );
  });
});
