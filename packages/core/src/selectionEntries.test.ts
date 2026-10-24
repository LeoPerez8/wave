import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { selectionEntries, type QueueSong, type YtSong } from "./index.ts";

interface Track {
  readonly id: number;
  readonly path: string | null;
}

const yt = (videoId: string): YtSong => ({
  videoId,
  title: videoId,
  artists: ["Artist"],
  album: null,
  durationMs: 180000,
  artworkUrl: null,
  explicit: false,
});
const filed: Track = { id: 9, path: "/Music/song.m4a" };
const missing: Track = { id: 10, path: null };
const library = (track: Track): QueueSong<YtSong, Track> => ({ source: "library", track });
const stream = (song: YtSong): QueueSong<YtSong, Track> => ({ source: "stream", song });

describe("the songs a selection bar action reads for its checked items", () => {
  test("items come in page order, a song two of them hold once", async () => {
    const lists = new Map([
      ["album", [library(filed), stream(yt("b"))]],
      ["song", [stream(yt("b"))]],
      ["single", [stream(yt("c"))]],
    ]);
    const entries = await selectionEntries(["album", "song", "single"], {
      entries: async (item) => lists.get(item) ?? [],
      finder: async () => () => null,
    });
    assert.deepEqual(entries, [library(filed), stream(yt("b")), stream(yt("c"))]);
  });

  test("a streamed song the Library has a file of acts as the Library's; a missing one stays streamed", async () => {
    const entries = await selectionEntries(["release"], {
      entries: async () => [stream(yt("filed")), stream(yt("missing")), stream(yt("online"))],
      finder: async () => (song) =>
        song.videoId === "filed" ? filed : song.videoId === "missing" ? missing : null,
    });
    assert.deepEqual(entries, [library(filed), stream(yt("missing")), stream(yt("online"))]);
  });

  test("the Library finder is asked only when a song streams, after every item is read", async () => {
    const calls: string[] = [];
    const finder = async () => {
      calls.push("finder");
      return () => null;
    };
    await selectionEntries(["album"], {
      entries: async () => {
        calls.push("album");
        return [library(filed)];
      },
      finder,
    });
    assert.deepEqual(calls, ["album"]);
    await selectionEntries(["release"], {
      entries: async () => {
        calls.push("release");
        return [stream(yt("a"))];
      },
      finder,
    });
    assert.deepEqual(calls, ["album", "release", "finder"]);
  });

  test("an item that can't be read fails the whole action", async () => {
    await assert.rejects(
      selectionEntries(["song", "release"], {
        entries: async (item) => {
          if (item === "release") throw new Error("offline");
          return [stream(yt("a"))];
        },
        finder: async () => () => null,
      }),
      /offline/,
    );
  });
});
