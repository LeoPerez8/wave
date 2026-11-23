/// <reference types="node" />
import assert from "node:assert/strict";
import { describe, test } from "node:test";

import type {
  GeniusLyricsHit,
  SearchResults,
  YtArtistCandidate,
  YtCommunityPlaylist,
  YtSectionView,
} from "@wave/core";
import type { SongRow } from "@wave/client";
import type { NativeYtSong } from "@/native/waveYtMusic";
import type { LocalLyricsHit } from "./lyricsSearch.ts";
import type { SearchHit } from "./searchIndex.ts";
import {
  namedSongOnTop,
  namesTopSong,
  resultRows,
  ytFooterRows,
  type PlacedYtSongs,
} from "./rows.ts";

const noPlaced: PlacedYtSongs = { songs: [], rowOf: new Map() };
const empty: SearchResults<SearchHit> = { top: null, groups: [] };

const lyricHits = (count: number): LocalLyricsHit[] =>
  Array.from({ length: count }, (_, index) => ({
    source: "library",
    song: { id: index + 1, title: `Song ${index + 1}`, artist: "Artist" } as SongRow,
    line: "Trem bala",
    ranges: [
      { start: 0, end: 4 },
      { start: 5, end: 9 },
    ],
  }));

const geniusHits = (count: number): GeniusLyricsHit[] =>
  Array.from({ length: count }, (_, index) => ({
    id: index + 1,
    title: `Genius song ${index + 1}`,
    artist: "Artist",
    credit: "Artist",
    url: `https://genius.com/${index + 1}`,
    artworkUrl: null,
  }));

