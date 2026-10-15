import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  LRCLIB_HEADERS,
  deezerAlbum,
  deezerAlbumTracks,
  deezerAlbumTracksUrl,
  deezerTags,
  deezerAlbumUrl,
  deezerTrackCandidates,
  deezerTrackSearchUrl,
  describeTagLookups,
  canFixSong,
  deezerFollowUps,
  fixLookups,
  lookupsUnreachable,
  missingTags,
  lrclibCandidates,
  lrclibSearchUrl,
  pickFoundLyrics,
  pickDeezerTrack,
  settledTags,
  songLookup,
  songTagOutcome,
  songsToFix,
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
          trackId: 138539981,
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
  trackId: 100,
  title: "Karma Police",
  artist: "Radiohead",
  album: "OK Computer",
  albumId: 1,
  durationMs: 264_000,
  ...overrides,
});

describe("pickDeezerTrack", () => {
  test("is the track that is the song, with its album", () => {
    assert.deepEqual(
      pickDeezerTrack(song, [track({ title: "Airbag", trackId: 7, albumId: 9 }), track()]),
      { trackId: 100, albumId: 1, onSongsAlbum: true },
    );
  });

  test("prefers the song's own album, then the closest length", () => {
    const live = track({ album: "Live at Glastonbury", albumId: 2, durationMs: 264_000 });
    const studio = track({ album: "OK Computer (Remastered)", albumId: 3, durationMs: 270_000 });
    assert.equal(pickDeezerTrack(song, [live, studio])?.albumId, 3);
    const far = track({ album: "Best Of", albumId: 4, durationMs: 300_000 });
    const near = track({ album: "Hits", albumId: 5, durationMs: 265_000 });
    assert.equal(pickDeezerTrack(song, [far, near])?.albumId, 5);
  });

  test("says when the track is only found on another album", () => {
    const hits = track({ album: "Hits", albumId: 5 });
    assert.equal(pickDeezerTrack(song, [hits])?.onSongsAlbum, false);
    assert.equal(pickDeezerTrack({ ...song, album: null }, [track()])?.onSongsAlbum, false);
  });

  test("is null without a track whose title and artist match", () => {
    assert.equal(pickDeezerTrack(song, [track({ artist: "Someone Else" })]), null);
    assert.equal(pickDeezerTrack(song, []), null);
  });
});

describe("deezerAlbum", () => {
  test("is the album's first genre and the year it came out", () => {
    assert.deepEqual(
      deezerAlbum({
        id: 1,
        genre_id: 152,
        genres: {
          data: [
            { id: 152, name: "Rock" },
            { id: 85, name: "Alternative" },
          ],
        },
        release_date: "1997-05-21",
      }),
      { genre: "Rock", year: 1997 },
    );
    assert.equal(deezerAlbumUrl(14879699), "https://api.deezer.com/album/14879699");
  });

  test("finds no genre for an album without one", () => {
    assert.deepEqual(
      deezerAlbum({ id: 1, genre_id: -1, genres: { data: [] }, release_date: "2001-03-07" }),
      { genre: null, year: 2001 },
    );
  });

  test("finds no year without a release date, or with a malformed one", () => {
    const album = { id: 1, genres: { data: [{ id: 152, name: "Rock" }] } };
    for (const release_date of [undefined, null, "", "0000-00-00", "soon", 1997, "97-05-21"])
      assert.deepEqual(deezerAlbum({ ...album, release_date }), { genre: "Rock", year: null });
  });

  test("is null for a response that isn't an album (a failed lookup)", () => {
    assert.equal(deezerAlbum({ error: { type: "DataException", code: 800 } }), null);
  });
});

