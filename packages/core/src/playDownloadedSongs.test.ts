import assert from "node:assert/strict";
import { describe, test } from "node:test";

import {
  artistGraph,
  DEFAULT_DJ_SETTINGS,
  DOWNLOADED_STAND_IN_SONGS,
  EMPTY_QUEUE,
  djArtistTile,
  magicArtistKey,
  playDownloadedSongs,
  playDownloadedSongsShows,
  reduceQueue,
  startDjQueue,
  upNext,
  type DjAudioFeatures,
  type DjSettings,
  type MagicSession,
  type MagicSong,
  type PlayDownloadedSongsOptions,
  type QueueCommand,
  type QueueState,
} from "./index.ts";

const song = (trackId: string, artist: string): MagicSong => ({
  trackId,
  artists: [magicArtistKey(artist)],
  genre: null,
  style: null,
});

const run = (state: QueueState, ...commands: QueueCommand[]): QueueState =>
  commands.reduce((current, command) => reduceQueue(current, command).state, state);

/** A queue of [trackIds] from an album, playing [at]. */
const playing = (trackIds: readonly string[], at = 0): QueueState =>
  run(EMPTY_QUEUE, {
    type: "play",
    trackIds,
    startIndex: at,
    context: { kind: "album", id: "1" },
  });

/**
 * Songs whose id starts with "f" have a file on the phone; "s" ones are
 * streamed; "yt:d" was downloaded since it was queued, as Library song "7".
 */
const onPhone = (trackId: string): string | null =>
  trackId.startsWith("f") ? trackId : trackId === "yt:d" ? "7" : null;

const options = (more: Partial<PlayDownloadedSongsOptions> = {}): PlayDownloadedSongsOptions => ({
  onPhone,
  stalledArtists: ["Stalled"],
  ...more,
});

const keyOf = (state: QueueState, trackId: string): string =>
  state.entries.find((entry) => entry.trackId === trackId)!.key;

/** A graph where each artist's page lists the others as "Fans might also like". */
const graphOf = (pages: Record<string, string[]>) =>
  artistGraph({
    catalog: [],
    pages: Object.entries(pages).map(([name, similar]) => ({
      name,
      similar: similar.map((other) => ({ name: other, browseId: `UC${other}`, audience: null })),
    })),
    plays: [],
  });

