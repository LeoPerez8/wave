import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  isUnsearchedTrackId,
  parseTrackId,
  playlistPlayback,
  unsearchedTrackId,
  type PlaylistItem,
  readPlaylistEntrySong,
  readPlaylistYtSong,
  settleUnsearched,
  unsearchedSearchQuery,
  unsearchedSettles,
  writePlaylistEntrySong,
  type UnsearchedEntry,
  type UnsearchedSong,
  type YtSong,
} from "./index.ts";

const listed = (title: string, fields: Partial<UnsearchedSong> = {}): UnsearchedSong => ({
  title,
  artists: ["Daft Punk"],
  album: "Random Access Memories",
  durationMs: 369_000,
  artworkUrl: "https://i.scdn.co/image/ram",
  ...fields,
});

const unsearched = (title: string, fields: Partial<UnsearchedSong> = {}): UnsearchedEntry => ({
  source: "unsearched",
  song: listed(title, fields),
});

const yt = (videoId: string, title: string, fields: Partial<YtSong> = {}): YtSong => ({
  videoId,
  title,
  artists: ["Daft Punk"],
  album: "Random Access Memories",
  durationMs: 369_000,
  artworkUrl: null,
  explicit: false,
  ...fields,
});

describe("what a YouTube Music search settles of an unsearched song", () => {
  const song = listed("Giorgio by Moroder", { durationMs: 544_000 });

  test("it's searched by its title and artists, as an import searched", () => {
    assert.equal(unsearchedSearchQuery(song), "Giorgio by Moroder Daft Punk");
  });

  test("found: the first result that is the recording, as a YT Music entry", () => {
    const live = yt("live", "Giorgio by Moroder (Live)", { durationMs: 544_000 });
    const cut = yt("cut", "Giorgio by Moroder", { durationMs: 545_000 });
    const later = yt("later", "Giorgio by Moroder", { durationMs: 544_000 });
    assert.deepEqual(settleUnsearched(song, { ok: true, songs: [live, cut, later] }), {
      kind: "found",
      becomes: { source: "stream", song: cut },
    });
  });

  test("not found: an unavailable entry in its place, keeping what Spotify listed", () => {
    const other = yt("other", "Touch", { durationMs: 498_000 });
    assert.deepEqual(settleUnsearched(song, { ok: true, songs: [other] }), {
      kind: "notFound",
      becomes: { source: "unavailable", song: { ...song, reason: "notFound" } },
    });
    assert.equal(settleUnsearched(song, { ok: true, songs: [] }).kind, "notFound");
  });

  test("a search that fails never makes it unavailable: it stays unsearched", () => {
    for (const reason of ["offline", "failed", "disabled"] as const) {
      assert.deepEqual(settleUnsearched(song, { ok: false, reason }), {
        kind: "failed",
        reason,
      });
    }
  });
});

describe("an unsearched song settled, in every playlist that holds it", () => {
  const cut = yt("cut", "Giorgio by Moroder");
  const found = { source: "stream", song: cut } as const;

  test("each entry holding it becomes what it settled as, in its place", () => {
    const holders = [
      { itemId: 10, playlistId: 1 },
      { itemId: 20, playlistId: 2 },
    ];
    assert.deepEqual(unsearchedSettles(holders, found, []), { rewrites: [10, 20], drops: [] });
  });

  test("a playlist that already holds the song it became loses the entry instead", () => {
    const holders = [
      { itemId: 10, playlistId: 1 },
      { itemId: 20, playlistId: 2 },
    ];
    const held = [
      { playlistId: 2, song: { source: "stream", song: yt("cut", "Giorgio by Moroder") } },
      { playlistId: 3, song: { source: "stream", song: cut } },
    ] as const;
    assert.deepEqual(unsearchedSettles(holders, found, held), { rewrites: [10], drops: [20] });
  });

  test("two entries of one playlist that settle as one song keep only the first", () => {
    const holders = [
      { itemId: 10, playlistId: 1 },
      { itemId: 11, playlistId: 1 },
    ];
    assert.deepEqual(unsearchedSettles(holders, found, []), { rewrites: [10], drops: [11] });
  });

  test("not found, it's unavailable in its place, unless the playlist has that unavailable song", () => {
    const song = listed("Touch");
    const settled = settleUnsearched(song, { ok: true, songs: [] });
    assert.equal(settled.kind, "notFound");
    if (settled.kind !== "notFound") return;
    const holders = [
      { itemId: 10, playlistId: 1 },
      { itemId: 20, playlistId: 2 },
    ];
    const held = [{ playlistId: 2, song: settled.becomes }];
    assert.deepEqual(unsearchedSettles(holders, settled.becomes, held), {
      rewrites: [10],
      drops: [20],
    });
  });
});

describe("a playlist with unsearched entries, played", () => {
  type Track = { readonly id: number };
  const own = (id: number): PlaylistItem<YtSong, Track> => ({ source: "library", track: { id } });
  const entries = [own(1), unsearched("Touch"), own(2), unsearched("Within")];

  test("with YT Music on, they play in their places, as YT Music entries do", () => {
    assert.deepEqual(playlistPlayback(entries, { ytMusic: true, startIndex: 1 }), {
      playback: { kind: "mixed", songs: entries },
      startIndex: 1,
    });
  });

  test("with YT Music off, they show but don't play: a tapped one plays nothing", () => {
    assert.deepEqual(playlistPlayback(entries, { ytMusic: false }), {
      playback: { kind: "library", tracks: [{ id: 1 }, { id: 2 }] },
      startIndex: undefined,
    });
    assert.equal(playlistPlayback(entries, { ytMusic: false, startIndex: 3 }), null);
  });

  test("each goes by its own id in the queue, never a Library id or a YT Music one", () => {
    const id = unsearchedTrackId(listed("Touch"));
    assert.equal(isUnsearchedTrackId(id), true);
    assert.notEqual(id, unsearchedTrackId(listed("Touch", { durationMs: 1000 })));
    assert.equal(id, unsearchedTrackId(listed("Touch", { artworkUrl: null })));
    assert.equal(parseTrackId(id), null);
    assert.equal(isUnsearchedTrackId("yt:abc"), false);
    assert.equal(isUnsearchedTrackId("12"), false);
  });
});

describe("how a playlist stores an unsearched entry", () => {
  test("it keeps what Spotify listed and reads back as unsearched", () => {
    const entry = unsearched("Giorgio by Moroder");
    assert.deepEqual(readPlaylistEntrySong(writePlaylistEntrySong(entry)), entry);
  });

  test("with no video id and no reason it's unavailable, so an older Wave reads it as nothing", () => {
    const stored = writePlaylistEntrySong(unsearched("Touch", { album: null, durationMs: null }));
    assert.equal(readPlaylistYtSong(stored), null);
    const fields = JSON.parse(stored) as Record<string, unknown>;
    assert.equal(fields["videoId"], undefined);
    assert.equal(fields["unavailable"], undefined);
    assert.equal(fields["unsearched"], true);
  });

  test("one marked unsearched without a readable song is nothing", () => {
    assert.equal(readPlaylistEntrySong(JSON.stringify({ unsearched: true, title: 3 })), null);
    assert.equal(
      readPlaylistEntrySong(JSON.stringify({ ...listed("Touch"), unsearched: "yes" })),
      null,
    );
  });
});
