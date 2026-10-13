import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  LRCLIB_HEADERS,
  deezerAlbumGenre,
  deezerAlbumUrl,
  deezerTrackCandidates,
  deezerTrackSearchUrl,
  describeTagLookups,
  libraryLookupSongs,
  lookupsUnreachable,
  lrclibCandidates,
  lrclibSearchUrl,
  pickFoundLyrics,
  pickGenreAlbum,
  settledTags,
  songLookup,
  songTagOutcome,
} from "./index.ts";
import type { GenreCandidate, LyricsCandidate, SongTagOutcome, TagWriteReport } from "./index.ts";

const song = {
  title: "Karma Police",
  artist: "Radiohead",
  album: "OK Computer",
  durationMs: 264_000,
};

describe("songLookup", () => {
  test("is what is sent: title, artist, album and duration, tidied", () => {
    assert.deepEqual(
      songLookup({ ...song, title: "  Karma   Police ", artist: "Radiohead " }),
      song,
    );
  });

  test("is null without an artist to tell the song apart (never looked up)", () => {
    assert.equal(songLookup({ ...song, artist: "Unknown Artist" }), null);
    assert.equal(songLookup({ ...song, artist: "Various Artists" }), null);
    assert.equal(songLookup({ ...song, title: " " }), null);
  });

  test("leaves out an unknown album", () => {
    assert.deepEqual(songLookup({ ...song, album: "Unknown Album" }), { ...song, album: null });
  });
});

describe("lrclibSearchUrl", () => {
  test("searches LRCLIB by title and artist", () => {
    assert.equal(
      lrclibSearchUrl({ ...song, artist: "Simon & Garfunkel" }),
      "https://lrclib.net/api/search?track_name=Karma%20Police&artist_name=Simon%20%26%20Garfunkel",
    );
  });

  test("names Wave to LRCLIB, as it asks clients to", () => {
    assert.match(LRCLIB_HEADERS["User-Agent"], /^Wave /);
  });
});

describe("lrclibCandidates", () => {
  test("reads the songs of a search response", () => {
    assert.deepEqual(
      lrclibCandidates([
        {
          id: 1,
          trackName: "Karma Police",
          artistName: "Radiohead",
          albumName: "OK Computer",
          duration: 264.0,
          instrumental: false,
          plainLyrics: "Karma police",
          syncedLyrics: "[00:26.78]Karma police",
        },
        { id: 2, trackName: "No artist" },
        {
          trackName: "Airbag",
          artistName: "Radiohead",
          albumName: null,
          duration: null,
          instrumental: true,
          plainLyrics: null,
          syncedLyrics: null,
        },
      ]),
      [
        {
          title: "Karma Police",
          artist: "Radiohead",
          album: "OK Computer",
          durationMs: 264_000,
          instrumental: false,
          plain: "Karma police",
          synced: "[00:26.78]Karma police",
        },
        {
          title: "Airbag",
          artist: "Radiohead",
          album: null,
          durationMs: 0,
          instrumental: true,
          plain: null,
          synced: null,
        },
      ],
    );
  });

  test("is null for a response that isn't a search result (a failed lookup)", () => {
    assert.equal(lrclibCandidates({ code: 429, message: "Too many requests" }), null);
    assert.equal(lrclibCandidates(null), null);
  });
});

const candidate = (overrides: Partial<LyricsCandidate> = {}): LyricsCandidate => ({
  title: "Karma Police",
  artist: "Radiohead",
  album: "OK Computer",
  durationMs: 264_000,
  instrumental: false,
  plain: "Karma police\nArrest this man",
  synced: "[00:26.78]Karma police\n[00:31.00]Arrest this man",
  ...overrides,
});

