import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  planPlaylistSongs,
  playlistEntryLinks,
  playlistPlayback,
  readPlaylistYtSong,
  writePlaylistYtSong,
  ytDownloadTags,
  type MixedSong,
  type PlaylistSong,
  type YtAlbumSong,
} from "./index.ts";

const yt = (videoId: string, fields: Partial<YtAlbumSong> = {}): YtAlbumSong => ({
  videoId,
  title: `Song ${videoId}`,
  artists: ["Justice"],
  album: "Cross",
  albumId: "MPREb_cross",
  durationMs: 200_000,
  artworkUrl: `https://lh3.googleusercontent.com/${videoId}`,
  explicit: false,
  ...fields,
});

const library = (trackId: number): PlaylistSong => ({ source: "library", trackId });
const stream = (song: YtAlbumSong): PlaylistSong<YtAlbumSong> => ({ source: "stream", song });

describe("planPlaylistSongs", () => {
  test("Library songs and YT Music songs go at the end, in the order given", () => {
    const plan = planPlaylistSongs([library(1)], [stream(yt("a")), library(2), stream(yt("b"))]);
    assert.deepEqual(plan, {
      add: [stream(yt("a")), library(2), stream(yt("b"))],
      alreadyIn: 0,
    });
  });

  test("a YT Music song the playlist holds is skipped, told apart by its video id", () => {
    const plan = planPlaylistSongs(
      [stream(yt("a")), library(1)],
      [stream(yt("a", { title: "Renamed" })), stream(yt("b")), library(1)],
    );
    assert.deepEqual(plan, { add: [stream(yt("b"))], alreadyIn: 2 });
  });

  test("a song given twice goes in once", () => {
    const plan = planPlaylistSongs([], [stream(yt("a")), stream(yt("a")), library(3), library(3)]);
    assert.deepEqual(plan, { add: [stream(yt("a")), library(3)], alreadyIn: 0 });
  });

  test("a Library track and a YT Music song never count as the same entry", () => {
    // Video ids are letters; a Library id is a number: the keys can't meet.
    const plan = planPlaylistSongs([library(7)], [stream(yt("7"))]);
    assert.deepEqual(plan.add, [stream(yt("7"))]);
  });
});

describe("writePlaylistYtSong / readPlaylistYtSong", () => {
  test("a YT Music entry keeps what shows it without asking YouTube", () => {
    const song = yt("a", { artists: ["Justice", "Tame Impala"], explicit: true });
    assert.deepEqual(readPlaylistYtSong(writePlaylistYtSong(song)), song);
  });

  test("only the song's own fields are kept", () => {
    const song = { ...yt("a"), progress: 0.5 };
    assert.deepEqual(readPlaylistYtSong(writePlaylistYtSong(song)), yt("a"));
  });

  test("unknown album, length and cover come back as unknown", () => {
    const song = yt("a", { album: null, albumId: null, durationMs: null, artworkUrl: null });
    assert.deepEqual(readPlaylistYtSong(writePlaylistYtSong(song)), song);
  });

  test("what isn't a song reads as nothing", () => {
    assert.equal(readPlaylistYtSong("not json"), null);
    assert.equal(readPlaylistYtSong("null"), null);
    assert.equal(readPlaylistYtSong(JSON.stringify({ title: "No id", artists: [] })), null);
    assert.equal(readPlaylistYtSong(JSON.stringify({ ...yt("a"), artists: "Justice" })), null);
  });
});