describe("Search lyric section", () => {
  test("three or more words put Lyrics first", () => {
    const rows = resultRows(
      empty,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      lyricHits(1),
      false,
      "one two three",
    );
    assert.equal(rows[0]?.type, "heading");
    assert.equal(rows[0]?.key, "heading:lyrics");
  });

  test("short queries put Lyrics after Songs and initially show five with Show all", () => {
    const songs: SearchResults<SearchHit> = {
      top: null,
      groups: [{ kind: "song", items: [], total: 0 }],
    };
    const rows = resultRows(
      songs,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      lyricHits(6),
      false,
      "two words",
    );
    const heading = rows.findIndex((row) => row.key === "heading:lyrics");
    assert.ok(heading > rows.findIndex((row) => row.key === "heading:song"));
    assert.equal(rows.filter((row) => row.type === "lyric").length, 5);
    assert.equal(rows.at(-1)?.type, "moreLyrics");

    const expanded = resultRows(
      songs,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      lyricHits(6),
      true,
      "two words",
    );
    assert.equal(expanded.filter((row) => row.type === "lyric").length, 6);
    assert.equal(
      expanded.some((row) => row.type === "moreLyrics"),
      false,
    );
  });

  test("a song already in Songs is not repeated in Lyrics", () => {
    const song = { id: 1, title: "Trem bala", artist: "Artist" } as SongRow;
    const hit: SearchHit = { kind: "song", name: song.title, also: [], song };
    const results: SearchResults<SearchHit> = {
      top: hit,
      groups: [{ kind: "song", items: [hit], total: 1 }],
    };
    const rows = resultRows(
      results,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      lyricHits(1),
      false,
      "trem bala",
    );
    assert.equal(
      rows.some((row) => row.type === "lyric"),
      false,
    );
  });

  test("a Genius hit shows unless a Lyrics row shows that song", () => {
    const original = {
      id: 7,
      title: "Just Pretend",
      artist: "Bad Omens",
      album: "The Death of Peace of Mind",
      durationMs: 205_000,
    } as SongRow;
    const hits: GeniusLyricsHit[] = [
      {
        id: 1,
        title: "Just Pretend (Acoustic)",
        artist: "The Veer Union",
        credit: "The Veer Union",
        url: "https://genius.com/1",
        artworkUrl: null,
      },
      {
        id: 2,
        title: "Just Pretend",
        artist: "Bad Omens",
        credit: "Bad Omens",
        url: "https://genius.com/2",
        artworkUrl: null,
      },
    ];
    const query = "i can wait for you at the bottom";
    const geniusIds = (rows: ReturnType<typeof resultRows>) =>
      rows.flatMap((row) => (row.type === "geniusLyric" ? [row.hit.id] : []));

    // The Library holds the song, but its file has no lyrics: no local result shows it.
    const noLocal = resultRows(
      empty,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      [],
      false,
      query,
      hits,
    );
    assert.deepEqual(geniusIds(noLocal), [1, 2]);

    const lyricRow: LocalLyricsHit = {
      source: "library",
      song: original,
      line: "I can wait for you at the bottom",
      ranges: [{ start: 0, end: 32 }],
    };
    const local = resultRows(
      empty,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      [lyricRow],
      false,
      query,
      hits,
    );
    assert.deepEqual(geniusIds(local), [1]);

    const inSongs: SearchResults<SearchHit> = {
      top: null,
      groups: [
        {
          kind: "song",
          items: [{ kind: "song", name: original.title, also: [], song: original }],
          total: 1,
        },
      ],
    };
    const shownInSongs = resultRows(
      inSongs,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      [lyricRow],
      false,
      query,
      hits,
    );
    // Songs shows the song, so its local Lyrics row goes; Genius's hit keeps it in Lyrics.
    assert.deepEqual(geniusIds(shownInSongs), [1, 2]);

    const placedLibrary: PlacedYtSongs = {
      songs: [
        {
          source: "library",
          song: {
            videoId: "just-pretend",
            title: "Just Pretend",
            artists: ["Bad Omens"],
            album: null,
            albumId: null,
            durationMs: 205_000,
            artworkUrl: null,
            explicit: false,
          },
          track: original,
        },
      ],
      rowOf: new Map(),
    };
    const placedInSongs = resultRows(
      empty,
      new Set(),
      null,
      placedLibrary,
      null,
      "en",
      [],
      false,
      query,
      hits,
    );
    assert.deepEqual(geniusIds(placedInSongs), [1, 2]);
  });

  test("Genius's hit for the original stays in Lyrics when YT Music streams it in Songs", () => {
    const original: NativeYtSong = {
      videoId: "party-in-the-usa",
      title: "Party In The U.S.A.",
      artists: ["Miley Cyrus"],
      album: "The Time Of Our Lives",
      albumId: null,
      durationMs: 202_000,
      artworkUrl: null,
      explicit: false,
    };
    const hit = (id: number, title: string, artist: string): GeniusLyricsHit => ({
      id,
      title,
      artist,
      credit: artist,
      url: `https://genius.com/${id}`,
      artworkUrl: null,
    });
    const rows = resultRows(
      empty,
      new Set(),
      null,
      { songs: [{ source: "stream", song: original }], rowOf: new Map([[original.videoId, 0]]) },
      null,
      "en",
      [],
      false,
      "it's a party in the usa",
      [
        hit(2509, "Party in the U.S.A.", "Miley Cyrus"),
        hit(1937224, "Party in the U.S.A.", "The Barden Bellas"),
        hit(7839798, "Party In The U.S.A. (Live)", "Miley Cyrus"),
      ],
    );
    const lyrics = rows.flatMap((row) => (row.type === "geniusLyric" ? [row.hit.id] : []));
    assert.deepEqual(lyrics, [2509, 1937224, 7839798]);
    // Lyrics leads the page: its heading, then Genius's first hit, the original.
    assert.equal(rows[0]?.key, "heading:lyrics");
    assert.equal(rows[1]?.type, "geniusLyric");
    assert.equal(
      rows.some((row) => row.type === "ytSong" && row.song.videoId === original.videoId),
      true,
    );
  });

  test("Genius follows local hits, shows five hits, and expands to its first page", () => {
    const rows = resultRows(
      empty,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      lyricHits(1),
      false,
      "one two three",
      geniusHits(20),
    );
    assert.equal(rows[1]?.type, "lyric");
    assert.equal(rows[2]?.type, "geniusLyric");
    assert.equal(rows.filter((row) => row.type === "geniusLyric").length, 5);
    assert.equal(rows.at(-1)?.type, "moreLyrics");

    const expanded = resultRows(
      empty,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      lyricHits(1),
      true,
      "one two three",
      geniusHits(20),
    );
    assert.equal(expanded.filter((row) => row.type === "geniusLyric").length, 20);
  });

  test("online lyrics states appear in Lyrics only for eligible queries", () => {
    const signedOut = resultRows(
      empty,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      [],
      false,
      "one two three",
      [],
      "signedOut",
    );
    assert.deepEqual(
      signedOut.map((row) => row.type),
      ["heading", "geniusState"],
    );
    const signInRow = signedOut.at(-1);
    assert.equal(signInRow?.type, "geniusState");
    if (signInRow?.type === "geniusState") assert.equal(signInRow.status, "signedOut");

    const offline = resultRows(
      empty,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      lyricHits(1),
      false,
      "one two three",
      [],
      "offline",
    );
    assert.equal(
      offline.some((row) => row.type === "lyric"),
      true,
    );
    assert.equal(offline.at(-1)?.type, "geniusState");

    const short = resultRows(
      empty,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      [],
      false,
      "two words",
      [],
      "failed",
    );
    assert.equal(
      short.some((row) => row.type === "geniusState"),
      false,
    );
  });

  test("saved streamed songs keep one lyric row and leave out their YT result duplicate", () => {
    const song = {
      videoId: "streamed-video",
      title: "Streamed song",
      artists: ["Artist"],
      album: null,
      albumId: null,
      durationMs: 180_000,
      artworkUrl: null,
      explicit: false,
    } satisfies NativeYtSong;
    const hit = {
      source: "stream",
      song,
      line: "remembered lyric",
      ranges: [{ start: 0, end: 10 }],
    } as const;
    const rows = resultRows(
      empty,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      [hit],
      false,
      "three words here",
    );
    const lyric = rows.find((row) => row.type === "lyric");
    assert.equal(lyric?.type, "lyric");
    if (lyric?.type === "lyric") {
      assert.equal(lyric.key, "lyrics:yt:streamed-video");
      assert.equal(lyric.hit.source, "stream");
    }

    const sameSong = resultRows(
      empty,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      [hit],
      false,
      "three words here",
      [
        {
          id: 99,
          title: song.title,
          artist: "Artist",
          credit: "Artist",
          url: "https://genius.com/streamed-song",
          artworkUrl: null,
        },
      ],
    );
    assert.equal(
      sameSong.some((row) => row.type === "geniusLyric"),
      false,
    );

    const alreadyShown: PlacedYtSongs = {
      songs: [{ source: "stream", song }],
      rowOf: new Map([[song.videoId, 0]]),
    };
    const deduplicated = resultRows(
      empty,
      new Set(),
      null,
      alreadyShown,
      null,
      "en",
      [hit],
      false,
      "three words here",
    );
    assert.equal(
      deduplicated.some((row) => row.type === "lyric"),
      false,
    );
  });
});