describe("pickFoundLyrics", () => {
  test("takes the synced lyrics of the matching song", () => {
    assert.deepEqual(pickFoundLyrics(song, [candidate()]), {
      synced: true,
      text: "[00:26.78]Karma police\n[00:31.00]Arrest this man",
    });
  });

  test("prefers synced lyrics, and takes plain ones when that's all there is", () => {
    const plainOnly = candidate({ synced: null, album: "OK Computer" });
    const synced = candidate({ album: "Best Of", synced: "[00:01.00]Synced" });
    assert.deepEqual(pickFoundLyrics(song, [plainOnly, synced]), {
      synced: true,
      text: "[00:01.00]Synced",
    });
    assert.deepEqual(pickFoundLyrics(song, [plainOnly]), {
      synced: false,
      text: "Karma police\nArrest this man",
    });
  });

  test("of equally good matches, takes the one from the song's album, then the closest length", () => {
    const otherAlbum = candidate({ album: "Live", synced: "[00:01.00]Live" });
    const sameAlbum = candidate({ album: "ok computer", synced: "[00:01.00]Album" });
    assert.equal(pickFoundLyrics(song, [otherAlbum, sameAlbum])?.text, "[00:01.00]Album");
    const off = candidate({ album: "A", durationMs: 265_500, synced: "[00:01.00]Off" });
    const close = candidate({ album: "B", durationMs: 264_400, synced: "[00:01.00]Close" });
    assert.equal(pickFoundLyrics(song, [off, close])?.text, "[00:01.00]Close");
  });

  test("only counts songs whose title and artist match, ignoring case, accents and punctuation", () => {
    assert.equal(pickFoundLyrics(song, [candidate({ title: "Karma Police Dub" })]), null);
    assert.equal(pickFoundLyrics(song, [candidate({ artist: "Radiohead Tribute" })]), null);
    assert.notEqual(
      pickFoundLyrics(song, [candidate({ title: "karma police!", artist: "RADIOHEAD" })]),
      null,
    );
    const accented = { ...song, title: "Hoppípolla", artist: "Sigur Rós" };
    assert.notEqual(
      pickFoundLyrics(accented, [candidate({ title: "Hoppipolla", artist: "Sigur Ros" })]),
      null,
    );
  });

  test("ignores featured artists and version notes in brackets", () => {
    const featuring = { ...song, title: "Song (feat. Guest)", artist: "Main feat. Guest" };
    assert.notEqual(
      pickFoundLyrics(featuring, [candidate({ title: "Song", artist: "Main" })]),
      null,
    );
    const remaster = { ...song, title: "Karma Police - Remastered 2017" };
    assert.notEqual(pickFoundLyrics(remaster, [candidate()]), null);
    assert.notEqual(
      pickFoundLyrics(song, [candidate({ title: "Karma Police [Remastered]" })]),
      null,
    );
  });

  test("only counts songs within 2 seconds of the song's length, when both are known", () => {
    assert.equal(pickFoundLyrics(song, [candidate({ durationMs: 267_000 })]), null);
    assert.notEqual(pickFoundLyrics(song, [candidate({ durationMs: 262_000 })]), null);
    assert.notEqual(pickFoundLyrics(song, [candidate({ durationMs: 0 })]), null);
    assert.notEqual(
      pickFoundLyrics({ ...song, durationMs: 0 }, [candidate({ durationMs: 1 })]),
      null,
    );
  });

  test("is null for instrumentals and songs without lyrics", () => {
    assert.equal(pickFoundLyrics(song, [candidate({ instrumental: true })]), null);
    assert.equal(pickFoundLyrics(song, [candidate({ plain: " ", synced: "" })]), null);
    assert.equal(pickFoundLyrics(song, []), null);
  });
});

describe("deezerTrackSearchUrl", () => {
  test("searches Deezer's tracks by artist and title", () => {
    assert.equal(
      deezerTrackSearchUrl(song),
      "https://api.deezer.com/search/track?q=Radiohead%20Karma%20Police&limit=25",
    );
  });
});