describe("playlistPlayback", () => {
  type Track = { readonly id: number };
  const own = (id: number): MixedSong<YtAlbumSong, Track> => ({ source: "library", track: { id } });
  const streamed = (videoId: string): MixedSong<YtAlbumSong, Track> => ({
    source: "stream",
    song: yt(videoId),
  });
  const entries = [own(1), streamed("a"), own(2), streamed("b")];

  test("with YT Music on, the whole list plays in order, from the tapped entry", () => {
    assert.deepEqual(playlistPlayback(entries, { ytMusic: true, startIndex: 3 }), {
      playback: { kind: "mixed", songs: entries },
      startIndex: 3,
    });
    assert.deepEqual(playlistPlayback(entries, { ytMusic: true }), {
      playback: { kind: "mixed", songs: entries },
      startIndex: undefined,
    });
  });

  test("with YT Music off, Play plays the Library's songs", () => {
    assert.deepEqual(playlistPlayback(entries, { ytMusic: false }), {
      playback: { kind: "library", tracks: [{ id: 1 }, { id: 2 }] },
      startIndex: undefined,
    });
  });

  test("with YT Music off, a tapped Library song plays the Library's songs from it", () => {
    assert.deepEqual(playlistPlayback(entries, { ytMusic: false, startIndex: 2 }), {
      playback: { kind: "library", tracks: [{ id: 1 }, { id: 2 }] },
      startIndex: 1,
    });
  });

  test("with YT Music off, a tapped YT Music entry doesn't play", () => {
    assert.equal(playlistPlayback(entries, { ytMusic: false, startIndex: 1 }), null);
  });

  test("with only YT Music entries and YT Music off, there's nothing to play", () => {
    assert.equal(playlistPlayback([streamed("a")], { ytMusic: false }), null);
  });

  test("a playlist of Library songs alone plays as it always has", () => {
    assert.deepEqual(playlistPlayback([own(1), own(2)], { ytMusic: true, startIndex: 1 }), {
      playback: { kind: "library", tracks: [{ id: 1 }, { id: 2 }] },
      startIndex: 1,
    });
  });
});

describe("playlistEntryLinks", () => {
  const track = (id: number, title: string, artist: string, durationMs = 200_000) => ({
    id,
    title,
    artist,
    durationMs,
  });

  test("an entry the Library now has, the same recording, becomes that Library song", () => {
    const entries = [
      { itemId: 10, song: yt("a", { title: "Genesis" }) },
      { itemId: 11, song: yt("b", { title: "Phantom" }) },
    ];
    const songs = [track(1, "Genesis", "Justice", 201_000), track(2, "Stress", "Justice")];
    assert.deepEqual(playlistEntryLinks(entries, songs), [{ itemId: 10, trackId: 1 }]);
  });

  test("every entry of that song links, whichever playlist holds it", () => {
    const entries = [
      { itemId: 10, song: yt("a", { title: "Genesis" }) },
      { itemId: 42, song: yt("a", { title: "Genesis" }) },
    ];
    assert.deepEqual(playlistEntryLinks(entries, [track(1, "Genesis", "Justice")]), [
      { itemId: 10, trackId: 1 },
      { itemId: 42, trackId: 1 },
    ]);
  });

  test("matched as Search and Discover match: featured credits and remaster notes aside", () => {
    const entries = [{ itemId: 10, song: yt("a", { title: "D.A.N.C.E. (feat. Uffie)" }) }];
    const songs = [track(1, "D.A.N.C.E. - 2017 Remaster", "Justice feat. Uffie")];
    assert.deepEqual(playlistEntryLinks(entries, songs), [{ itemId: 10, trackId: 1 }]);
  });

  test("a live take or an edit of the song stays streamed", () => {
    const entries = [{ itemId: 10, song: yt("a", { title: "Genesis" }) }];
    assert.deepEqual(playlistEntryLinks(entries, [track(1, "Genesis", "Justice", 260_000)]), []);
  });

  test("a namesake by another artist stays streamed", () => {
    const entries = [{ itemId: 10, song: yt("a", { title: "Genesis" }) }];
    assert.deepEqual(playlistEntryLinks(entries, [track(1, "Genesis", "Grimes")]), []);
  });

  test("an entry downloaded becomes the song its download's tags describe", () => {
    // A playlist download: the file is tagged from the entry's own song (`ytDownloadTags`),
    // and its length is within the 3 s a Soulseek file is accepted at.
    const song = yt("a", { title: "Sunflower", artists: ["Post Malone", "Swae Lee"] });
    const tags = ytDownloadTags(song, null, null, null);
    const downloaded = track(7, tags.title, tags.artist, 202_900);
    assert.deepEqual(playlistEntryLinks([{ itemId: 10, song }], [downloaded]), [
      { itemId: 10, trackId: 7 },
    ]);
  });

  test("nothing to link when there are no entries or no new songs", () => {
    assert.deepEqual(playlistEntryLinks([], [track(1, "Genesis", "Justice")]), []);
    assert.deepEqual(playlistEntryLinks([{ itemId: 10, song: yt("a") }], []), []);
  });
});