describe("Search groups", () => {
  const ytSong = (videoId: string, title: string, artist: string): NativeYtSong => ({
    videoId,
    title,
    artists: [artist],
    album: null,
    albumId: null,
    durationMs: 200_000,
    artworkUrl: null,
    explicit: false,
  });
  const ytArtist = (name: string): YtArtistCandidate => ({
    name,
    browseId: `UC-${name}`,
    audience: null,
  });
  const online = (
    songs: readonly NativeYtSong[],
    artists: readonly YtArtistCandidate[],
  ): YtSectionView<NativeYtSong> => ({
    songs,
    artists,
    albums: [],
    playlists: [],
    top: songs[0] === undefined ? null : { kind: "song", song: songs[0] },
    note: null,
    loading: false,
    integrated: true,
  });
  const placedOf = (songs: readonly NativeYtSong[]): PlacedYtSongs => ({
    songs: songs.map((song) => ({ source: "stream", song })),
    rowOf: new Map(songs.map((song, index) => [song.videoId, index])),
  });
  const headings = (rows: ReturnType<typeof resultRows>): string[] =>
    rows.flatMap((row) => (row.type === "heading" ? [row.key] : []));

  const songs = [
    ytSong("a", "Faixa Amarela", "Zeca Pagodinho"),
    ytSong("b", "Faixa Amarela (Ao Vivo)", "Zeca Pagodinho"),
  ];
  const artists = [ytArtist("Zeca Pagodinho"), ytArtist("Grupo Revelação")];

  test('"faixa amarela" online: the songs with that title come before artists not named so', () => {
    const rows = resultRows(
      empty,
      new Set(),
      online(songs, artists),
      placedOf(songs),
      null,
      "en",
      [],
      false,
      "faixa amarela",
    );
    assert.deepEqual(headings(rows), ["heading:top", "heading:song", "heading:artist"]);
  });

  test("an online artist named as the query comes before the Library's songs that only contain it", () => {
    const song = { id: 1, title: "Zeca Pagodinho Medley", artist: "Various", album: "Samba" };
    const hit: SearchHit = {
      kind: "song",
      name: song.title,
      also: [song.artist, song.album],
      song: song as SongRow,
    };
    const rows = resultRows(
      { top: hit, groups: [{ kind: "song", items: [hit], total: 1 }] },
      new Set(),
      online([], artists),
      noPlaced,
      null,
      "en",
      [],
      false,
      "zeca pagodinho",
    );
    assert.deepEqual(headings(rows), ["heading:top", "heading:artist", "heading:song"]);
  });
});