describe("deezerTrackCandidates", () => {
  test("reads the tracks of a search response, with their album", () => {
    assert.deepEqual(
      deezerTrackCandidates({
        data: [
          {
            id: 138539981,
            title: "Karma Police",
            duration: 264,
            artist: { id: 399, name: "Radiohead" },
            album: { id: 14879699, title: "OK Computer" },
          },
          { id: 2, title: "No album", artist: { name: "Radiohead" } },
        ],
        total: 2,
      }),
      [
        {
          title: "Karma Police",
          artist: "Radiohead",
          album: "OK Computer",
          albumId: 14879699,
          durationMs: 264_000,
        },
      ],
    );
  });

  test("is null for a response that isn't a search result", () => {
    assert.equal(deezerTrackCandidates({ error: { type: "Exception", code: 4 } }), null);
  });
});

const track = (overrides: Partial<GenreCandidate> = {}): GenreCandidate => ({
  title: "Karma Police",
  artist: "Radiohead",
  album: "OK Computer",
  albumId: 1,
  durationMs: 264_000,
  ...overrides,
});

describe("pickGenreAlbum", () => {
  test("is the album of the track that is the song", () => {
    assert.equal(pickGenreAlbum(song, [track({ title: "Airbag", albumId: 9 }), track()]), 1);
  });

  test("prefers the song's own album, then the closest length", () => {
    const live = track({ album: "Live at Glastonbury", albumId: 2, durationMs: 264_000 });
    const studio = track({ album: "OK Computer (Remastered)", albumId: 3, durationMs: 270_000 });
    assert.equal(pickGenreAlbum(song, [live, studio]), 3);
    const far = track({ album: "Best Of", albumId: 4, durationMs: 300_000 });
    const near = track({ album: "Hits", albumId: 5, durationMs: 265_000 });
    assert.equal(pickGenreAlbum(song, [far, near]), 5);
  });

  test("is null without a track whose title and artist match", () => {
    assert.equal(pickGenreAlbum(song, [track({ artist: "Someone Else" })]), null);
    assert.equal(pickGenreAlbum(song, []), null);
  });
});

describe("deezerAlbumGenre", () => {
  test("is the album's first genre", () => {
    assert.deepEqual(
      deezerAlbumGenre({
        id: 1,
        genre_id: 152,
        genres: {
          data: [
            { id: 152, name: "Rock" },
            { id: 85, name: "Alternative" },
          ],
        },
      }),
      { genre: "Rock" },
    );
    assert.equal(deezerAlbumUrl(14879699), "https://api.deezer.com/album/14879699");
  });

  test("finds no genre for an album without one", () => {
    assert.deepEqual(deezerAlbumGenre({ id: 1, genre_id: -1, genres: { data: [] } }), {
      genre: null,
    });
  });

  test("is null for a response that isn't an album (a failed lookup)", () => {
    assert.equal(deezerAlbumGenre({ error: { type: "DataException", code: 800 } }), null);
  });
});

const updated = (
  lyrics: TagWriteReport["lyrics"] = "tags",
  genre: TagWriteReport["genre"] = "tags",
): SongTagOutcome => ({ kind: "updated", written: { lyrics, genre } });
const notFound: SongTagOutcome = { kind: "notFound" };
const offline: SongTagOutcome = { kind: "failed", reason: "lookup" };
const unwritable: SongTagOutcome = { kind: "failed", reason: "write" };

describe("songTagOutcome", () => {
  test("is not found when nothing was found, so the file is left alone", () => {
    assert.deepEqual(songTagOutcome({ lyrics: null, genre: null }, null), notFound);
  });

  test("is updated with what was written", () => {
    assert.deepEqual(
      songTagOutcome(
        { lyrics: { synced: true, text: "[00:01.00]A" }, genre: null },
        { lyrics: "sidecar", genre: "none" },
      ),
      updated("sidecar", "none"),
    );
  });

  test("fails when only a genre was found and the format can't take it", () => {
    assert.deepEqual(
      songTagOutcome({ lyrics: null, genre: "Rock" }, { lyrics: "none", genre: "notWritten" }),
      { kind: "failed", reason: "format" },
    );
    assert.deepEqual(describeTagLookups([result("Airbag", { kind: "failed", reason: "format" })]), {
      title: "Couldn't update “Airbag”",
      message:
        "Only a genre was found, and Wave can't write tags to this file's format. It wasn't changed.",
    });
  });
});

