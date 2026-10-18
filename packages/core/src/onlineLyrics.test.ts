import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  LYRICS_MISS_RETRY_MS,
  nonDLyrics,
  nonDLyricsSong,
  unsearchedTrackId,
  ytMusicFoundLyrics,
  ytTrackId,
  type LyricsSearchSong,
} from "./index.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

const song: LyricsSearchSong = {
  lookup: { title: "Instant Crush", artist: "Daft Punk", album: null, durationMs: 337_000 },
  videoId: "crush",
};

const ON = { lookupsOn: true, ytMusicOn: true, now: 1_000_000 } as const;

describe("lyrics for a non-D song", () => {
  test("with nothing saved, LRCLIB is searched first", () => {
    assert.deepEqual(nonDLyrics(song, { ...ON, saved: null, answers: [] }), {
      kind: "searching",
      ask: "lrclib",
    });
  });

  test("lyrics LRCLIB finds show, synced, and are saved against the song's video", () => {
    const found = { synced: true, text: "[00:01.00]Hello\n[00:03.50]Again" };
    assert.deepEqual(
      nonDLyrics(song, { ...ON, saved: null, answers: [{ ok: true, lyrics: found }] }),
      {
        kind: "lyrics",
        lyrics: {
          kind: "synced",
          lines: [
            { timeMs: 1000, text: "Hello" },
            { timeMs: 3500, text: "Again" },
          ],
        },
        save: { videoId: "crush", saved: { kind: "found", lyrics: found } },
      },
    );
  });

  test("when LRCLIB has nothing, YT Music's lyrics for the video are next, and show as plain lyrics", () => {
    const nothing = { ok: true, lyrics: null } as const;
    assert.deepEqual(nonDLyrics(song, { ...ON, saved: null, answers: [nothing] }), {
      kind: "searching",
      ask: "ytMusic",
    });
    const found = { synced: false, text: "Hello\n\nAgain" };
    assert.deepEqual(
      nonDLyrics(song, { ...ON, saved: null, answers: [nothing, { ok: true, lyrics: found }] }),
      {
        kind: "lyrics",
        lyrics: { kind: "unsynced", lines: ["Hello", "", "Again"] },
        save: { videoId: "crush", saved: { kind: "found", lyrics: found } },
      },
    );
  });

  test("no lyrics anywhere is a miss, remembered from now", () => {
    const nothing = { ok: true, lyrics: null } as const;
    assert.deepEqual(nonDLyrics(song, { ...ON, saved: null, answers: [nothing, nothing] }), {
      kind: "notFound",
      save: { videoId: "crush", saved: { kind: "miss", checkedAt: ON.now } },
    });
  });

  test("a source that can't be reached still lets the next one answer", () => {
    const found = { synced: false, text: "Hello" };
    assert.deepEqual(nonDLyrics(song, { ...ON, saved: null, answers: [{ ok: false }] }), {
      kind: "searching",
      ask: "ytMusic",
    });
    assert.deepEqual(
      nonDLyrics(song, {
        ...ON,
        saved: null,
        answers: [{ ok: false }, { ok: true, lyrics: found }],
      }),
      {
        kind: "lyrics",
        lyrics: { kind: "unsynced", lines: ["Hello"] },
        save: { videoId: "crush", saved: { kind: "found", lyrics: found } },
      },
    );
  });

  test("finding nothing while a source couldn't be reached is a failure, and nothing is remembered", () => {
    const nothing = { ok: true, lyrics: null } as const;
    for (const answers of [
      [{ ok: false }, nothing],
      [nothing, { ok: false }],
      [{ ok: false }, { ok: false }],
    ] as const) {
      assert.deepEqual(nonDLyrics(song, { ...ON, saved: null, answers }), { kind: "failed" });
    }
  });

  test("saved lyrics show at once, with no search and nothing to save again", () => {
    const saved = { kind: "found", lyrics: { synced: false, text: "Hello" } } as const;
    assert.deepEqual(nonDLyrics(song, { ...ON, saved, answers: [] }), {
      kind: "lyrics",
      lyrics: { kind: "unsynced", lines: ["Hello"] },
      save: null,
    });
  });

  test("a song with no video yet searches LRCLIB only and saves nothing", () => {
    const unsearched = { ...song, videoId: null };
    const nothing = { ok: true, lyrics: null } as const;
    assert.deepEqual(nonDLyrics(unsearched, { ...ON, saved: null, answers: [nothing] }), {
      kind: "notFound",
      save: null,
    });
    const found = { synced: true, text: "[00:01.00]Hello" };
    assert.deepEqual(
      nonDLyrics(unsearched, { ...ON, saved: null, answers: [{ ok: true, lyrics: found }] }),
      {
        kind: "lyrics",
        lyrics: { kind: "synced", lines: [{ timeMs: 1000, text: "Hello" }] },
        save: null,
      },
    );
  });

  test("YT Music is asked only while it's on, and LRCLIB only for a song it can look up", () => {
    const nothing = { ok: true, lyrics: null } as const;
    assert.deepEqual(
      nonDLyrics(song, { ...ON, ytMusicOn: false, saved: null, answers: [nothing] }),
      { kind: "notFound", save: { videoId: "crush", saved: { kind: "miss", checkedAt: ON.now } } },
    );
    const unknownArtist = { ...song, lookup: null };
    assert.deepEqual(nonDLyrics(unknownArtist, { ...ON, saved: null, answers: [] }), {
      kind: "searching",
      ask: "ytMusic",
    });
  });

  test("a song neither source can be asked about has no lyrics found, and nothing is remembered", () => {
    assert.deepEqual(
      nonDLyrics({ lookup: null, videoId: null }, { ...ON, saved: null, answers: [] }),
      { kind: "notFound", save: null },
    );
  });

  test("a song only YT Music could be asked about, with YT Music off, remembers no miss", () => {
    const unknownArtist = { ...song, lookup: null };
    assert.deepEqual(
      nonDLyrics(unknownArtist, { ...ON, ytMusicOn: false, saved: null, answers: [] }),
      { kind: "notFound", save: null },
    );
  });

  test("an answer whose lyrics have no words counts as none", () => {
    const empty = { synced: true, text: "[ti:Instant Crush]\n[ar:Daft Punk]" };
    assert.deepEqual(
      nonDLyrics(song, { ...ON, saved: null, answers: [{ ok: true, lyrics: empty }] }),
      {
        kind: "searching",
        ask: "ytMusic",
      },
    );
  });

  test("YT Music's lyrics are plain text, tidied; blank is none", () => {
    assert.deepEqual(ytMusicFoundLyrics("Hello\r\nAgain\r\n\r\n"), {
      synced: false,
      text: "Hello\nAgain",
    });
    assert.equal(ytMusicFoundLyrics("  \n "), null);
    assert.equal(ytMusicFoundLyrics(null), null);
  });

  test("with Fix songs online off nothing is searched, but lyrics already saved still show", () => {
    const off = { ...ON, lookupsOn: false };
    assert.deepEqual(nonDLyrics(song, { ...off, saved: null, answers: [] }), { kind: "off" });
    const miss = { kind: "miss", checkedAt: 0 } as const;
    assert.deepEqual(nonDLyrics(song, { ...off, saved: miss, answers: [] }), { kind: "off" });
    const saved = { kind: "found", lyrics: { synced: false, text: "Hello" } } as const;
    assert.equal(nonDLyrics(song, { ...off, saved, answers: [] }).kind, "lyrics");
  });

  test("a remembered miss shows No lyrics found for a week, then the song is searched again", () => {
    const missedAt = ON.now;
    const saved = { kind: "miss", checkedAt: missedAt } as const;
    const sixDaysOn = missedAt + 6 * DAY_MS;
    assert.deepEqual(nonDLyrics(song, { ...ON, now: sixDaysOn, saved, answers: [] }), {
      kind: "notFound",
      save: null,
    });
    const aWeekOn = missedAt + LYRICS_MISS_RETRY_MS;
    assert.equal(LYRICS_MISS_RETRY_MS, 7 * DAY_MS);
    assert.deepEqual(nonDLyrics(song, { ...ON, now: aWeekOn, saved, answers: [] }), {
      kind: "searching",
      ask: "lrclib",
    });
  });
});

