import assert from "node:assert/strict";
import { describe, test } from "node:test";
import { COLLABORATIVE_TEXT_MAX_LENGTH, collaborativeRow, memberPlaylistFields } from "./index.ts";

const ytSong = (overrides: Readonly<Record<string, unknown>> = {}): string =>
  JSON.stringify({
    videoId: "vid-1",
    title: "Song",
    artists: ["Ana"],
    album: "Album",
    albumId: null,
    durationMs: 200_000,
    artworkUrl: "https://lh3.googleusercontent.com/abc=w120-h120",
    explicit: false,
    ...overrides,
  });

const entry = (
  overrides: Readonly<Record<string, unknown>> = {},
): Readonly<Record<string, unknown>> => ({
  id: "entry-1",
  changedAt: 1,
  phoneId: "phone-a",
  deleted: false,
  playlistId: "list-1",
  orderKey: "a0",
  songId: null,
  ytSong: ytSong(),
  addedAt: 1,
  ...overrides,
});

const coverOf = (row: Readonly<Record<string, unknown>>): unknown =>
  (JSON.parse(String(row.ytSong)) as { artworkUrl: unknown }).artworkUrl;

describe("collaborativeRow", () => {
  test("keeps a cover on YouTube's or Google's image hosts", () => {
    for (const url of [
      "https://lh3.googleusercontent.com/abc=w120-h120",
      "https://yt3.ggpht.com/abc=s88",
      "https://i.ytimg.com/vi/vid-1/hqdefault.jpg",
      "https://i9.ytimg.com/vi_webp/vid-1/sddefault.webp",
    ]) {
      const row = collaborativeRow(
        "playlistEntries",
        entry({ ytSong: ytSong({ artworkUrl: url }) }),
      );
      assert.equal(coverOf(row), url);
    }
  });

  test("drops a cover anywhere else", () => {
    for (const url of [
      "https://example.com/cover.jpg",
      "http://i.ytimg.com/vi/vid-1/hqdefault.jpg",
      "https://i.ytimg.com.example.com/vi/x.jpg",
      "https://googleusercontent.com.evil.test/a",
      "https://user@lh3.googleusercontent.com/a",
      "https://lh3.googleusercontent.com:8443/a",
      "file:///sdcard/cover.jpg",
      "not an address",
    ]) {
      const row = collaborativeRow(
        "playlistEntries",
        entry({ ytSong: ytSong({ artworkUrl: url }) }),
      );
      assert.equal(coverOf(row), null, url);
    }
  });

  test("leaves the rest of the stored song as it was", () => {
    const row = collaborativeRow(
      "playlistEntries",
      entry({ ytSong: ytSong({ artworkUrl: "https://example.com/a.jpg" }) }),
    );
    assert.deepEqual(JSON.parse(String(row.ytSong)), {
      ...JSON.parse(ytSong()),
      artworkUrl: null,
    });
  });

  test("cuts the stored song's title, artists and album to the length of a real name", () => {
    const long = "x".repeat(COLLABORATIVE_TEXT_MAX_LENGTH + 50);
    const row = collaborativeRow(
      "playlistEntries",
      entry({ ytSong: ytSong({ title: long, artists: [long, "Bo"], album: long }) }),
    );
    const song = JSON.parse(String(row.ytSong)) as Record<string, unknown>;
    const cut = "x".repeat(COLLABORATIVE_TEXT_MAX_LENGTH);
    assert.equal(song.title, cut);
    assert.deepEqual(song.artists, [cut, "Bo"]);
    assert.equal(song.album, cut);
  });

  test("cuts a Library entry's title, artist credit and album", () => {
    const long = "é".repeat(COLLABORATIVE_TEXT_MAX_LENGTH + 1);
    const row = collaborativeRow(
      "playlistEntries",
      entry({ ytSong: null, songId: "key-1", title: long, credit: long, album: long }),
    );
    const cut = "é".repeat(COLLABORATIVE_TEXT_MAX_LENGTH);
    assert.equal(row.title, cut);
    assert.equal(row.credit, cut);
    assert.equal(row.album, cut);
  });

  test("never cuts a character in half", () => {
    const long = "🎵".repeat(COLLABORATIVE_TEXT_MAX_LENGTH + 1);
    const row = collaborativeRow("playlists", {
      id: "list-1",
      name: long,
      createdAt: 1,
    });
    assert.equal(row.name, "🎵".repeat(COLLABORATIVE_TEXT_MAX_LENGTH));
  });

  test("cuts a playlist's name and keeps a name that fits", () => {
    const long = "n".repeat(COLLABORATIVE_TEXT_MAX_LENGTH + 1);
    assert.equal(
      collaborativeRow("playlists", { id: "list-1", name: long }).name,
      "n".repeat(COLLABORATIVE_TEXT_MAX_LENGTH),
    );
    const fits = { id: "list-1", name: "Road trip", createdAt: 1 };
    assert.equal(collaborativeRow("playlists", fits), fits);
  });

  test("gives back a row it doesn't change as the same object", () => {
    const fits = entry();
    assert.equal(collaborativeRow("playlistEntries", fits), fits);
    const tombstone = { id: "entry-2", changedAt: 2, phoneId: "p", deleted: true };
    assert.equal(collaborativeRow("playlistEntries", tombstone), tombstone);
  });

  test("leaves a stored song it can't read as it is", () => {
    const unreadable = entry({ ytSong: "not json" });
    assert.equal(collaborativeRow("playlistEntries", unreadable), unreadable);
  });

  test("bounds an unsearched entry's song too", () => {
    const stored = JSON.stringify({
      unsearched: true,
      title: "t".repeat(COLLABORATIVE_TEXT_MAX_LENGTH + 1),
      artists: ["Ana"],
      album: null,
      durationMs: null,
      artworkUrl: "https://example.com/a.jpg",
    });
    const song = JSON.parse(
      String(collaborativeRow("playlistEntries", entry({ ytSong: stored })).ytSong),
    ) as Record<string, unknown>;
    assert.equal(song.title, "t".repeat(COLLABORATIVE_TEXT_MAX_LENGTH));
    assert.equal(song.artworkUrl, null);
    assert.equal(song.unsearched, true);
  });
});

describe("a member's change to a collaborative playlist's row", () => {
  const stored = { name: "Road trip", createdAt: 1_700_000_000_000 };

  test("takes the member's name and keeps every other field as stored", () => {
    assert.deepEqual(memberPlaylistFields(stored, { name: "Road trip 2", createdAt: 5 }), {
      name: "Road trip 2",
      createdAt: 1_700_000_000_000,
    });
  });

  test("keeps a field the stored row has and the member's row leaves out", () => {
    assert.deepEqual(memberPlaylistFields(stored, { name: "Road trip 2" }), {
      name: "Road trip 2",
      createdAt: 1_700_000_000_000,
    });
  });
});