describe("Play Downloaded Songs", () => {
  describe("with a song on the phone ahead in the queue", () => {
    test("goes on to the next entry with a file on the phone, past the streamed ones", () => {
      const state = playing(["s1", "s2", "f3", "f4"]);
      assert.deepEqual(playDownloadedSongs(state, [], options()), {
        kind: "next",
        key: keyOf(state, "f3"),
        trackId: "f3",
      });
    });

    test("plays a streamed song downloaded since it was queued from its Library copy", () => {
      const state = playing(["s1", "s2", "yt:d", "f4"]);
      assert.deepEqual(playDownloadedSongs(state, [], options()), {
        kind: "next",
        key: keyOf(state, "yt:d"),
        trackId: "7",
      });
    });

    test("follows the shuffled order when shuffle is on", () => {
      const ids = ["s0", "f1", "f2", "f3", "f4", "f5", "s6", "s7"];
      let seed = 7;
      const random = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
      const state = reduceQueue(
        EMPTY_QUEUE,
        {
          type: "play",
          trackIds: ids,
          startIndex: 0,
          context: { kind: "album", id: "1" },
          shuffle: true,
        },
        random,
      ).state;
      const first = upNext(state).find((entry) => onPhone(entry.trackId) !== null)!;
      // The shuffle put another on-phone song ahead of the context's first one.
      assert.notEqual(first.trackId, "f1");
      assert.deepEqual(playDownloadedSongs(state, [], options()), {
        kind: "next",
        key: first.key,
        trackId: first.trackId,
      });
    });

    test("wraps to History's songs with Repeat All, and not without it", () => {
      const state = playing(["f1", "s2", "s3", "s4"], 1);
      const library = [song("f9", "Stalled")];
      assert.deepEqual(
        playDownloadedSongs(run(state, { type: "setRepeat", mode: "all" }), library, options()),
        { kind: "next", key: keyOf(state, "f1"), trackId: "f1" },
      );
      assert.equal(playDownloadedSongs(state, library, options())?.kind, "library");
    });

    test("shows even with nothing in the Library to play", () => {
      assert.equal(playDownloadedSongsShows(playing(["s1", "f2"]), [], options()), true);
    });
  });

  describe("with nothing ahead on the phone", () => {
    const graph = graphOf({ Stalled: ["Near"], Near: ["Far"] });

    test("plays Library songs seeded from the stalled song's artists, nearest in the artist graph first", () => {
      const state = playing(["s1", "s2"]);
      const library = [
        song("f1", "Stranger"),
        song("f2", "Far"),
        song("f3", "Near"),
        song("f4", "Stalled"),
      ];
      assert.deepEqual(playDownloadedSongs(state, library, options({ graph })), {
        kind: "library",
        trackIds: ["f4", "f3", "f2", "f1"],
      });
    });

    test("credits any of the stalled song's artists as a seed", () => {
      const state = playing(["s1"]);
      const library = [song("f1", "Stranger"), song("f2", "Featured")];
      assert.deepEqual(
        playDownloadedSongs(state, library, options({ stalledArtists: ["Stalled", "Featured"] })),
        { kind: "library", trackIds: ["f2", "f1"] },
      );
    });

    test(`plays at most ${DOWNLOADED_STAND_IN_SONGS} songs, never a disliked one`, () => {
      const state = playing(["s1"]);
      const library = Array.from({ length: DOWNLOADED_STAND_IN_SONGS + 5 }, (_, i) =>
        song(`f${i}`, "Stalled"),
      );
      const picked = playDownloadedSongs(
        state,
        library,
        options({
          disliked: new Set(["f0"]),
        }),
      );
      assert.equal(picked?.kind, "library");
      if (picked?.kind !== "library") return;
      assert.equal(picked.trackIds.length, DOWNLOADED_STAND_IN_SONGS);
      assert.equal(picked.trackIds.includes("f0"), false);
    });

    test("keeps to the DJ session's moods, as any stand-in does", () => {
      const ENERGETIC: DjAudioFeatures = { energy: 0.8, valence: 0.7, acousticness: 0.1, mode: 1 };
      const SAD_LOUD: DjAudioFeatures = { energy: 0.8, valence: 0.2, acousticness: 0.1, mode: 0 };
      const dj = (settings: Partial<DjSettings>): MagicSession =>
        startDjQueue([djArtistTile("Picked")!], {
          id: "dj1",
          settings: { ...DEFAULT_DJ_SETTINGS, ...settings },
        })!;
      const state = playing(["s1"]);
      const library = [
        song("fOff", "Stalled"),
        song("fUnknown", "Stalled"),
        song("fFit", "Stalled"),
      ];
      const moodFeatures = new Map([
        ["fOff", SAD_LOUD],
        ["fFit", ENERGETIC],
      ]);
      assert.deepEqual(
        playDownloadedSongs(
          state,
          library,
          options({
            session: dj({ mood: ["energetic"] }),
            moodFeatures,
          }),
        ),
        { kind: "library", trackIds: ["fFit", "fUnknown", "fOff"] },
      );
    });

    test("puts songs already in the queue behind the others", () => {
      const state = playing(["s1", "f-gone", "s2"], 2);
      const library = [song("f-gone", "Stalled"), song("f-new", "Stalled")];
      assert.deepEqual(playDownloadedSongs(state, library, options()), {
        kind: "library",
        trackIds: ["f-new", "f-gone"],
      });
    });
  });

  describe("with no song on the phone to play", () => {
    test("offers nothing, so the button doesn't show", () => {
      const state = playing(["s1", "s2"]);
      const disliked = new Set(["f1"]);
      const library = [song("f1", "Stalled")];
      assert.equal(playDownloadedSongs(state, [], options()), null);
      assert.equal(playDownloadedSongsShows(state, [], options()), false);
      assert.equal(playDownloadedSongs(state, library, options({ disliked })), null);
      assert.equal(playDownloadedSongsShows(state, library, options({ disliked })), false);
      assert.equal(playDownloadedSongsShows(state, library, options()), true);
    });

    test("offers nothing with no song playing", () => {
      assert.equal(playDownloadedSongs(EMPTY_QUEUE, [song("f1", "Stalled")], options()), null);
      assert.equal(
        playDownloadedSongsShows(EMPTY_QUEUE, [song("f1", "Stalled")], options()),
        false,
      );
    });
  });
});
