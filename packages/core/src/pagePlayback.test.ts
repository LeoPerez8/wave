import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  pagePlayback,
  skipMissingSongs,
  tappedMissingSong,
  type MixedSong,
  type PlayableSongs,
  type YtSong,
} from "./index.ts";

interface Track {
  readonly id: number;
}

const ytSong = (videoId: string): YtSong => ({
  videoId,
  title: videoId,
  artists: [],
  album: null,
  durationMs: null,
  artworkUrl: null,
  explicit: false,
});

const library = (id: number): MixedSong<YtSong, Track> => ({ source: "library", track: { id } });
const stream = (videoId: string): MixedSong<YtSong, Track> => ({
  source: "stream",
  song: ytSong(videoId),
});

describe("pagePlayback", () => {
  test("a page with only the Library's songs plays the Library's tracks", () => {
    assert.deepEqual(pagePlayback([library(3), library(1), library(2)]), {
      kind: "library",
      tracks: [{ id: 3 }, { id: 1 }, { id: 2 }],
    });
  });

  test("a page with YouTube Music's songs among the Library's plays the mixed list, in page order", () => {
    const songs = [library(3), stream("a"), library(1), stream("b")];
    assert.deepEqual(pagePlayback(songs), { kind: "mixed", songs });
  });
});

describe("skipMissingSongs", () => {
  /** The odd songs have a file; the even ones are missing songs. */
  const hasFile = (song: Track) => song.id % 2 === 1;
  const songs: readonly Track[] = [{ id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 }];

  test("Play and Shuffle play only the songs with a file, in list order", () => {
    assert.deepEqual(skipMissingSongs(songs, undefined, hasFile), {
      songs: [{ id: 1 }, { id: 3 }, { id: 5 }],
      startIndex: undefined,
    });
  });

  test("a tapped song plays from itself among the songs with a file", () => {
    assert.deepEqual(skipMissingSongs(songs, 4, hasFile), {
      songs: [{ id: 1 }, { id: 3 }, { id: 5 }],
      startIndex: 2,
    });
  });

  test("a tapped missing song plays nothing", () => {
    assert.equal(skipMissingSongs(songs, 1, hasFile), null);
  });

  test("a tapped missing song is downloaded instead", () => {
    assert.deepEqual(tappedMissingSong(songs, 1, hasFile), { id: 2 });
  });

  test("a tapped song with a file, Play and Shuffle download nothing", () => {
    assert.equal(tappedMissingSong(songs, 0, hasFile), null);
    assert.equal(tappedMissingSong(songs, undefined, hasFile), null);
    assert.equal(tappedMissingSong([{ id: 2 }], undefined, hasFile), null);
  });

  test("a list of missing songs plays nothing", () => {
    assert.equal(skipMissingSongs([{ id: 2 }, { id: 4 }], undefined, hasFile), null);
  });

  test("what plays is typed as having a file when [hasFile] says so", () => {
    interface Row {
      readonly id: number;
      readonly path: string | null;
    }
    const rows: readonly Row[] = [
      { id: 1, path: "/a.mp3" },
      { id: 2, path: null },
    ];
    const withPath = (row: Row): row is Row & { readonly path: string } => row.path !== null;
    const play: PlayableSongs<Row & { readonly path: string }> | null = skipMissingSongs(
      rows,
      0,
      withPath,
    );
    assert.deepEqual(
      play?.songs.map((row) => row.path),
      ["/a.mp3"],
    );
  });
});