describe("which songs are non-D", () => {
  const listed = {
    title: "Instant Crush (feat. Julian Casablancas)",
    artists: ["Daft Punk", "Julian Casablancas"],
    album: "Random Access Memories",
    durationMs: 337_000,
  };
  const lookup = {
    title: "Instant Crush (feat. Julian Casablancas)",
    artist: "Daft Punk",
    album: "Random Access Memories",
    durationMs: 337_000,
  };

  test("a YT Music song is looked up by its title, first artist, album and length, and goes by its video", () => {
    assert.deepEqual(nonDLyricsSong(ytTrackId("crush"), listed), { lookup, videoId: "crush" });
  });

  test("an unsearched song is looked up by what its listing says, and has no video yet", () => {
    const id = unsearchedTrackId({ ...listed, artworkUrl: null });
    assert.deepEqual(nonDLyricsSong(id, null), { lookup, videoId: null });
  });

  test("a YT Music song whose details aren't known yet waits for them before any search", () => {
    // Asking YT Music alone would save its plain lyrics, or a miss, before LRCLIB was ever asked.
    assert.equal(nonDLyricsSong(ytTrackId("crush"), null), null);
  });

  test("a Library track isn't non-D", () => {
    assert.equal(nonDLyricsSong("42", listed), null);
  });
});