describe("settledTags", () => {
  const lyrics = { synced: false, text: "Karma police, arrest this man" };
  const failedLookup = { ok: false } as const;

  test("keeps what one service found when the other couldn't be reached", () => {
    assert.deepEqual(settledTags({ ok: true, value: lyrics }, failedLookup), {
      lyrics,
      genre: null,
    });
    assert.deepEqual(settledTags(failedLookup, { ok: true, value: "Alternative" }), {
      lyrics: null,
      genre: "Alternative",
    });
  });

  test("one service answering is not a failed lookup, even with nothing found", () => {
    assert.deepEqual(settledTags(failedLookup, { ok: true, value: null }), {
      lyrics: null,
      genre: null,
    });
  });

  test("is a failed lookup (null) only when neither service could be reached", () => {
    assert.equal(settledTags(failedLookup, failedLookup), null);
    assert.deepEqual(settledTags({ ok: true, value: lyrics }, { ok: true, value: "Rock" }), {
      lyrics,
      genre: "Rock",
    });
  });
});

describe("lookupsUnreachable", () => {
  test("is true after three lookups in a row couldn't reach the services", () => {
    assert.equal(lookupsUnreachable([updated(), offline, offline]), false);
    assert.equal(lookupsUnreachable([updated(), offline, offline, offline]), true);
    assert.equal(lookupsUnreachable([offline, offline, notFound]), false);
  });

  test("doesn't count files that couldn't be written: the services answered", () => {
    assert.equal(lookupsUnreachable([unwritable, unwritable, unwritable]), false);
  });
});

describe("libraryLookupSongs", () => {
  const indexed = (title: string, hasLyrics: boolean, genre: string | null) => ({
    title,
    hasLyrics,
    genre,
  });

  test("looks up the songs missing lyrics or a genre, in order, and skips those with both", () => {
    const songs = [
      indexed("Both", true, "Rock"),
      indexed("No genre", true, null),
      indexed("No lyrics", false, "Rock"),
      indexed("Neither", false, null),
      indexed("Both again", true, "Jazz"),
    ];
    const run = libraryLookupSongs(songs);
    assert.deepEqual(
      run.lookUp.map((song) => song.title),
      ["No genre", "No lyrics", "Neither"],
    );
    assert.equal(run.skipped, 2);
  });

  test("hands back the songs as given, for the run to look them up", () => {
    const song = indexed("Neither", false, null);
    assert.equal(libraryLookupSongs([song]).lookUp[0], song);
  });

  test("counts a blank genre as none", () => {
    assert.equal(libraryLookupSongs([indexed("Blank", true, "  ")]).lookUp.length, 1);
  });

  test("an empty Library looks up and skips nothing", () => {
    assert.deepEqual(libraryLookupSongs([]), { lookUp: [], skipped: 0 });
  });
});

const result = (title: string, outcome: SongTagOutcome) => ({ title, outcome });

