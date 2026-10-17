import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  planPlaylistSongs,
  playlistEntryLinks,
  playlistPlayback,
  readPlaylistEntrySong,
  readPlaylistYtSong,
  UNAVAILABLE_ENTRY_ACTION_LABELS,
  playlistSongsLine,
  playlistUnplayableNotice,
  unavailableEntryActions,
  unavailableEntryView,
  unavailableSearchQuery,
  writePlaylistEntrySong,
  writePlaylistYtSong,
  ytDownloadTags,
  type MixedSong,
  type PlaylistSong,
  type UnavailableEntry,
  type UnavailableSong,
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
const unavailable = (title: string, fields: Partial<UnavailableSong> = {}): UnavailableEntry => ({
  source: "unavailable",
  song: {
    title,
    artists: ["Daft Punk"],
    album: "Random Access Memories",
    durationMs: 228_000,
    artworkUrl: null,
    reason: "notFound",
    ...fields,
  },
});

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

describe("writePlaylistEntrySong / readPlaylistEntrySong", () => {
  test("a YT Music entry and an unavailable one each read back as what they are", () => {
    const missing = unavailable("Fragments of Time", { artworkUrl: "https://i.scdn.co/image/f" });
    const streamed = { source: "stream", song: yt("a") } as const;
    assert.deepEqual(readPlaylistEntrySong(writePlaylistEntrySong(streamed)), streamed);
    assert.deepEqual(readPlaylistEntrySong(writePlaylistEntrySong(missing)), missing);
  });

  test("an unavailable song keeps what its source listed, unknowns included", () => {
    const missing = unavailable("Untitled", {
      artists: [],
      album: null,
      durationMs: null,
      reason: "localFile",
    });
    assert.deepEqual(readPlaylistEntrySong(writePlaylistEntrySong(missing)), missing);
  });

  test("a version of Wave that reads only YT Music entries reads an unavailable one as nothing", () => {
    assert.equal(readPlaylistYtSong(writePlaylistEntrySong(unavailable("Within"))), null);
  });

  test("what isn't a song reads as nothing", () => {
    assert.equal(readPlaylistEntrySong("not json"), null);
    assert.equal(
      readPlaylistEntrySong(JSON.stringify({ unavailable: "notFound", artists: [] })),
      null,
    );
    assert.equal(
      readPlaylistEntrySong(JSON.stringify({ ...unavailable("Within").song, unavailable: "gone" })),
      null,
    );
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

  test("unavailable entries are skipped, by Play, Shuffle and a tap alike", () => {
    const listed = [own(1), unavailable("Within"), streamed("a"), unavailable("Untitled"), own(2)];
    const playing = [own(1), streamed("a"), own(2)];
    assert.deepEqual(playlistPlayback(listed, { ytMusic: true }), {
      playback: { kind: "mixed", songs: playing },
      startIndex: undefined,
    });
    assert.deepEqual(playlistPlayback(listed, { ytMusic: true, startIndex: 4 }), {
      playback: { kind: "mixed", songs: playing },
      startIndex: 2,
    });
    assert.deepEqual(playlistPlayback(listed, { ytMusic: false, startIndex: 4 }), {
      playback: { kind: "library", tracks: [{ id: 1 }, { id: 2 }] },
      startIndex: 1,
    });
  });

  test("a tapped unavailable entry doesn't play, nor does a playlist of nothing else", () => {
    const listed = [own(1), unavailable("Within")];
    assert.equal(playlistPlayback(listed, { ytMusic: true, startIndex: 1 }), null);
    assert.equal(playlistPlayback([unavailable("Within")], { ytMusic: true }), null);
  });

  test("Library songs and unavailable entries play as Library songs alone", () => {
    assert.deepEqual(playlistPlayback([unavailable("Within"), own(1)], { ytMusic: true }), {
      playback: { kind: "library", tracks: [{ id: 1 }] },
      startIndex: undefined,
    });
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
  /** Entry [itemId] of playlist [playlistId]. */
  const entry = (itemId: number, song: YtAlbumSong, playlistId = 1) => ({
    itemId,
    playlistId,
    song,
  });
  const linked = (...links: { itemId: number; trackId: number }[]) => ({ links, drops: [] });

  test("an entry the Library now has, the same recording, becomes that Library song", () => {
    const entries = [
      entry(10, yt("a", { title: "Genesis" })),
      entry(11, yt("b", { title: "Phantom" })),
    ];
    const songs = [track(1, "Genesis", "Justice", 201_000), track(2, "Stress", "Justice")];
    assert.deepEqual(playlistEntryLinks(entries, songs, []), linked({ itemId: 10, trackId: 1 }));
  });

  test("every entry of that song links, whichever playlist holds it", () => {
    const entries = [
      entry(10, yt("a", { title: "Genesis" }), 1),
      entry(42, yt("a", { title: "Genesis" }), 2),
    ];
    assert.deepEqual(
      playlistEntryLinks(entries, [track(1, "Genesis", "Justice")], []),
      linked({ itemId: 10, trackId: 1 }, { itemId: 42, trackId: 1 }),
    );
  });

  test("an entry for a song its playlist already holds from the Library is dropped, not doubled", () => {
    const entries = [
      entry(10, yt("a", { title: "Genesis" }), 1),
      entry(42, yt("a", { title: "Genesis" }), 2),
    ];
    assert.deepEqual(
      playlistEntryLinks(
        entries,
        [track(1, "Genesis", "Justice")],
        [{ playlistId: 1, trackId: 1 }],
      ),
      { links: [{ itemId: 42, trackId: 1 }], drops: [10] },
    );
  });

  test("of two entries of one playlist that become the same Library song, the later is dropped", () => {
    // Two uploads of one recording: different video ids, one Library song.
    const entries = [
      entry(10, yt("a", { title: "Genesis" })),
      entry(11, yt("b", { title: "Genesis", durationMs: 201_000 })),
    ];
    assert.deepEqual(playlistEntryLinks(entries, [track(1, "Genesis", "Justice")], []), {
      links: [{ itemId: 10, trackId: 1 }],
      drops: [11],
    });
  });

  test("matched as Search and Discover match: featured credits and remaster notes aside", () => {
    const entries = [entry(10, yt("a", { title: "D.A.N.C.E. (feat. Uffie)" }))];
    const songs = [track(1, "D.A.N.C.E. - 2017 Remaster", "Justice feat. Uffie")];
    assert.deepEqual(playlistEntryLinks(entries, songs, []), linked({ itemId: 10, trackId: 1 }));
  });

  test("a live take or an edit of the song stays streamed", () => {
    const entries = [entry(10, yt("a", { title: "Genesis" }))];
    assert.deepEqual(
      playlistEntryLinks(entries, [track(1, "Genesis", "Justice", 260_000)], []),
      linked(),
    );
  });

  test("a namesake by another artist stays streamed", () => {
    const entries = [entry(10, yt("a", { title: "Genesis" }))];
    assert.deepEqual(playlistEntryLinks(entries, [track(1, "Genesis", "Grimes")], []), linked());
  });

  test("an entry downloaded becomes the song its download's tags describe", () => {
    // A playlist download: the file is tagged from the entry's own song (`ytDownloadTags`),
    // and its length is within the 3 s a Soulseek file is accepted at.
    const song = yt("a", { title: "Sunflower", artists: ["Post Malone", "Swae Lee"] });
    const tags = ytDownloadTags(song, null, null, null);
    const downloaded = track(7, tags.title, tags.artist, 202_900);
    assert.deepEqual(
      playlistEntryLinks([entry(10, song)], [downloaded], []),
      linked({ itemId: 10, trackId: 7 }),
    );
  });

  test("an unavailable entry the Library now has becomes that Library song in its place", () => {
    const entries = [
      { itemId: 10, playlistId: 1, song: unavailable("Within").song },
      { itemId: 11, playlistId: 1, song: unavailable("Untitled", { artists: [] }).song },
    ];
    const songs = [
      track(1, "Within", "Daft Punk", 229_000),
      track(2, "Untitled", "Daft Punk", 228_000),
    ];
    assert.deepEqual(
      playlistEntryLinks(entries, songs, []),
      linked({ itemId: 10, trackId: 1 }),
      "a local file without an artist isn't matched",
    );
  });

  test("an unavailable entry whose song its playlist holds already is removed, not doubled", () => {
    const entries = [
      { itemId: 10, playlistId: 1, song: unavailable("Within").song },
      { itemId: 11, playlistId: 2, song: unavailable("Within").song },
      {
        itemId: 12,
        playlistId: 2,
        song: yt("w", { title: "Within", artists: ["Daft Punk"], durationMs: 228_000 }),
      },
    ];
    const songs = [track(1, "Within", "Daft Punk", 228_000)];
    assert.deepEqual(playlistEntryLinks(entries, songs, [{ playlistId: 1, trackId: 1 }]), {
      links: [{ itemId: 11, trackId: 1 }],
      drops: [10, 12],
    });
  });

  test("nothing to link when there are no entries or no new songs", () => {
    assert.deepEqual(playlistEntryLinks([], [track(1, "Genesis", "Justice")], []), linked());
    assert.deepEqual(playlistEntryLinks([entry(10, yt("a"))], [], []), linked());
  });
});

describe("an unavailable entry", () => {
  test("says why it's unavailable, on its row and when tapped", () => {
    assert.deepEqual(unavailableEntryView(unavailable("Within").song), {
      line: "Not found on YouTube Music",
      notice: "Wave couldn't find this song on YouTube Music or in your Library.",
    });
    assert.deepEqual(unavailableEntryView(unavailable("Untitled", { reason: "localFile" }).song), {
      line: "Local file on Spotify",
      notice: "This song is a local file on Spotify, so Wave couldn't look for it.",
    });
  });

  test("its menu offers Remove from Playlist and Search, while Search is on the tab bar", () => {
    assert.deepEqual(unavailableEntryActions({ search: true }), ["removeFromPlaylist", "search"]);
    assert.deepEqual(unavailableEntryActions({ search: false }), ["removeFromPlaylist"]);
    assert.deepEqual(UNAVAILABLE_ENTRY_ACTION_LABELS, {
      removeFromPlaylist: "Remove from Playlist",
      search: "Search",
    });
  });

  test("Search looks for its title and main artist", () => {
    const song = unavailable("Instant Crush", {
      artists: ["Daft Punk", "Julian Casablancas"],
    }).song;
    assert.equal(unavailableSearchQuery(song), "Instant Crush Daft Punk");
    const credited = unavailable("Touch", { artists: ["Daft Punk feat. Paul Williams"] }).song;
    assert.equal(unavailableSearchQuery(credited), "Touch Daft Punk");
    assert.equal(unavailableSearchQuery(unavailable("Untitled", { artists: [] }).song), "Untitled");
  });
});

describe("playlistUnplayableNotice", () => {
  type Track = { readonly id: number };
  const own: MixedSong<YtAlbumSong, Track> = { source: "library", track: { id: 1 } };
  const local = (title: string) => unavailable(title, { artists: [], reason: "localFile" });

  test("a playlist of one unavailable entry says why, as tapping it does", () => {
    assert.equal(
      playlistUnplayableNotice([unavailable("Within")]),
      "Wave couldn't find this song on YouTube Music or in your Library.",
    );
    assert.equal(
      playlistUnplayableNotice([local("Untitled")]),
      "This song is a local file on Spotify, so Wave couldn't look for it.",
    );
  });

  test("a playlist of several says why for them all", () => {
    assert.equal(
      playlistUnplayableNotice([unavailable("Within"), unavailable("Touch")]),
      "Wave couldn't find these songs on YouTube Music or in your Library.",
    );
    assert.equal(
      playlistUnplayableNotice([local("Untitled"), local("Demo")]),
      "These songs are local files on Spotify, so Wave couldn't look for them.",
    );
    assert.equal(
      playlistUnplayableNotice([unavailable("Within"), local("Untitled")]),
      "Wave couldn't find these songs on YouTube Music or in your Library, or they're local files on Spotify.",
    );
  });

  test("a playlist with anything that plays, or nothing at all, says nothing", () => {
    assert.equal(playlistUnplayableNotice([unavailable("Within"), own]), null);
    assert.equal(playlistUnplayableNotice([]), null);
  });
});

describe("playlistSongsLine", () => {
  test("counts every entry, and says how many can't play", () => {
    assert.equal(playlistSongsLine(2451, 3), "2,451 songs · 3 unavailable");
    assert.equal(playlistSongsLine(1, 1), "1 song · 1 unavailable");
  });

  test("a playlist with every song available says only its count", () => {
    assert.equal(playlistSongsLine(24, 0), "24 songs");
  });
});