describe("Search's Community playlists shelf", () => {
  const playlist = (playlistId: string): YtCommunityPlaylist => ({
    playlistId,
    title: `Playlist ${playlistId}`,
    author: "Someone",
    artworkUrl: null,
  });
  const song: NativeYtSong = {
    videoId: "v",
    title: "Song",
    artists: ["Artist"],
    album: null,
    albumId: null,
    durationMs: null,
    artworkUrl: null,
    explicit: false,
  };
  const view = (playlists: YtCommunityPlaylist[]): YtSectionView<NativeYtSong> => ({
    songs: [song],
    artists: [],
    albums: [],
    playlists,
    top: { kind: "song", song },
    note: null,
    loading: false,
    integrated: true,
  });
  const placed: PlacedYtSongs = {
    songs: [{ source: "stream", song }],
    rowOf: new Map([[song.videoId, 0]]),
  };
  const shown = (playlists: YtCommunityPlaylist[], language: "en" | "pt-BR" = "en") =>
    resultRows(empty, new Set(), view(playlists), placed, null, language);

  test("the playlists found show under its head, after every other group", () => {
    const rows = shown([playlist("b"), playlist("a")]);
    assert.deepEqual(rows.slice(-3), [
      { type: "heading", key: "heading:community-playlists", label: "Community playlists · 2" },
      { type: "ytPlaylist", key: "yt-playlist:b", playlist: playlist("b") },
      { type: "ytPlaylist", key: "yt-playlist:a", playlist: playlist("a") },
    ]);
    assert.ok(rows.findIndex((row) => row.key === "heading:song") < rows.length - 3);
  });

  test("a search that found none shows no shelf", () => {
    const rows = shown([]);
    assert.equal(
      rows.some((row) => row.type === "ytPlaylist" || row.key === "heading:community-playlists"),
      false,
    );
  });

  test("the shelf is headed in Portuguese", () => {
    assert.deepEqual(shown([playlist("a")], "pt-BR").at(-2), {
      type: "heading",
      key: "heading:community-playlists",
      label: "Playlists da comunidade · 1",
    });
  });

  test("the line about results the Library already has shows once, above the shelf", () => {
    const allInLibrary: YtSectionView<NativeYtSong> = {
      ...view([playlist("a")]),
      songs: [],
      top: null,
      note: "allInLibrary",
    };
    const rows = [
      ...resultRows(empty, new Set(), allInLibrary, noPlaced, null, "en"),
      ...ytFooterRows(allInLibrary, "en"),
    ];
    assert.deepEqual(rows, [
      {
        type: "note",
        key: "note:yt",
        text: "Everything found online is already in your library.",
      },
      { type: "heading", key: "heading:community-playlists", label: "Community playlists · 1" },
      { type: "ytPlaylist", key: "yt-playlist:a", playlist: playlist("a") },
    ]);
  });

  test("with no shelf, that line stays under the results", () => {
    const allInLibrary: YtSectionView<NativeYtSong> = {
      ...view([]),
      songs: [],
      top: null,
      note: "allInLibrary",
    };
    assert.deepEqual(resultRows(empty, new Set(), allInLibrary, noPlaced, null, "en"), []);
    assert.deepEqual(
      ytFooterRows(allInLibrary, "en").map((row) => row.key),
      ["note:yt"],
    );
  });

  test("with nothing else found, the shelf still shows", () => {
    const only: YtSectionView<NativeYtSong> = { ...view([playlist("a")]), songs: [], top: null };
    const rows = resultRows(empty, new Set(), only, noPlaced, null, "en");
    assert.deepEqual(
      rows.map((row) => row.key),
      ["heading:community-playlists", "yt-playlist:a"],
    );
  });
});

