import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { settlePendingFavorites, type PendingFavorite } from "./index.ts";

const liked = (videoId: string, title: string, durationMs: number | null): PendingFavorite => ({
  videoId,
  title,
  artists: ["Daft Punk"],
  durationMs,
});

/** Two liked songs the Library didn't have when Liked Songs was read. */
const pending = [liked("crush", "Instant Crush", 337_000), liked("touch", "Touch", 498_000)];

const song = (
  id: number,
  title: string,
  durationMs: number,
  videoId: string | null = null,
  artist = "Daft Punk",
) => ({ id, title, artist, durationMs, videoId });

describe("settlePendingFavorites", () => {
  test("a download from the liked video settles its pending favorite, whatever its tags say", () => {
    assert.deepEqual(
      settlePendingFavorites(pending, [
        song(7, "Instant Crush (feat. Julian Casablancas)", 0, "crush"),
      ]),
      { star: [7], settled: ["crush"] },
    );
  });

  test("a scanned file or another download of the recording settles it too", () => {
    assert.deepEqual(settlePendingFavorites(pending, [song(8, "Touch", 499_000)]), {
      star: [8],
      settled: ["touch"],
    });
  });

  test("another take of the song, or someone else's, settles nothing", () => {
    assert.deepEqual(
      settlePendingFavorites(pending, [
        song(9, "Touch", 620_000),
        song(10, "Instant Crush", 337_000, null, "Smash Mouth"),
      ]),
      { star: [], settled: [] },
    );
  });

  test("a song liked under two videos is starred once and settles both", () => {
    const twice = [...pending, liked("crush-video", "Instant Crush", 338_000)];
    assert.deepEqual(settlePendingFavorites(twice, [song(7, "Instant Crush", 337_000)]), {
      star: [7],
      settled: ["crush", "crush-video"],
    });
  });

  test("nothing pending settles nothing", () => {
    assert.deepEqual(settlePendingFavorites([], [song(7, "Instant Crush", 337_000)]), {
      star: [],
      settled: [],
    });
  });
});