describe("deezerAlbumTracks", () => {
  test("reads each track's number and disc on the album", () => {
    assert.equal(
      deezerAlbumTracksUrl(14879699),
      "https://api.deezer.com/album/14879699/tracks?limit=500",
    );
    assert.deepEqual(
      deezerAlbumTracks({
        data: [
          { id: 11, title: "Airbag", track_position: 1, disk_number: 1 },
          { id: 16, title: "Karma Police", track_position: 6, disk_number: 1 },
          { id: 99, title: "No place" },
          { id: 98, title: "Bad place", track_position: 0, disk_number: 1 },
        ],
        total: 4,
      }),
      [
        { trackId: 11, trackNumber: 1, discNumber: 1 },
        { trackId: 16, trackNumber: 6, discNumber: 1 },
      ],
    );
  });

  test("leaves the disc out when Deezer doesn't give one", () => {
    assert.deepEqual(deezerAlbumTracks({ data: [{ id: 11, track_position: 3 }] }), [
      { trackId: 11, trackNumber: 3, discNumber: null },
    ]);
  });

  test("is null for a response that isn't a tracklist (a failed lookup)", () => {
    assert.equal(deezerAlbumTracks({ error: { type: "DataException", code: 800 } }), null);
  });
});

describe("deezerTags", () => {
  const match = { trackId: 16, albumId: 1, onSongsAlbum: true };
  const album = { genre: "Alternative", year: 1997 };
  const tracklist = [
    { trackId: 11, trackNumber: 1, discNumber: 1 },
    { trackId: 16, trackNumber: 6, discNumber: 1 },
  ];

  test("is the album's genre and year and the track's number on it", () => {
    assert.deepEqual(deezerTags(match, album, tracklist), {
      genre: "Alternative",
      trackNumber: 6,
      discNumber: null,
      year: 1997,
    });
  });

  test("gives the disc only for an album on more than one disc", () => {
    const twoDiscs = [...tracklist, { trackId: 21, trackNumber: 1, discNumber: 2 }];
    assert.equal(deezerTags(match, album, twoDiscs).discNumber, 1);
    assert.equal(deezerTags({ ...match, trackId: 21 }, album, twoDiscs).discNumber, 2);
    assert.equal(deezerTags({ ...match, trackId: 21 }, album, twoDiscs).trackNumber, 1);
  });

  test("has no track number without the tracklist, or when the track isn't on it", () => {
    assert.deepEqual(deezerTags(match, album, null), {
      genre: "Alternative",
      trackNumber: null,
      discNumber: null,
      year: 1997,
    });
    assert.equal(deezerTags({ ...match, trackId: 404 }, album, tracklist).trackNumber, null);
  });

  test("has no genre or year when the album wasn't fetched (the song has both)", () => {
    assert.deepEqual(deezerTags(match, null, tracklist), {
      genre: null,
      trackNumber: 6,
      discNumber: null,
      year: null,
    });
  });

  test("takes only the genre from another album than the song's", () => {
    assert.deepEqual(deezerTags({ ...match, onSongsAlbum: false }, album, tracklist), {
      genre: "Alternative",
      trackNumber: null,
      discNumber: null,
      year: null,
    });
  });
});

/** A lookup that found nothing at all. */
const nothingFound = { lyrics: null, genre: null, trackNumber: null, discNumber: null, year: null };

const report = (written: Partial<TagWriteReport> = {}): TagWriteReport => ({
  lyrics: "none",
  genre: "none",
  trackNumber: "none",
  year: "none",
  ...written,
});
const updated = (
  lyrics: TagWriteReport["lyrics"] = "tags",
  genre: TagWriteReport["genre"] = "tags",
  place: Partial<TagWriteReport> = {},
): SongTagOutcome => ({ kind: "updated", written: report({ lyrics, genre, ...place }) });
const notFound: SongTagOutcome = { kind: "notFound" };
const offline: SongTagOutcome = { kind: "failed", reason: "lookup" };
const unwritable: SongTagOutcome = { kind: "failed", reason: "write" };