describe("a query naming a song by its title and artist (#1470)", () => {
  const librarySong = (id: number, title: string, artist: string): SearchHit => {
    const song = { id, title, artist, album: "Album" } as SongRow;
    return { kind: "song", name: title, also: [artist, "Album"], song };
  };
  const luck = librarySong(11, "Try My Luck", "WayV");
  const cover = librarySong(12, "Try My Luck", "Someone");
  const artistHit: SearchHit = {
    kind: "artist",
    name: "WayV Try My Luck Fans",
    artist: { id: 9, name: "WayV Try My Luck Fans" },
  } as SearchHit;
  const found: SearchResults<SearchHit> = {
    top: artistHit,
    groups: [
      { kind: "artist", items: [artistHit], total: 1 },
      { kind: "song", items: [cover, luck], total: 2 },
    ],
  };
  const keys = (rows: ReturnType<typeof resultRows>): string[] => rows.map((row) => row.key);

  test("puts the Library song it names on top, title and artist in either order", () => {
    for (const query of ["try my luck wayV", "wayV try my luck"]) {
      const ranked = namedSongOnTop(found, query);
      assert.equal(ranked.top, luck);
      assert.equal(ranked.groups, found.groups);
    }
    assert.equal(namedSongOnTop(found, "try my luck"), found);
    assert.equal(namedSongOnTop(found, "wayv"), found);
  });

  test("Lyrics follow Songs, as for a short query, and the query names the song shown", () => {
    const ranked = namedSongOnTop(found, "try my luck wayv");
    assert.equal(namesTopSong(ranked, null, "try my luck wayv"), true);
    const rows = resultRows(
      ranked,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      lyricHits(1),
      false,
      "try my luck wayv",
      geniusHits(1),
    );
    assert.deepEqual(keys(rows).slice(0, 2), ["heading:top", "top:song:11"]);
    const songs = keys(rows).indexOf("heading:song");
    const lyrics = keys(rows).indexOf("heading:lyrics");
    assert.ok(songs >= 0 && lyrics > songs);
  });

  test("puts YT Music's song it names on top when the Library lacks the song", () => {
    const streamed: NativeYtSong = {
      videoId: "luck",
      title: "Try My Luck",
      artists: ["WayV"],
      album: null,
      albumId: null,
      durationMs: 200_000,
      artworkUrl: null,
      explicit: false,
    };
    const yt: YtSectionView<NativeYtSong> = {
      songs: [streamed],
      artists: [],
      albums: [],
      playlists: [],
      top: { kind: "song", song: streamed },
      note: null,
      loading: false,
      integrated: true,
    };
    const placed: PlacedYtSongs = {
      songs: [{ source: "stream", song: streamed }],
      rowOf: new Map([["luck", 0]]),
    };
    const library: SearchResults<SearchHit> = {
      top: artistHit,
      groups: [{ kind: "artist", items: [artistHit], total: 1 }],
    };
    assert.equal(namesTopSong(library, yt, "try my luck wayv"), true);
    const rows = resultRows(
      library,
      new Set(),
      yt,
      placed,
      null,
      "en",
      lyricHits(1),
      false,
      "try my luck wayv",
    );
    assert.deepEqual(keys(rows).slice(0, 2), ["heading:top", "top:yt:luck"]);
    assert.notEqual(keys(rows)[0], "heading:lyrics");
  });

  test("a lyric phrase that isn't a title still puts Lyrics first", () => {
    assert.equal(namesTopSong(found, null, "under a pink moon"), false);
    const rows = resultRows(
      found,
      new Set(),
      null,
      noPlaced,
      null,
      "en",
      lyricHits(1),
      false,
      "under a pink moon",
    );
    assert.equal(rows[0]?.key, "heading:lyrics");
  });
});