describe("describeTagLookups", () => {
  test("says what one song got", () => {
    assert.deepEqual(describeTagLookups([result("Airbag", updated())]), {
      title: "Lyrics and genre updated",
      message: "“Airbag” has new lyrics and a new genre.",
    });
    assert.deepEqual(describeTagLookups([result("Airbag", updated("none", "tags"))]), {
      title: "Genre updated",
      message: "“Airbag” has a new genre. No lyrics were found.",
    });
    assert.deepEqual(describeTagLookups([result("Airbag", updated("tags", "none"))]), {
      title: "Lyrics updated",
      message: "“Airbag” has new lyrics. No genre was found.",
    });
  });

  test("says when one song's lyrics went into a sidecar file", () => {
    assert.deepEqual(describeTagLookups([result("Airbag", updated("sidecar", "notWritten"))]), {
      title: "Lyrics updated",
      message:
        "Wave can't write tags to this file's format, so the lyrics were saved beside it as an .lrc file and the genre wasn't written.",
    });
  });

  test("says when nothing was found or a lookup failed", () => {
    assert.deepEqual(describeTagLookups([result("Airbag", notFound)]), {
      title: "Nothing found",
      message: "No lyrics or genre were found for “Airbag”. The file wasn't changed.",
    });
    assert.deepEqual(describeTagLookups([result("Airbag", offline)]), {
      title: "Couldn't look up “Airbag”",
      message: "LRCLIB or Deezer couldn't be reached. The file wasn't changed.",
    });
    assert.deepEqual(describeTagLookups([result("Airbag", unwritable)]), {
      title: "Couldn't update “Airbag”",
      message: "Wave couldn't write to the file. It wasn't changed.",
    });
  });

  test("sums up many songs: updated, not found, failed, and the sidecar files", () => {
    const results = [
      result("A", updated()),
      result("B", updated("sidecar", "notWritten")),
      result("C", notFound),
      result("D", offline),
      result("E", updated("sidecar", "notWritten")),
    ];
    assert.deepEqual(describeTagLookups(results), {
      title: "Lyrics and genre found",
      message:
        "3 updated · 1 not found · 1 failed\n\nLyrics saved as .lrc files, genre not written (Wave can't write tags to their format): B, E.",
    });
  });

  test("lists a few sidecar songs and counts the rest", () => {
    const results = ["A", "B", "C", "D", "E", "F", "G"].map((title) =>
      result(title, updated("sidecar", "none")),
    );
    assert.match(describeTagLookups(results).message, /: A, B, C, D, E and 2 more\.$/);
  });

  test("says how many songs the whole-Library run skipped as already having both", () => {
    const results = [result("A", updated()), result("B", notFound)];
    assert.deepEqual(describeTagLookups(results, undefined, 1_204), {
      title: "Lyrics and genre found",
      message:
        "1 updated · 1 not found · 0 failed\n\n1,204 songs already had lyrics and a genre, so they were skipped.",
    });
    assert.deepEqual(describeTagLookups(results, { left: 3, stopped: "cancelled" }, 1), {
      title: "Lyrics and genre stopped",
      message:
        "1 updated · 1 not found · 0 failed\n\n1 song already had lyrics and a genre, so it was skipped.\n\n3 songs weren't looked up.",
    });
  });

  test("sums up one song looked up beside skipped ones as a run, not as that song", () => {
    assert.deepEqual(describeTagLookups([result("A", updated())], undefined, 2), {
      title: "Lyrics and genre found",
      message:
        "1 updated · 0 not found · 0 failed\n\n2 songs already had lyrics and a genre, so they were skipped.",
    });
  });

  test("says when every song already had lyrics and a genre", () => {
    assert.deepEqual(describeTagLookups([], undefined, 40), {
      title: "Nothing to look up",
      message: "All 40 songs already have lyrics and a genre.",
    });
  });

  test("says how a run that stopped early ended", () => {
    const results = [result("A", updated()), result("B", notFound)];
    assert.deepEqual(describeTagLookups(results, { left: 10, stopped: "cancelled" }), {
      title: "Lyrics and genre stopped",
      message: "1 updated · 1 not found · 0 failed\n\n10 songs weren't looked up.",
    });
    assert.deepEqual(describeTagLookups(results, { left: 1, stopped: "unreachable" }), {
      title: "Lyrics and genre stopped",
      message:
        "1 updated · 1 not found · 0 failed\n\nLRCLIB and Deezer couldn't be reached, so 1 song wasn't looked up.",
    });
  });
});