describe("songTagOutcome", () => {
  const lyrics = { synced: true, text: "[00:01.00]A" };
  const place = { trackNumber: 3, discNumber: null, year: 1997 };

  test("is not found when nothing was found, so the file is left alone", () => {
    assert.deepEqual(songTagOutcome(nothingFound, null), notFound);
    assert.deepEqual(songTagOutcome(nothingFound, report()), notFound);
  });

  test("is updated with what was written", () => {
    assert.deepEqual(
      songTagOutcome({ ...nothingFound, lyrics }, report({ lyrics: "sidecar" })),
      updated("sidecar", "none"),
    );
  });

  test("is updated when the track number and year were the only things written", () => {
    const written = report({ trackNumber: "tags", year: "tags" });
    assert.deepEqual(songTagOutcome({ ...nothingFound, ...place }, written), {
      kind: "updated",
      written,
    });
    assert.deepEqual(
      songTagOutcome({ ...nothingFound, year: 1997 }, report({ year: "tags" })).kind,
      "updated",
    );
  });

  test("a track number and year the format can't take aren't a failure on their own", () => {
    const opus = { trackNumber: "notWritten", year: "notWritten" } as const;
    assert.deepEqual(
      songTagOutcome({ ...nothingFound, lyrics, ...place }, report({ lyrics: "sidecar", ...opus })),
      updated("sidecar", "none", opus),
    );
    assert.deepEqual(songTagOutcome({ ...nothingFound, ...place }, report(opus)), notFound);
  });

  test("fails when no lyrics were found and the format can't take the genre", () => {
    assert.deepEqual(
      songTagOutcome(
        { ...nothingFound, genre: "Rock", year: 1997 },
        report({ genre: "notWritten", year: "notWritten" }),
      ),
      { kind: "failed", reason: "format" },
    );
    assert.deepEqual(describeTagLookups([result("Airbag", { kind: "failed", reason: "format" })]), {
      title: "Couldn't update “Airbag”",
      message:
        "No lyrics were found, and Wave can't write tags to this file's format. It wasn't changed.",
    });
  });
});

