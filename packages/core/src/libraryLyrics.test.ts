import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { libraryLyrics, libraryLyricsSong, type LyricsSearchSong } from "./index.ts";

const song: LyricsSearchSong = {
  lookup: { title: "Instant Crush", artist: "Daft Punk", album: null, durationMs: 337_000 },
  videoId: null,
};

const DAY_MS = 24 * 60 * 60 * 1000;

const NONE = { kind: "none" } as const;

const ON = { lookupsOn: true, ytMusicOn: true, now: 1_000_000, missedAt: null } as const;

describe("lyrics for a Library song", () => {
  test("lyrics in its file (tags or a sidecar) show, with no search and nothing to write", () => {
    const file = { kind: "unsynced", lines: ["Hello"] } as const;
    assert.deepEqual(libraryLyrics(song, { ...ON, file, answers: [] }), {
      kind: "lyrics",
      lyrics: file,
      write: null,
    });
  });

  test("a file without lyrics searches LRCLIB first, and a hit shows and is written into the file", () => {
    assert.deepEqual(libraryLyrics(song, { ...ON, file: NONE, answers: [] }), {
      kind: "searching",
      ask: "lrclib",
    });
    const found = { synced: true, text: "[00:01.00]Hello" };
    assert.deepEqual(
      libraryLyrics(song, { ...ON, file: NONE, answers: [{ ok: true, lyrics: found }] }),
      {
        kind: "lyrics",
        lyrics: { kind: "synced", lines: [{ timeMs: 1000, text: "Hello" }] },
        write: found,
      },
    );
  });

  test("a song from a YT Music video asks YT Music next; nothing anywhere is a miss, remembered from now", () => {
    const fromVideo = { ...song, videoId: "crush" };
    const nothing = { ok: true, lyrics: null } as const;
    assert.deepEqual(libraryLyrics(fromVideo, { ...ON, file: NONE, answers: [nothing] }), {
      kind: "searching",
      ask: "ytMusic",
    });
    assert.deepEqual(libraryLyrics(fromVideo, { ...ON, file: NONE, answers: [nothing, nothing] }), {
      kind: "none",
      remember: ON.now,
    });
    assert.deepEqual(libraryLyrics(song, { ...ON, file: NONE, answers: [nothing] }), {
      kind: "none",
      remember: ON.now,
    });
  });

  test("finding nothing while a source couldn't be reached is a failure, and nothing is remembered", () => {
    assert.deepEqual(libraryLyrics(song, { ...ON, file: NONE, answers: [{ ok: false }] }), {
      kind: "failed",
    });
  });

  test("a remembered miss shows No lyrics for a week with no search, then the song is searched again", () => {
    const missedAt = ON.now;
    const sixDaysOn = { ...ON, missedAt, now: missedAt + 6 * DAY_MS };
    assert.deepEqual(libraryLyrics(song, { ...sixDaysOn, file: NONE, answers: [] }), {
      kind: "none",
      remember: null,
    });
    const aWeekOn = { ...ON, missedAt, now: missedAt + 7 * DAY_MS };
    assert.deepEqual(libraryLyrics(song, { ...aWeekOn, file: NONE, answers: [] }), {
      kind: "searching",
      ask: "lrclib",
    });
  });

  test("with Fix songs online off, a file without lyrics shows No lyrics and nothing is searched", () => {
    const off = { ...ON, lookupsOn: false };
    assert.deepEqual(libraryLyrics(song, { ...off, file: NONE, answers: [] }), {
      kind: "none",
      remember: null,
    });
    const file = { kind: "unsynced", lines: ["Hello"] } as const;
    assert.equal(libraryLyrics(song, { ...off, file, answers: [] }).kind, "lyrics");
  });

  test("a song neither source can be asked about shows No lyrics, and nothing is remembered", () => {
    assert.deepEqual(
      libraryLyrics({ lookup: null, videoId: null }, { ...ON, file: NONE, answers: [] }),
      { kind: "none", remember: null },
    );
  });
});

describe("what a Library song's lyrics search goes by", () => {
  const track = {
    title: "Instant Crush",
    artist: "Daft Punk, Julian Casablancas",
    album: "Random Access Memories",
    durationMs: 337_000,
    videoId: null,
  };

  test("its tags, as Fix Song sends them, and no video for a song not from YT Music", () => {
    assert.deepEqual(libraryLyricsSong(track), {
      lookup: {
        title: "Instant Crush",
        artist: "Daft Punk, Julian Casablancas",
        album: "Random Access Memories",
        durationMs: 337_000,
      },
      videoId: null,
    });
  });

  test("a song downloaded from YT Music goes by its video too", () => {
    assert.equal(libraryLyricsSong({ ...track, videoId: "crush" }).videoId, "crush");
  });

  test("a song Fix Song never looks up (Unknown Artist) isn't sent to LRCLIB", () => {
    assert.equal(libraryLyricsSong({ ...track, artist: "Unknown Artist" }).lookup, null);
  });
});
