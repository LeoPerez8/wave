import assert from "node:assert/strict";
import { describe, test } from "node:test";
import {
  duplicatePlaylistEntries,
  playlistEntrySong,
  writePlaylistEntrySong,
  writePlaylistYtSong,
  type DuplicateCandidate,
} from "./index.ts";

const yt = (videoId: string, title: string, artists: string[], durationMs: number | null) =>
  writePlaylistYtSong({
    videoId,
    title,
    artists,
    album: null,
    durationMs,
    artworkUrl: null,
    explicit: false,
  });

const entry = (
  id: string,
  addedAt: number,
  fields: { songId?: string | null; ytSong?: string | null },
  more: Partial<DuplicateCandidate> = {},
): DuplicateCandidate => ({
  id,
  playlistId: "p1",
  addedAt,
  deleted: false,
  song: playlistEntrySong({ songId: fields.songId ?? null, ytSong: fields.ytSong ?? null }),
  ...more,
});

const removed = (entries: readonly DuplicateCandidate[]): string[] =>
  duplicatePlaylistEntries(entries).map((candidate) => candidate.id);

describe("one entry per song", () => {
  test("of two entries with one recording key, the one added later goes", () => {
    const first = entry("b", 100, { songId: "key-airbag" });
    const second = entry("a", 200, { songId: "key-airbag" });
    assert.deepEqual(removed([second, first]), ["a"]);
    assert.deepEqual(removed([first, second]), ["a"]);
  });

  test("added at the same time, the higher entry id goes", () => {
    const one = entry("e1", 100, { songId: "key-airbag" });
    const two = entry("e2", 100, { songId: "key-airbag" });
    assert.deepEqual(removed([two, one]), ["e2"]);
  });

  test("two entries with one video id are one song", () => {
    const first = entry("a", 100, { ytSong: yt("vid1", "Airbag", ["Radiohead"], 284_000) });
    const second = entry("b", 200, { ytSong: yt("vid1", "Airbag - Remix", ["Other"], 100_000) });
    assert.deepEqual(removed([first, second]), ["b"]);
  });

  test("a matching title, a shared artist and a length within 3 seconds are one song", () => {
    const first = entry("a", 100, { ytSong: yt("vid1", "Airbag", ["Radiohead"], 284_000) });
    const second = entry("b", 200, {
      ytSong: yt("vid2", "Airbag (Remastered)", ["Radiohead", "Someone"], 286_500),
    });
    const listed = entry("c", 300, {
      ytSong: writePlaylistEntrySong({
        source: "unsearched",
        song: {
          title: "airbag",
          artists: ["Radiohead"],
          album: "OK Computer",
          durationMs: 285_000,
          artworkUrl: null,
        },
      }),
    });
    assert.deepEqual(removed([first, second, listed]), ["b", "c"]);
  });

  test("a live take or a copy of another length is another song and stays", () => {
    const studio = entry("a", 100, { ytSong: yt("vid1", "Airbag", ["Radiohead"], 284_000) });
    const live = entry("b", 200, { ytSong: yt("vid2", "Airbag (Live)", ["Radiohead"], 284_000) });
    const longer = entry("c", 300, { ytSong: yt("vid3", "Airbag", ["Radiohead"], 290_000) });
    const otherArtist = entry("d", 400, { ytSong: yt("vid4", "Airbag", ["Someone"], 284_000) });
    assert.deepEqual(removed([studio, live, longer, otherArtist]), []);
  });

  test("a title match needs a length on both entries", () => {
    const known = entry("a", 100, { ytSong: yt("vid1", "Airbag", ["Radiohead"], 284_000) });
    const unknown = entry("b", 200, { ytSong: yt("vid2", "Airbag", ["Radiohead"], null) });
    assert.deepEqual(removed([known, unknown]), []);
  });

  test("a Library entry and a streamed one share nothing without the same fields", () => {
    const library = entry("a", 100, { songId: "key-airbag" });
    const streamed = entry("b", 200, { ytSong: yt("vid1", "Airbag", ["Radiohead"], 284_000) });
    assert.deepEqual(removed([library, streamed]), []);
  });

  test("entries of other playlists and removed entries don't count", () => {
    const first = entry("a", 100, { songId: "key-airbag" });
    const elsewhere = entry("b", 200, { songId: "key-airbag" }, { playlistId: "p2" });
    const gone = entry("c", 50, { songId: "key-airbag" }, { deleted: true });
    assert.deepEqual(removed([first, elsewhere, gone]), []);
  });

  test("an entry that goes holds no place: a third entry is compared with those that stay", () => {
    const studio = entry("a", 100, { ytSong: yt("vid1", "Airbag", ["Radiohead"], 284_000) });
    // Same video as the first, so it goes; its title alone would match the third.
    const copy = entry("b", 200, { ytSong: yt("vid1", "Lucky", ["Radiohead"], 260_000) });
    const lucky = entry("c", 300, { ytSong: yt("vid2", "Lucky", ["Radiohead"], 260_000) });
    assert.deepEqual(removed([studio, copy, lucky]), ["b"]);
  });

  test("the same entries give the same answer in any order", () => {
    const entries = [
      entry("a", 300, { songId: "k1" }),
      entry("b", 100, { songId: "k1" }),
      entry("c", 200, { ytSong: yt("v", "Lucky", ["Radiohead"], 260_000) }),
      entry("d", 200, { ytSong: yt("v", "Lucky", ["Radiohead"], 260_000) }),
    ];
    const expected = removed(entries);
    assert.deepEqual(expected, ["a", "d"]);
    assert.deepEqual(removed([...entries].reverse()), expected);
  });

  test("an entry whose stored song can't be read is compared by nothing", () => {
    assert.deepEqual(playlistEntrySong({ songId: null, ytSong: "not json" }), {
      recordingKey: null,
      videoId: null,
      title: null,
      artists: [],
      durationMs: null,
    });
  });
});