describe("settledTags", () => {
  const lyrics = { synced: false, text: "Karma police, arrest this man" };
  const deezer = { genre: "Alternative", trackNumber: 6, discNumber: null, year: 1997 };
  const failedLookup = { ok: false } as const;

  test("is what LRCLIB and Deezer found together", () => {
    assert.deepEqual(settledTags({ ok: true, value: lyrics }, { ok: true, value: deezer }), {
      lyrics,
      ...deezer,
    });
  });

  test("keeps what one service found when the other couldn't be reached", () => {
    assert.deepEqual(settledTags({ ok: true, value: lyrics }, failedLookup), {
      ...nothingFound,
      lyrics,
    });
    assert.deepEqual(settledTags(failedLookup, { ok: true, value: deezer }), {
      lyrics: null,
      ...deezer,
    });
  });

  test("one service answering is not a failed lookup, even with nothing found", () => {
    assert.deepEqual(settledTags(failedLookup, { ok: true, value: null }), nothingFound);
  });

  test("is a failed lookup (null) only when neither service could be reached", () => {
    assert.equal(settledTags(failedLookup, failedLookup), null);
  });

  test("a service that wasn't asked (null) found nothing, and didn't answer either", () => {
    assert.deepEqual(settledTags(null, { ok: true, value: deezer }), { lyrics: null, ...deezer });
    assert.deepEqual(settledTags({ ok: true, value: lyrics }, null), { ...nothingFound, lyrics });
    assert.equal(settledTags(null, failedLookup), null);
    assert.equal(settledTags(failedLookup, null), null);
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

const indexed = (
  title: string,
  hasLyrics: boolean,
  genre: string | null,
  place: { trackNumber: number | null; year: number | null } = { trackNumber: 1, year: 1997 },
) => ({ title, hasLyrics, genre, ...place });

describe("canFixSong", () => {
  test("is whether a song lacks lyrics, a track number, a year or a genre", () => {
    assert.equal(canFixSong(indexed("Everything", true, "Rock")), false);
    assert.equal(canFixSong(indexed("No lyrics", false, "Rock")), true);
    assert.equal(canFixSong(indexed("No genre", true, null)), true);
    assert.equal(
      canFixSong(indexed("No number", true, "Rock", { trackNumber: null, year: 1 })),
      true,
    );
    assert.equal(
      canFixSong(indexed("No year", true, "Rock", { trackNumber: 1, year: null })),
      true,
    );
  });

  test("counts a blank genre and a track number or year of 0 as none", () => {
    assert.equal(canFixSong(indexed("Blank", true, "  ")), true);
    assert.equal(canFixSong(indexed("Zeros", true, "Rock", { trackNumber: 0, year: 1 })), true);
    assert.equal(canFixSong(indexed("Zeros", true, "Rock", { trackNumber: 1, year: 0 })), true);
  });
});

describe("songsToFix", () => {
  test("fixes the songs missing something, in order, and skips those that have everything", () => {
    const songs = [
      indexed("Everything", true, "Rock"),
      indexed("No genre", true, null),
      indexed("No lyrics", false, "Rock"),
      indexed("No number", true, "Rock", { trackNumber: null, year: 1997 }),
      indexed("Everything again", true, "Jazz"),
      indexed("Zero year", true, "Rock", { trackNumber: 4, year: 0 }),
    ];
    const run = songsToFix(songs);
    assert.deepEqual(
      run.fix.map((fixed) => fixed.title),
      ["No genre", "No lyrics", "No number", "Zero year"],
    );
    assert.equal(run.skipped, 2);
  });

  test("hands back the songs as given, for the run to fix them", () => {
    const given = indexed("Neither", false, null);
    assert.equal(songsToFix([given]).fix[0], given);
  });

  test("an empty Library fixes and skips nothing", () => {
    assert.deepEqual(songsToFix([]), { fix: [], skipped: 0 });
  });
});

describe("fixLookups", () => {
  test("searches LRCLIB only for a song without lyrics", () => {
    assert.equal(fixLookups(indexed("No lyrics", false, "Rock")).lyrics, true);
    assert.equal(fixLookups(indexed("No genre", true, null)).lyrics, false);
  });

  test("asks Deezer only for a song missing a genre, a track number or a year", () => {
    assert.equal(fixLookups(indexed("No lyrics", false, "Rock")).deezer, false);
    assert.equal(fixLookups(indexed("No genre", true, null)).deezer, true);
    const unnumbered = indexed("No number", true, "Rock", { trackNumber: null, year: 1997 });
    assert.equal(fixLookups(unnumbered).deezer, true);
    const undated = indexed("No year", true, "Rock", { trackNumber: 1, year: null });
    assert.equal(fixLookups(undated).deezer, true);
  });

  test("a song that has everything makes no request", () => {
    assert.deepEqual(fixLookups(indexed("Everything", true, "Rock")), {
      lyrics: false,
      deezer: false,
    });
  });
});

describe("deezerFollowUps", () => {
  const ownAlbum = { trackId: 16, albumId: 1, onSongsAlbum: true };
  const otherAlbum = { ...ownAlbum, onSongsAlbum: false };
  const place = (trackNumber: number | null, year: number | null) => ({ trackNumber, year });

  test("fetches the album for a missing genre, whichever album matched", () => {
    const untagged = indexed("No genre", true, null);
    assert.equal(deezerFollowUps(untagged, ownAlbum).album, true);
    assert.equal(deezerFollowUps(untagged, otherAlbum).album, true);
  });

  test("fetches the album for a missing year only when it's the song's own", () => {
    const undated = indexed("No year", true, "Rock", place(1, null));
    assert.equal(deezerFollowUps(undated, ownAlbum).album, true);
    assert.equal(deezerFollowUps(undated, otherAlbum).album, false);
  });

  test("skips the album when the song has its genre and year", () => {
    const unnumbered = indexed("No number", true, "Rock", place(null, 1997));
    assert.equal(deezerFollowUps(unnumbered, ownAlbum).album, false);
  });

  test("fetches the tracklist only for a missing track number, on the song's own album", () => {
    const unnumbered = indexed("No number", true, "Rock", place(null, 1997));
    assert.equal(deezerFollowUps(unnumbered, ownAlbum).tracklist, true);
    assert.equal(deezerFollowUps(unnumbered, otherAlbum).tracklist, false);
    assert.equal(deezerFollowUps(indexed("No genre", true, null), ownAlbum).tracklist, false);
  });
});

describe("missingTags", () => {
  const found = {
    lyrics: { synced: true, text: "[00:01.00] Hey" },
    genre: "Rock",
    trackNumber: 3,
    discNumber: null,
    year: 1997,
  };
  const bare = { hasLyrics: false, genre: null, trackNumber: null, year: null };

  test("keeps everything a song lacks", () => {
    assert.deepEqual(missingTags(found, bare), found);
  });

  test("never replaces lyrics or a genre the song already has", () => {
    assert.deepEqual(missingTags(found, { ...bare, hasLyrics: true, genre: "Indie" }), {
      ...found,
      lyrics: null,
      genre: null,
    });
    assert.deepEqual(missingTags(found, { ...bare, hasLyrics: true }), {
      ...found,
      lyrics: null,
    });
    assert.deepEqual(missingTags(found, { ...bare, genre: "Indie" }), { ...found, genre: null });
  });

  test("never replaces a track number or year the song already has", () => {
    assert.deepEqual(missingTags(found, { ...bare, trackNumber: 1, year: 2020 }), {
      ...found,
      trackNumber: null,
      year: null,
    });
  });

  test("counts a blank genre as none", () => {
    assert.equal(missingTags(found, { ...bare, hasLyrics: true, genre: " " }).genre, "Rock");
  });
});

const result = (title: string, outcome: SongTagOutcome) => ({ title, outcome });

describe("describeTagLookups", () => {
  test("says what one song got", () => {
    assert.deepEqual(describeTagLookups([result("Airbag", updated())]), {
      title: "Song fixed",
      message: "Filled in the lyrics and genre of “Airbag”.",
    });
    assert.deepEqual(describeTagLookups([result("Airbag", updated("none", "tags"))]), {
      title: "Song fixed",
      message: "Filled in the genre of “Airbag”.",
    });
    assert.deepEqual(describeTagLookups([result("Airbag", updated("tags", "none"))]), {
      title: "Song fixed",
      message: "Filled in the lyrics of “Airbag”.",
    });
  });

  test("says when one song's track number or year was filled in", () => {
    const both = { trackNumber: "tags", year: "tags" } as const;
    assert.deepEqual(describeTagLookups([result("Airbag", updated("tags", "tags", both))]), {
      title: "Song fixed",
      message: "Filled in the lyrics, genre, track number and year of “Airbag”.",
    });
    assert.equal(
      describeTagLookups([result("Airbag", updated("none", "tags", { year: "tags" }))]).message,
      "Filled in the genre and year of “Airbag”.",
    );
    assert.equal(
      describeTagLookups([result("Airbag", updated("none", "none", { trackNumber: "tags" }))])
        .message,
      "Filled in the track number of “Airbag”.",
    );
  });

  test("says when one song's lyrics went into a sidecar file", () => {
    assert.deepEqual(describeTagLookups([result("Airbag", updated("sidecar", "notWritten"))]), {
      title: "Song fixed",
      message:
        "Wave can't write tags to this file's format, so the lyrics were saved beside it as an .lrc file and the genre wasn't written.",
    });
    const opus = { trackNumber: "notWritten", year: "notWritten" } as const;
    assert.deepEqual(
      describeTagLookups([result("Airbag", updated("sidecar", "notWritten", opus))]),
      {
        title: "Song fixed",
        message:
          "Wave can't write tags to this file's format, so the lyrics were saved beside it as an .lrc file and the genre, track number and year weren't written.",
      },
    );
    assert.deepEqual(
      describeTagLookups([result("Airbag", updated("sidecar", "none", { year: "notWritten" }))])
        .message,
      "Wave can't write tags to this file's format, so the lyrics were saved beside it as an .lrc file and the year wasn't written.",
    );
  });

  test("says when nothing was found or a lookup failed", () => {
    assert.deepEqual(describeTagLookups([result("Airbag", notFound)]), {
      title: "Nothing found",
      message: "Nothing “Airbag” is missing was found. The file wasn't changed.",
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

  test("sums up many songs: fixed, not found, failed, and the sidecar files", () => {
    const results = [
      result("A", updated()),
      result("B", updated("sidecar", "notWritten")),
      result("C", notFound),
      result("D", offline),
      result("E", updated("sidecar", "notWritten")),
    ];
    assert.deepEqual(describeTagLookups(results), {
      title: "Songs fixed",
      message:
        "3 fixed · 1 not found · 1 failed\n\nLyrics saved as .lrc files, genre not written (Wave can't write tags to their format): B, E.",
    });
  });

  test("lists a few sidecar songs and counts the rest", () => {
    const results = ["A", "B", "C", "D", "E", "F", "G"].map((title) =>
      result(title, updated("sidecar", "none")),
    );
    assert.match(describeTagLookups(results).message, /: A, B, C, D, E and 2 more\.$/);
  });

  test("counts a song whose track number and year were all that was written as fixed", () => {
    const placeOnly = updated("none", "none", { trackNumber: "tags", year: "tags" });
    const results = [result("A", placeOnly), result("B", notFound)];
    assert.match(describeTagLookups(results).message, /^1 fixed · 1 not found · 0 failed$/);
  });

  test("says how many songs were skipped as already having everything", () => {
    const results = [result("A", updated()), result("B", notFound)];
    assert.deepEqual(describeTagLookups(results, undefined, 1_204), {
      title: "Songs fixed",
      message:
        "1 fixed · 1 not found · 0 failed\n\n1,204 songs already had lyrics, a genre, a track number and a year, so they were skipped.",
    });
    assert.deepEqual(describeTagLookups(results, { left: 3, stopped: "cancelled" }, 1), {
      title: "Fix Songs stopped",
      message:
        "1 fixed · 1 not found · 0 failed\n\n1 song already had lyrics, a genre, a track number and a year, so it was skipped.\n\n3 songs weren't looked up.",
    });
  });

  test("sums up one song looked up beside skipped ones as a run, not as that song", () => {
    assert.deepEqual(describeTagLookups([result("A", updated())], undefined, 2), {
      title: "Songs fixed",
      message:
        "1 fixed · 0 not found · 0 failed\n\n2 songs already had lyrics, a genre, a track number and a year, so they were skipped.",
    });
  });

  test("says when every song already had everything", () => {
    assert.deepEqual(describeTagLookups([], undefined, 40), {
      title: "Nothing to fix",
      message: "All 40 songs already have lyrics, a genre, a track number and a year.",
    });
    assert.equal(
      describeTagLookups([], undefined, 1).message,
      "The only song already has lyrics, a genre, a track number and a year.",
    );
  });

  test("says how a run that stopped early ended", () => {
    const results = [result("A", updated()), result("B", notFound)];
    assert.deepEqual(describeTagLookups(results, { left: 10, stopped: "cancelled" }), {
      title: "Fix Songs stopped",
      message: "1 fixed · 1 not found · 0 failed\n\n10 songs weren't looked up.",
    });
    assert.deepEqual(describeTagLookups(results, { left: 1, stopped: "unreachable" }), {
      title: "Fix Songs stopped",
      message:
        "1 fixed · 1 not found · 0 failed\n\nLRCLIB and Deezer couldn't be reached, so 1 song wasn't looked up.",
    });
  });
});
