import assert from "node:assert/strict";
import { describe, test } from "node:test";

import { mixKnownSongs, recordingKey } from "./index.ts";

const yt = (
  videoId: string,
  title: string,
  artists: string[],
  extra: { durationMs?: number | null; explicit?: boolean } = {},
) => ({
  videoId,
  title,
  artists,
  album: null,
  albumId: null,
  durationMs: extra.durationMs === undefined ? 200_000 : extra.durationMs,
  artworkUrl: null,
  explicit: extra.explicit ?? false,
});

const librarySong = (id: number, title: string, artist: string) => ({
  id,
  title,
  artist,
  durationMs: 200_000,
});

const none = { library: [], playedRecordingKeys: [], streamed: [], playlisted: [] };

describe("A song the owner knows", () => {
  test("is one the Library has", () => {
    const known = mixKnownSongs({
      ...none,
      library: [librarySong(1, "Teardrop", "Massive Attack")],
    });
    assert.equal(known.known(yt("a", "Teardrop", ["Massive Attack"])), true);
    assert.equal(known.known(yt("b", "Angel", ["Massive Attack"])), false);
    assert.equal(known.inLibrary(yt("a", "Teardrop", ["Massive Attack"]))?.id, 1);
  });

  test("is one the owner played, even after its file left the Library", () => {
    const known = mixKnownSongs({
      ...none,
      playedRecordingKeys: [
        recordingKey({
          title: "Roads",
          album: "Dummy",
          albumArtist: "Portishead",
          discNumber: null,
          trackNumber: null,
        }),
      ],
    });
    assert.equal(known.known(yt("r", "Roads", ["Portishead"])), true);
    assert.equal(known.inLibrary(yt("r", "Roads", ["Portishead"])), null);
  });

  test("is one the owner streamed, by its video or as the same recording", () => {
    const known = mixKnownSongs({
      ...none,
      streamed: [{ song: yt("s", "Angel", ["Massive Attack"]), plays: 1, firstPlayedAt: 5 }],
    });
    assert.equal(known.known(yt("s", "Angel (Official Audio)", ["Someone"])), true);
    assert.equal(known.known(yt("other", "Angel", ["Massive Attack"])), true);
    assert.equal(
      known.known(yt("live", "Angel", ["Massive Attack"], { durationMs: 400_000 })),
      false,
    );
  });

  test("is in a playlist: a YT Music entry by its video, an unsearched or unavailable one by title and artists", () => {
    const known = mixKnownSongs({
      ...none,
      playlisted: [
        { song: { source: "stream", song: yt("p", "Karmacoma", ["Massive Attack"]) }, addedAt: 1 },
        {
          song: {
            source: "unsearched",
            song: {
              title: "Glory Box",
              artists: ["Portishead"],
              album: null,
              durationMs: null,
              artworkUrl: null,
            },
          },
          addedAt: 2,
        },
        {
          song: {
            source: "unavailable",
            song: {
              title: "Hell Is Round the Corner",
              artists: ["Tricky"],
              album: null,
              durationMs: 200_000,
              artworkUrl: null,
              reason: "notFound",
            },
          },
          addedAt: 3,
        },
      ],
    });
    assert.equal(known.known(yt("p", "Something else", ["Anyone"])), true);
    assert.equal(known.known(yt("g", "Glory Box", ["Portishead"])), true);
    assert.equal(known.known(yt("h", "Hell Is Round the Corner", ["Tricky"])), true);
    assert.equal(known.known(yt("n", "Overcome", ["Tricky"])), false);
  });
});

describe("The non-D songs the owner knows", () => {
  test("are the streamed and playlisted songs the Library lacks, each once, the most streamed and then the newest first", () => {
    const entry = (song: ReturnType<typeof yt>, addedAt: number) => ({
      song: { source: "stream" as const, song },
      addedAt,
    });
    const known = mixKnownSongs({
      ...none,
      library: [librarySong(1, "Teardrop", "Massive Attack")],
      streamed: [
        { song: yt("once", "Angel", ["Massive Attack"]), plays: 1, firstPlayedAt: 50 },
        { song: yt("often", "Karmacoma", ["Massive Attack"]), plays: 6, firstPlayedAt: 10 },
        { song: yt("owned", "Teardrop", ["Massive Attack"]), plays: 9, firstPlayedAt: 10 },
      ],
      playlisted: [
        entry(yt("old", "Protection", ["Massive Attack"]), 20),
        entry(yt("once", "Angel", ["Massive Attack"]), 70),
        entry(yt("new", "Safe from Harm", ["Massive Attack"]), 60),
      ],
    });
    assert.deepEqual(
      known.nonD.map((song) => song.song.videoId),
      ["often", "once", "new", "old"],
    );
  });
});
